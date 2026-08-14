/**
 * One store for every paired machine. Messages arrive already scoped, so the
 * world below can hold N machines without their ids colliding.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"
import type { ConnectionConfig, ConnectionStatus } from "@hangar/client-core"
import type { ServerMsg } from "@hangar/contracts"
import { create } from "zustand"
import { DEFAULT_MODE, MODE_KEY, type ViewMode } from "./mode"
import {
  applyExit,
  applyMetrics,
  applyOutput,
  applySnapshot,
  applyState,
  dropScope,
  EMPTY_WORLD,
  keepSelection,
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
  /** Stored state has been read: an empty machine list now means "none". */
  ready: boolean
  /** How the home screen groups things — by machine or by project. */
  mode: ViewMode
  /**
   * Which session the right pane is showing, at iPad widths. A phone ignores
   * it: there the session is a screen you push, not a pane you point at.
   */
  selectedSessionId: string | null
  setMode: (mode: ViewMode) => void
  select: (id: string | null) => void
  setConfigs: (configs: ConnectionConfig[]) => void
  setStatus: (connId: string, status: ConnectionStatus, error: string | null) => void
  ingest: (connId: string, msg: ServerMsg) => void
  setReady: (mode: ViewMode) => void
}

export const useStore = create<Store>((set) => ({
  world: EMPTY_WORLD,
  machines: [],
  ready: false,
  mode: DEFAULT_MODE,
  selectedSessionId: null,

  setMode: (mode) => {
    set({ mode })
    // Fire and forget: a preference that fails to save is not worth an error.
    void AsyncStorage.setItem(MODE_KEY, mode).catch(() => {})
  },

  // Where you are looking is not a preference: a relaunch starts with an empty
  // pane rather than a log from yesterday.
  select: (id) => set({ selectedSessionId: id }),

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
      return { machines, world, selectedSessionId: keepSelection(world, store.selectedSessionId) }
    }),

  setStatus: (connId, status, error) =>
    set((store) => ({
      machines: store.machines.map((machine) =>
        machine.config.id === connId ? { ...machine, status, error } : machine,
      ),
    })),

  setReady: (mode) => set({ ready: true, mode }),

  ingest: (connId, msg) =>
    set((store) => {
      switch (msg.type) {
        case "state": {
          // The only message that can take a process away: a machine that no
          // longer lists what the pane is showing clears the selection with it.
          const world = applyState(store.world, connId, msg)
          return {
            world,
            selectedSessionId: keepSelection(world, store.selectedSessionId),
            machines: store.machines.map((machine) =>
              machine.config.id === connId ? { ...machine, serverName: msg.serverName ?? machine.serverName } : machine,
            ),
          }
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
