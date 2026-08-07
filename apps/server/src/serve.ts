import { createServer } from "node:http"
import { existsSync, mkdirSync, readFileSync, statSync, watch } from "node:fs"
import { join, resolve } from "node:path"
import { WebSocketServer, WebSocket } from "ws"
import type { AppSettings, ClientMsg, Project, ServerMsg } from "@hangar/contracts"
import {
  expandHome,
  findProject,
  hangarHome,
  loadRegistry,
  saveRegistry,
  validateProject,
} from "./registry.ts"
import { loadHistory } from "./history.ts"
import { SessionManager } from "./sessions.ts"
import { loadSettings, saveSettings } from "./settings.ts"

type PackageJson = {
  name?: unknown
  packageManager?: unknown
  scripts?: unknown
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function inspectProject(inputPath: string): object {
  const path = resolve(expandHome(inputPath))
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { path, exists: false, package: null }
  }

  const packagePath = join(path, "package.json")
  if (!existsSync(packagePath)) return { path, exists: true, package: null }

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson
  const declaredManager = typeof parsed.packageManager === "string"
    ? parsed.packageManager.split("@")[0]
    : null
  const manager = declaredManager === "pnpm" || declaredManager === "yarn" ||
      declaredManager === "bun" || declaredManager === "npm"
    ? declaredManager
    : existsSync(join(path, "pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(join(path, "yarn.lock"))
        ? "yarn"
        : existsSync(join(path, "bun.lock")) || existsSync(join(path, "bun.lockb"))
          ? "bun"
          : "npm"
  const scripts = parsed.scripts && typeof parsed.scripts === "object"
    ? Object.entries(parsed.scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name, value]) => ({
          name,
          value,
          cmd: `${manager} run ${shellArg(name)}`,
        }))
    : []

  return {
    path,
    exists: true,
    package: {
      name: typeof parsed.name === "string" ? parsed.name : null,
      manager,
      scripts,
    },
  }
}

export function serve(port: number): void {
  const clients = new Set<WebSocket>()

  const broadcast = (msg: ServerMsg): void => {
    const json = JSON.stringify(msg)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json)
    }
  }

  const stateMsg = (): ServerMsg => {
    let projects: Project[]
    let settings: AppSettings
    try {
      projects = loadRegistry().projects
      settings = loadSettings()
    } catch (error) {
      broadcast({ type: "error", message: String(error) })
      projects = []
      settings = loadSettings()
    }
    return { type: "state", projects, sessions: manager.list(), history: loadHistory(settings), settings }
  }
  const broadcastState = (): void => broadcast(stateMsg())

  const manager = new SessionManager(broadcast, broadcastState, loadSettings)

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("ok")
      return
    }
    if (req.method === "GET" && url.pathname === "/project-info") {
      try {
        const path = url.searchParams.get("path") ?? ""
        if (path.trim() === "") throw new Error("path is required")
        res.writeHead(200, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        })
        res.end(JSON.stringify(inspectProject(path)))
      } catch (error) {
        res.writeHead(400, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" })

  wss.on("connection", (socket) => {
    clients.add(socket)
    socket.send(JSON.stringify(stateMsg()))
    for (const snapshot of manager.snapshots()) {
      socket.send(JSON.stringify({ type: "snapshot", ...snapshot } satisfies ServerMsg))
    }

    socket.on("message", (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "invalid JSON" }))
        return
      }
      try {
        handle(msg)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        socket.send(JSON.stringify({ type: "error", message } satisfies ServerMsg))
      }
    })
    socket.on("close", () => clients.delete(socket))
    socket.on("error", () => clients.delete(socket))
  })

  const handle = (msg: ClientMsg): void => {
    switch (msg.type) {
      case "start": {
        const project = findProject(loadRegistry(), msg.project)
        if (!project) throw new Error(`no project named ${JSON.stringify(msg.project)}`)
        manager.start(project, msg.process)
        return
      }
      case "stop":
        manager.stop(msg.project, msg.process)
        return
      case "restart": {
        const project = findProject(loadRegistry(), msg.project)
        if (!project) throw new Error(`no project named ${JSON.stringify(msg.project)}`)
        manager.restart(project, msg.process)
        return
      }
      case "write":
        manager.write(msg.id, msg.data)
        return
      case "resize":
        manager.resize(msg.id, msg.cols, msg.rows)
        return
      case "dismiss":
        manager.dismiss(msg.id)
        return
      case "upsertProject": {
        const errors = validateProject(msg.project)
        if (errors.length > 0) throw new Error(errors.join("; "))
        const registry = loadRegistry()
        const existingIndex = registry.projects.findIndex((p) => p.name === msg.project.name)
        if (existingIndex === -1) registry.projects.push(msg.project)
        else registry.projects[existingIndex] = msg.project
        saveRegistry(registry)
        broadcastState()
        return
      }
      case "reorderProjects": {
        const registry = loadRegistry()
        const currentNames = registry.projects.map((project) => project.name)
        if (
          msg.projects.length !== currentNames.length ||
          new Set(msg.projects).size !== msg.projects.length ||
          msg.projects.some((name) => !currentNames.includes(name))
        ) {
          throw new Error("project order must contain every project exactly once")
        }
        const byName = new Map(registry.projects.map((project) => [project.name, project]))
        registry.projects = msg.projects.map((name) => byName.get(name)!)
        saveRegistry(registry)
        broadcastState()
        return
      }
      case "updateSettings":
        saveSettings(msg.settings)
        broadcastState()
        return
      case "removeProject": {
        const registry = loadRegistry()
        if (!findProject(registry, msg.project)) {
          throw new Error(`no project named ${JSON.stringify(msg.project)}`)
        }
        const sessions = manager.list().filter((s) => s.project === msg.project)
        if (sessions.some((s) => s.status === "running")) {
          throw new Error(`stop ${msg.project}'s processes before removing it`)
        }
        registry.projects = registry.projects.filter((p) => p.name !== msg.project)
        saveRegistry(registry)
        for (const session of sessions) manager.dismiss(session.id)
        broadcastState()
        return
      }
    }
  }

  // Push registry changes (e.g. an agent ran `hangar add`) to connected UIs.
  mkdirSync(hangarHome(), { recursive: true })
  let watchDebounce: NodeJS.Timeout | null = null
  watch(hangarHome(), () => {
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(broadcastState, 200)
  })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    process.stdout.write("\nshutting down sessions...\n")
    await manager.stopAll()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())

  httpServer.listen(port, "127.0.0.1", () => {
    process.stdout.write(`hangar server listening on http://127.0.0.1:${port} (ws: /ws)\n`)
  })
  httpServer.on("error", (error) => {
    process.stderr.write(`failed to listen on ${port}: ${error.message}\n`)
    process.exit(1)
  })
}
