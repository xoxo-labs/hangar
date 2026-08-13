/**
 * One store for every paired machine. Messages arrive already scoped, so the
 * world below can hold N machines without their ids colliding.
 */

import type { ConnectionConfig, ConnectionStatus } from "@hangar/client-core"
import type { ServerMsg } from "@hangar/contracts"
import { create } from "zustand"
import {
  applyExit,
  applyMetrics,
  applyOutput,
  applySnapshot,
  applyState,
  dropScope,
  EMPTY_WORLD,
  type World,
} from "./state"

export type Machine = {
  config: ConnectionConfig
  status: ConnectionStatus
  /** Why the machine is blocked or failing; null while it is healthy. */
  error: string | null
  serverName: string | null
}

type Store = {
  world: World
  /** Paired machines, in the order they were added. */
  machines: Machine[]
  /** The stored machine list has been read: an empty list now means "none". */
  ready: boolean
  setConfigs: (configs: ConnectionConfig[]) => void
  setStatus: (connId: string, status: ConnectionStatus, error: string | null) => void
  ingest: (connId: string, msg: ServerMsg) => void
  setReady: () => void
}

export const useStore = create<Store>((set) => ({
  world: EMPTY_WORLD,
  machines: [],
  ready: false,

  setConfigs: (configs) =>
    set((store) => {
      const known = new Map(store.machines.map((machine) => [machine.config.id, machine]))
      const machines = configs.map((config) => {
        const machine = known.get(config.id)
        return machine
          ? { ...machine, config }
          : { config, status: "connecting" as const, error: null, serverName: null }
      })
      // A machine that is gone from the config list takes its slice with it.
      const live = new Set(configs.map((config) => config.id))
      let world = store.world
      for (const machine of store.machines)
        if (!live.has(machine.config.id)) world = dropScope(world, machine.config.id)
      return { machines, world }
    }),

  setStatus: (connId, status, error) =>
    set((store) => ({
      machines: store.machines.map((machine) =>
        machine.config.id === connId ? { ...machine, status, error } : machine,
      ),
    })),

  setReady: () => set({ ready: true }),

  ingest: (connId, msg) =>
    set((store) => {
      switch (msg.type) {
        case "state":
          return {
            world: applyState(store.world, connId, msg),
            machines: store.machines.map((machine) =>
              machine.config.id === connId ? { ...machine, serverName: msg.serverName ?? machine.serverName } : machine,
            ),
          }
        case "metrics":
          return { world: applyMetrics(store.world, msg.id, msg.metrics, Date.now()) }
        case "snapshot":
          return { world: applySnapshot(store.world, msg.id, msg.data) }
        case "output":
          return { world: applyOutput(store.world, msg.id, msg.data) }
        case "exit":
          return { world: applyExit(store.world, msg.id, msg.exitCode) }
        default:
          return {}
      }
    }),
}))

/** What the UI calls a machine: its label, else the hostname it reported, else its address. */
export function machineLabel(machine: Machine): string {
  return machine.config.label.trim() || machine.serverName || machine.config.host
}

export function machineOf(machines: Machine[], connId: string | undefined): Machine | undefined {
  return machines.find((machine) => machine.config.id === connId)
}
