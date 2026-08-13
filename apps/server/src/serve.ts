import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, globSync, mkdirSync, readFileSync, statSync, watch } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { hostname, networkInterfaces } from "node:os"
import { WebSocketServer, WebSocket } from "ws"
import type {
  AppSettings,
  ClientMsg,
  PairResponse,
  PairingInfo,
  Project,
  ServerMsg,
  WsTicketResponse,
} from "@hangar/contracts"
import {
  consumeTicket,
  createPairingToken,
  issueTicket,
  listSessions,
  redeemPairingToken,
  revokeSession,
  verifyBearer,
} from "./auth.ts"
import { expandHome, findProject, hangarHome, loadRegistry, saveRegistry, validateProject } from "./registry.ts"
import { exportAppIntentsState, watchAppIntentsCommands } from "./appintents.ts"
import { loadHistory, loadHistoryReplay } from "./history.ts"
import { SessionManager } from "./sessions.ts"
import { loadSettings, saveSettings } from "./settings.ts"

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
/** Auth (bearer or loopback) is the security boundary here, not the origin check. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST",
}
const MAX_BODY_BYTES = 64 * 1024

function isLoopback(req: IncomingMessage): boolean {
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? "")
}

/** Loopback clients stay trusted; anyone else needs a paired session token. */
function authorize(req: IncomingMessage): string | null {
  if (isLoopback(req)) return "local"
  return verifyBearer(req.headers.authorization)
}

function bindHost(settings: AppSettings): string {
  return process.env.HANGAR_HOST ?? (settings.connections?.acceptRemote ? "0.0.0.0" : "127.0.0.1")
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error("body too large")
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS_HEADERS })
  res.end(JSON.stringify(body))
}

function networkInfo(): { lan: string[]; tailscale: string[] } {
  const lan: string[] = []
  const tailscale: string[] = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== "IPv4") continue
      const [first, second] = address.address.split(".").map(Number)
      if (first === 100 && second !== undefined && second >= 64 && second <= 127) tailscale.push(address.address)
      else if (
        first === 10 ||
        (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      )
        lan.push(address.address)
    }
  }
  return { lan: [...new Set(lan)], tailscale: [...new Set(tailscale)] }
}

type PackageJson = {
  name?: unknown
  packageManager?: unknown
  scripts?: unknown
  workspaces?: unknown
}

