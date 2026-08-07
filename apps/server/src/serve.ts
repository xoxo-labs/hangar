import { createServer } from "node:http"
import { mkdirSync, watch } from "node:fs"
import { WebSocketServer, WebSocket } from "ws"
import type { ClientMsg, Project, ServerMsg } from "@hangar/contracts"
import { findProject, hangarHome, loadRegistry } from "./registry.ts"
import { SessionManager } from "./sessions.ts"

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
    try {
      projects = loadRegistry().projects
    } catch (error) {
      broadcast({ type: "error", message: String(error) })
      projects = []
    }
    return { type: "state", projects, sessions: manager.list() }
  }
  const broadcastState = (): void => broadcast(stateMsg())

  const manager = new SessionManager(broadcast, broadcastState)

  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("ok")
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
      case "write":
        manager.write(msg.id, msg.data)
        return
      case "resize":
        manager.resize(msg.id, msg.cols, msg.rows)
        return
      case "dismiss":
        manager.dismiss(msg.id)
        return
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
