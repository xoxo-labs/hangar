import type { ClientMsg, PairingInfo, ServerMsg } from "@hangar/contracts"
import { useStore } from "../store"
import { scopeInbound } from "./route"
import { LOCAL_CONN_ID } from "./scope"
import { createSupervisor, type Supervisor } from "./supervisor"
import type { ConnectionConfig } from "./types"

const STORAGE_KEY = "hangar.connections.v1"
/** A machine that does not answer `createPairingToken` this fast is not going to. */
const PAIRING_TIMEOUT_MS = 10_000

const supervisors = new Map<string, Supervisor>()
const pairingWaiters = new Map<string, Array<(pairing: PairingInfo) => void>>()

let dispatch: (connId: string, msg: ServerMsg) => void = () => {}
let started = false

/**
 * Starts every connection (the implicit local one plus the persisted paired
 * machines) and routes their messages, already scoped, into `handler`.
 * Idempotent: the supervisors own reconnection from here on.
 */
export function startConnections(handler: (connId: string, msg: ServerMsg) => void): void {
  dispatch = handler
  if (started) return
  started = true

  window.addEventListener("online", wakeAll)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeAll()
  })

  const store = useStore.getState()
  store.upsertConnection(localConfig())
  for (const config of loadStored()) store.upsertConnection(config)
  for (const connection of Object.values(useStore.getState().connections)) spawn(connection.config)
}

/** Local first, then paired machines in the order they were added. */
export function listConnections(): ConnectionConfig[] {
  return Object.values(useStore.getState().connections).map((connection) => connection.config)
}

export function addConnection(input: {
  label: string
  host: string
  port: number
  token: string
  secure?: boolean
}): ConnectionConfig {
  const config: ConnectionConfig = {
    id: newConnId(),
    label: input.label,
    host: input.host,
    port: input.port,
    secure: input.secure ?? false,
    token: input.token,
  }
  useStore.getState().upsertConnection(config)
  persist()
  spawn(config)
  return config
}

/** Drops the machine, its socket and every item scoped to it. The local connection stays. */
export function removeConnection(connId: string): void {
  if (connId === LOCAL_CONN_ID) return
  supervisors.get(connId)?.dispose()
  supervisors.delete(connId)
  pairingWaiters.delete(connId)
  useStore.getState().dropConnection(connId)
  persist()
}

/** A config or token change is itself a wakeup: the connection reconnects at once. */
export function updateConnection(connId: string, patch: Partial<Omit<ConnectionConfig, "id">>): void {
  const existing = useStore.getState().connections[connId]
  if (!existing) return
  const config = { ...existing.config, ...patch }
  useStore.getState().upsertConnection(config)
  if (connId !== LOCAL_CONN_ID) persist()
  const supervisor = supervisors.get(connId)
  if (supervisor) supervisor.configure(config)
  else spawn(config)
}

/** The "Retry" affordance behind a `blocked` connection. */
export function retryConnection(connId: string): void {
  supervisors.get(connId)?.retry()
}

/** False when the connection has no open socket; the message is dropped, as before. */
export function sendTo(connId: string, msg: ClientMsg): boolean {
  return supervisors.get(connId)?.send(msg) ?? false
}

/** Asks one machine for a one-time pairing code and resolves with its reply. */
export function requestPairingToken(connId: string): Promise<PairingInfo> {
  return new Promise((resolve, reject) => {
    if (!sendTo(connId, { type: "createPairingToken" })) {
      reject(new Error("That machine is not connected right now."))
      return
    }
    const timer = setTimeout(() => {
      remove()
      reject(new Error("Timed out waiting for a pairing code."))
    }, PAIRING_TIMEOUT_MS)
    const waiter = (pairing: PairingInfo): void => {
      clearTimeout(timer)
      remove()
      resolve(pairing)
    }
    const remove = (): void => {
      const waiting = pairingWaiters.get(connId)
      if (!waiting) return
      const at = waiting.indexOf(waiter)
      if (at !== -1) waiting.splice(at, 1)
    }
    const waiting = pairingWaiters.get(connId)
    if (waiting) waiting.push(waiter)
    else pairingWaiters.set(connId, [waiter])
  })
}

function spawn(config: ConnectionConfig): void {
  supervisors.get(config.id)?.dispose()
  supervisors.set(
    config.id,
    createSupervisor(config, {
      onStatus: (connId, status, error) => useStore.getState().setConnectionStatus(connId, status, error),
      onMessage: (connId, msg) => {
        // Scoping happens here, once, so nothing downstream sees a bare id.
        const scopedMsg = scopeInbound(connId, msg)
        if (scopedMsg.type === "pairingToken") {
          pairingWaiters.get(connId)?.[0]?.(scopedMsg.pairing)
          return
        }
        dispatch(connId, scopedMsg)
      },
    }),
  )
}

function wakeAll(): void {
  for (const supervisor of supervisors.values()) supervisor.wake()
}

/** The local server is wherever `readPort()` pointed the page. */
function localConfig(): ConnectionConfig {
  return {
    id: LOCAL_CONN_ID,
    label: "This Mac",
    host: "127.0.0.1",
    port: useStore.getState().port,
    secure: false,
  }
}

function newConnId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function loadStored(): ConnectionConfig[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConfig).map((config) => ({ ...config, secure: config.secure === true }))
  } catch {
    return []
  }
}

function isConfig(value: unknown): value is ConnectionConfig {
  if (typeof value !== "object" || value === null) return false
  const config = value as Partial<ConnectionConfig>
  return (
    typeof config.id === "string" &&
    config.id !== "" &&
    !config.id.includes(":") &&
    config.id !== LOCAL_CONN_ID &&
    typeof config.label === "string" &&
    typeof config.host === "string" &&
    typeof config.port === "number" &&
    typeof config.token === "string"
  )
}

function persist(): void {
  const remotes = listConnections().filter((config) => config.id !== LOCAL_CONN_ID)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remotes))
  } catch {
    // A full or blocked localStorage must not take the app down.
  }
}