type DetectedScript = {
  name: string
  value: string
  cmd: string
  cwd?: string
  workspace?: string
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function packageScripts(parsed: PackageJson, manager: string, prefix?: string, cwd?: string): DetectedScript[] {
  if (!parsed.scripts || typeof parsed.scripts !== "object") return []
  return Object.entries(parsed.scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => ({
      name: prefix ? `${prefix}/${name}` : name,
      value,
      cmd: `${manager} run ${shellArg(name)}`,
      ...(cwd ? { cwd } : {}),
      ...(prefix ? { workspace: prefix } : {}),
    }))
}

/** Handles package.json workspaces plus the common, intentionally small pnpm-workspace.yaml form. */
function workspacePatterns(path: string, parsed: PackageJson): string[] {
  const declared = Array.isArray(parsed.workspaces)
    ? parsed.workspaces
    : parsed.workspaces &&
        typeof parsed.workspaces === "object" &&
        Array.isArray((parsed.workspaces as { packages?: unknown }).packages)
      ? (parsed.workspaces as { packages: unknown[] }).packages
      : []
  const fromPackage = declared.filter((entry): entry is string => typeof entry === "string")
  if (fromPackage.length > 0) return fromPackage

  const workspaceFile = join(path, "pnpm-workspace.yaml")
  if (!existsSync(workspaceFile)) return []
  const patterns: string[] = []
  let inPackages = false
  for (const line of readFileSync(workspaceFile, "utf8").split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages && /^\S/.test(line)) break
    if (!inPackages) continue
    const match = line.match(/^\s+-\s+["']?([^"'#]+?)["']?\s*(?:#.*)?$/)
    if (match?.[1]) patterns.push(match[1].trim())
  }
  return patterns
}

function workspaceScripts(path: string, parsed: PackageJson, manager: string): DetectedScript[] {
  const patterns = workspacePatterns(path, parsed)
    .map((pattern) => pattern.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((pattern) => pattern !== "" && !pattern.startsWith("/") && !pattern.startsWith("../"))
  const included = patterns.filter((pattern) => !pattern.startsWith("!"))
  if (included.length === 0) return []
  const excluded = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => `${pattern.slice(1)}/package.json`)

  const packageFiles = globSync(
    included.map((pattern) => `${pattern}/package.json`),
    {
      cwd: path,
      exclude: ["**/node_modules/**", ...excluded],
    },
  ).sort()

  return packageFiles.flatMap((packageFile) => {
    const workspace = JSON.parse(readFileSync(join(path, packageFile), "utf8")) as PackageJson
    const cwd = dirname(packageFile).replaceAll("\\", "/")
    const packageName = typeof workspace.name === "string" ? workspace.name.split("/").pop() : null
    const label = packageName || basename(cwd)
    return packageScripts(workspace, manager, label, cwd)
  })
}

function inspectProject(inputPath: string): object {
  const path = resolve(expandHome(inputPath))
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { path, exists: false, package: null }
  }

  const packagePath = join(path, "package.json")
  if (!existsSync(packagePath)) return { path, exists: true, package: null }

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson
  const declaredManager = typeof parsed.packageManager === "string" ? parsed.packageManager.split("@")[0] : null
  const manager =
    declaredManager === "pnpm" || declaredManager === "yarn" || declaredManager === "bun" || declaredManager === "npm"
      ? declaredManager
      : existsSync(join(path, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(path, "yarn.lock"))
          ? "yarn"
          : existsSync(join(path, "bun.lock")) || existsSync(join(path, "bun.lockb"))
            ? "bun"
            : "npm"
  const rootScripts = packageScripts(parsed, manager)
  const childScripts = workspaceScripts(path, parsed, manager)

  return {
    path,
    exists: true,
    package: {
      name: typeof parsed.name === "string" ? parsed.name : null,
      manager,
      scripts: [...rootScripts, ...childScripts],
      workspaceScriptCount: childScripts.length,
    },
  }
}

export function serve(port: number): void {
  const clients = new Set<WebSocket>()
  let host = bindHost(loadSettings())

  const listen = (): void => {
    // Two quick acceptRemote flips queue two close callbacks; only the first listen may run.
    if (httpServer.listening) return
    httpServer.listen(port, host, () => {
      process.stdout.write(`hangar server listening on http://${host}:${port} (ws: /ws)\n`)
    })
  }

  /** Re-binds after the acceptRemote toggle. PTY sessions survive; UIs reconnect on their own. */
  const applyBindHost = (): void => {
    const next = bindHost(loadSettings())
    if (next === host) return
    host = next
    for (const client of clients) client.close(1012, "rebinding")
    clients.clear()
    httpServer.close(listen)
    httpServer.closeAllConnections()
  }

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
    return {
      type: "state",
      projects,
      sessions: manager.list(),
      history: loadHistory(settings),
      settings,
      serverName: hostname(),
      authSessions: listSessions(),
    }
  }
  const broadcastState = (): void => {
    broadcast(stateMsg())
    try {
      exportAppIntentsState(loadRegistry().projects, manager.list())
    } catch {
      // The Spotlight snapshot must never break state broadcasting.
    }
  }

  const manager = new SessionManager(broadcast, broadcastState, loadSettings)

  // Spotlight/Shortcuts bridge: export the current state, then drain any
  // commands queued while no server was running and keep watching.
  try {
    exportAppIntentsState(loadRegistry().projects, manager.list())
  } catch {
    // Same policy as above: the bridge is best-effort.
  }
  watchAppIntentsCommands((command) => {
    try {
      if (command.kind === "start-process") {
        const slash = command.targetId.indexOf("/")
        if (slash === -1) return
        const project = findProject(loadRegistry(), command.targetId.slice(0, slash))
        if (project) manager.start(project, command.targetId.slice(slash + 1))
      } else if (command.kind === "start-project") {
        const project = findProject(loadRegistry(), command.targetId)
        if (project) manager.start(project)
      }
    } catch (error) {
      broadcast({ type: "error", message: `App Intents command failed: ${String(error)}` })
    }
  })

  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" })
      res.end("ok")
      return
    }
    if (req.method === "POST" && url.pathname === "/api/auth/pair") {
      let body: { token?: unknown; label?: unknown }
      try {
        body = ((await readJsonBody(req)) ?? {}) as { token?: unknown; label?: unknown }
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" })
        return
      }
      const result = redeemPairingToken(body.token, body.label)
      if (!result.ok) {
        if (result.reason === "locked") sendJson(res, 429, { error: "too many pairing attempts" })
        else sendJson(res, 401, { error: "invalid or expired pairing code" })
        return
      }
      sendJson(res, 200, {
        sessionToken: result.sessionToken,
        sessionId: result.sessionId,
        serverName: hostname(),
      } satisfies PairResponse)
      broadcastState()
      return
    }
    if (req.method === "POST" && url.pathname === "/api/auth/ws-ticket") {
      const sessionId = authorize(req)
      if (!sessionId) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      sendJson(res, 200, issueTicket(sessionId) satisfies WsTicketResponse)
      return
    }
    if (req.method === "GET" && url.pathname === "/network-info") {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      sendJson(res, 200, networkInfo())
      return
    }
    if (req.method === "GET" && url.pathname === "/project-info") {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      try {
        const path = url.searchParams.get("path") ?? ""
        if (path.trim() === "") throw new Error("path is required")
        sendJson(res, 200, inspectProject(path))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    res.writeHead(404)
    res.end()
  }

  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" })
      else res.end()
    })
  })

  const wss = new WebSocketServer({ noServer: true })

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    const ticket = url.searchParams.get("ticket")
    if (url.pathname !== "/ws" || (!isLoopback(req) && (!ticket || !consumeTicket(ticket)))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
  })

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
        handle(msg, socket)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        socket.send(JSON.stringify({ type: "error", message } satisfies ServerMsg))
      }
    })
    socket.on("close", () => clients.delete(socket))
    socket.on("error", () => clients.delete(socket))
  })

  const handle = (msg: ClientMsg, socket: WebSocket): void => {
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
        applyBindHost()
        return
      case "createPairingToken": {
        const pairing: PairingInfo = { ...createPairingToken(), port, hosts: networkInfo() }
        socket.send(JSON.stringify({ type: "pairingToken", pairing } satisfies ServerMsg))
        return
      }
      case "revokeAuthSession":
        revokeSession(msg.id)
        broadcastState()
        return
      case "getHistoryReplay": {
        const replay = loadHistoryReplay(msg.runId, loadSettings())
        socket.send(JSON.stringify({ type: "historyReplay", runId: msg.runId, ...replay } satisfies ServerMsg))
        return
      }
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

  listen()
  httpServer.on("error", (error) => {
    process.stderr.write(`failed to listen on ${port}: ${error.message}\n`)
    process.exit(1)
  })
}
