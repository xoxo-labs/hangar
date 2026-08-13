import type { ClientMsg, ServerMsg, WsTicketResponse } from "@hangar/contracts"
import type { ConnectionConfig, ConnectionStatus } from "./types"

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
/** A connection that stayed up this long starts its next retry ladder from the bottom. */
const HEALTHY_MS = 30_000

export type SupervisorHooks = {
  onStatus: (connId: string, status: ConnectionStatus, error: string | null) => void
  onMessage: (connId: string, msg: ServerMsg) => void
}

export type Supervisor = {
  /** Replaces the config and reconnects; a token change also clears `blocked`. */
  configure: (config: ConnectionConfig) => void
  /** Explicit user action: clears `blocked`, resets the backoff, connects now. */
  retry: () => void
  /** Ambient wakeup (online / tab visible): only revives a blocked connection. */
  wake: () => void
  send: (msg: ClientMsg) => boolean
  dispose: () => void
}

/** A 401/403 from the ticket endpoint: the saved token is gone, retrying cannot help. */
class RejectedError extends Error {}

/**
 * Single retry owner for one machine: it holds the socket, the backoff ladder
 * and the transient-vs-blocked decision. Nothing else may open a socket.
 */
export function createSupervisor(initial: ConnectionConfig, hooks: SupervisorHooks): Supervisor {
  const id = initial.id
  let config = initial
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let opening = false
  let everConnected = false
  let live = false
  let blocked = false
  let disposed = false
  let connectedAt = 0
  /** Bumped whenever an in-flight attempt is superseded (retry, config change, dispose). */
  let generation = 0

  const status = (next: ConnectionStatus, error: string | null): void => {
    hooks.onStatus(id, next, error)
  }

  const drop = (): void => {
    generation += 1
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const current = socket
    socket = null
    opening = false
    live = false
    if (current !== null) {
      current.onopen = null
      current.onmessage = null
      current.onerror = null
      current.onclose = null
      current.close()
    }
  }

  const scheduleRetry = (): void => {
    if (disposed || blocked || timer !== null) return
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 1_000
    attempt += 1
    status("reconnecting", null)
    timer = setTimeout(() => {
      timer = null
      void open()
    }, delay)
  }

  const httpBase = (): string => `${config.secure ? "https" : "http"}://${config.host}:${config.port}`

  const fetchTicket = async (): Promise<string> => {
    const response = await fetch(`${httpBase()}/api/auth/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
    })
    if (response.status === 401 || response.status === 403) {
      throw new RejectedError("This machine rejected the saved pairing. Pair again to reconnect.")
    }
    if (!response.ok) throw new Error(`Ticket request failed (${response.status})`)
    const body = (await response.json()) as WsTicketResponse
    if (typeof body.ticket !== "string" || body.ticket === "") throw new Error("Malformed ticket response")
    return body.ticket
  }

  const open = async (): Promise<void> => {
    if (disposed || blocked || opening || socket !== null) return
    opening = true
    const mine = generation
    status(everConnected ? "reconnecting" : "connecting", null)

    let url = `${config.secure ? "wss" : "ws"}://${config.host}:${config.port}/ws`
    if (config.token !== undefined) {
      try {
        const ticket = await fetchTicket()
        url += `?ticket=${encodeURIComponent(ticket)}`
      } catch (error) {
        if (disposed || mine !== generation) return
        opening = false
        if (error instanceof RejectedError) {
          blocked = true
          status("blocked", error.message)
          return
        }
        scheduleRetry()
        return
      }
      if (disposed || mine !== generation) return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      opening = false
      scheduleRetry()
      return
    }
    socket = ws
    opening = false

    ws.onopen = () => {
      if (socket !== ws) return
      everConnected = true
    }

    ws.onmessage = (event) => {
      if (socket !== ws || typeof event.data !== "string") return
      let msg: ServerMsg
      try {
        msg = JSON.parse(event.data) as ServerMsg
      } catch {
        return
      }
      // "Connected" waits for the first state: an open socket that never speaks
      // is not a usable connection.
      if (!live && msg.type === "state") {
        live = true
        connectedAt = Date.now()
        status("connected", null)
      }
      hooks.onMessage(id, msg)
    }

    ws.onerror = () => {
      // `onclose` always follows; reconnection is handled there.
    }

    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      live = false
      if (disposed) return
      if (connectedAt !== 0 && Date.now() - connectedAt >= HEALTHY_MS) attempt = 0
      connectedAt = 0
      scheduleRetry()
    }
  }

  void open()

  return {
    configure: (next) => {
      config = next
      blocked = false
      attempt = 0
      drop()
      void open()
    },
    retry: () => {
      blocked = false
      attempt = 0
      drop()
      void open()
    },
    wake: () => {
      if (!blocked) return
      blocked = false
      attempt = 0
      drop()
      void open()
    },
    send: (msg) => {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(msg))
      return true
    },
    dispose: () => {
      disposed = true
      drop()
    },
  }
}
