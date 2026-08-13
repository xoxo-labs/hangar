/**
 * The phone's connection manager: the same shared supervisor the desktop app
 * runs, with AsyncStorage in place of localStorage and no implicit local
 * connection — a phone only knows the machines it has paired with.
 *
 * Nothing in here imports React Native: storage is injected and wakeups are
 * pushed in from outside, so the whole layer runs headless under `node`.
 */

import {
  type ConnectionConfig,
  type ConnectionStatus,
  createSupervisor,
  routeOutbound,
  scopeInbound,
  type Supervisor,
} from "@hangar/client-core"
import type { ClientMsg, ServerMsg } from "@hangar/contracts"

/** Same key and same JSON shape as the desktop app, so the mental model matches. */
export const STORAGE_KEY = "hangar.connections.v1"

/** The slice of AsyncStorage this layer needs (and all a test has to fake). */
export type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

export type ManagerHooks = {
  storage: Storage
  /** Already scoped: no bare server id ever leaves this module. */
  onMessage: (connId: string, msg: ServerMsg) => void
  onStatus: (connId: string, status: ConnectionStatus, error: string | null) => void
  /** The persisted machine list changed (added, removed, renamed, loaded). */
  onConfigs: (configs: ConnectionConfig[]) => void
}

export type NewConnection = {
  label: string
  host: string
  port: number
  token: string
  secure?: boolean
}

export type Manager = {
  /** Loads the stored machines and starts a supervisor for each. Idempotent. */
  start: () => Promise<void>
  configs: () => ConnectionConfig[]
  add: (input: NewConnection) => Promise<ConnectionConfig>
  remove: (connId: string) => Promise<void>
  update: (connId: string, patch: Partial<Omit<ConnectionConfig, "id">>) => Promise<void>
  /** Explicit "Retry" from the UI: clears `blocked` and reconnects now. */
  retry: (connId: string) => void
  /** Ambient wakeup (the app came back to the foreground): revives blocked machines. */
  wake: () => void
  /** Routes a scoped message to the machine that owns it. */
  send: (msg: ClientMsg) => boolean
  sendTo: (connId: string, msg: ClientMsg) => boolean
  dispose: () => void
}

export function createManager(hooks: ManagerHooks): Manager {
  const configs = new Map<string, ConnectionConfig>()
  const supervisors = new Map<string, Supervisor>()
  let started = false

  const publish = (): void => hooks.onConfigs([...configs.values()])

  const persist = async (): Promise<void> => {
    try {
      await hooks.storage.setItem(STORAGE_KEY, JSON.stringify([...configs.values()]))
    } catch {
      // A phone with no room left must not take the app down.
    }
  }

  const spawn = (config: ConnectionConfig): void => {
    supervisors.get(config.id)?.dispose()
    supervisors.set(
      config.id,
      createSupervisor(config, {
        onStatus: hooks.onStatus,
        onMessage: (connId, msg) => hooks.onMessage(connId, scopeInbound(connId, msg)),
      }),
    )
  }

  return {
    start: async () => {
      if (started) return
      started = true
      for (const config of await loadStored(hooks.storage)) configs.set(config.id, config)
      publish()
      for (const config of configs.values()) spawn(config)
    },

    configs: () => [...configs.values()],

    add: async (input) => {
      const config: ConnectionConfig = {
        id: newConnId(),
        label: input.label,
        host: input.host,
        port: input.port,
        secure: input.secure ?? false,
        token: input.token,
      }
      configs.set(config.id, config)
      publish()
      await persist()
      spawn(config)
      return config
    },

    remove: async (connId) => {
      supervisors.get(connId)?.dispose()
      supervisors.delete(connId)
      configs.delete(connId)
      publish()
      await persist()
    },

    update: async (connId, patch) => {
      const existing = configs.get(connId)
      if (!existing) return
      const config = { ...existing, ...patch }
      configs.set(connId, config)
      publish()
      await persist()
      // A config change is itself a wakeup: `configure` clears `blocked`.
      const supervisor = supervisors.get(connId)
      if (supervisor) supervisor.configure(config)
      else spawn(config)
    },

    retry: (connId) => supervisors.get(connId)?.retry(),

    wake: () => {
      for (const supervisor of supervisors.values()) supervisor.wake()
    },

    send: (msg) => {
      let sent = false
      for (const outbound of routeOutbound(msg)) {
        sent = (supervisors.get(outbound.connId)?.send(outbound.msg) ?? false) || sent
      }
      return sent
    },

    sendTo: (connId, msg) => supervisors.get(connId)?.send(msg) ?? false,

    dispose: () => {
      for (const supervisor of supervisors.values()) supervisor.dispose()
      supervisors.clear()
      started = false
    },
  }
}

async function loadStored(storage: Storage): Promise<ConnectionConfig[]> {
  let raw: string | null
  try {
    raw = await storage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (raw === null) return []
  return parseStored(raw)
}

/** Defensive: the stored blob is user data on a device, not a trusted input. */
export function parseStored(raw: string): ConnectionConfig[] {
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
    typeof config.label === "string" &&
    typeof config.host === "string" &&
    config.host !== "" &&
    typeof config.port === "number" &&
    typeof config.token === "string" &&
    config.token !== ""
  )
}

export function newConnId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
