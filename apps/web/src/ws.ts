import type { ClientMsg, ServerMsg } from "@hangar/contracts"
import { useStore } from "./store"
import { disposeTerminal, noteExit, writeOutput, writeSnapshot } from "./terminals"

const MIN_BACKOFF = 500
const MAX_BACKOFF = 5_000

let socket: WebSocket | null = null
let backoff = MIN_BACKOFF
let retry: ReturnType<typeof setTimeout> | null = null
/** First attempt reads as "connecting"; every later one as "reconnecting". */
let everConnected = false

function url(): string {
  return `ws://127.0.0.1:${useStore.getState().port}/ws`
}

export function connect(): void {
  if (retry !== null) {
    clearTimeout(retry)
    retry = null
  }
  if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  useStore.getState().setStatus(everConnected ? "reconnecting" : "connecting")

  const ws = new WebSocket(url())
  socket = ws

  ws.onopen = () => {
    if (socket !== ws) return
    everConnected = true
    backoff = MIN_BACKOFF
    useStore.getState().setStatus("connected")
    useStore.getState().setError(null)
  }

  ws.onmessage = (event) => {
    if (socket !== ws || typeof event.data !== "string") return
    let msg: ServerMsg
    try {
      msg = JSON.parse(event.data) as ServerMsg
    } catch {
      return
    }
    handle(msg)
  }

  ws.onerror = () => {
    // `onclose` always follows; reconnection is handled there.
  }

  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    useStore.getState().setStatus("reconnecting")
    retry = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF)
  }
}

function handle(msg: ServerMsg): void {
  const store = useStore.getState()
  switch (msg.type) {
    case "state": {
      const gone = store.sessions.filter((s) => !msg.sessions.some((next) => next.id === s.id))
      store.applyState(msg.projects, msg.sessions)
      for (const session of gone) disposeTerminal(session.id)
      return
    }
    case "snapshot":
      writeSnapshot(msg.id, msg.data)
      return
    case "output":
      writeOutput(msg.id, msg.data)
      return
    case "exit":
      noteExit(msg.id, msg.exitCode)
      return
    case "error":
      store.setError(msg.message)
      return
  }
}

export function send(msg: ClientMsg): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(msg))
}
