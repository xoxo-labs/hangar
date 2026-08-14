/**
 * Where the platform-free manager meets React Native: AsyncStorage for the
 * paired machines, `AppState` for wakeups. A phone has no `online` event and no
 * tab visibility — coming back to the foreground is the wakeup that matters.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"
import { AppState } from "react-native"
import { createManager, type Manager } from "./manager"
import { MODE_KEY, parseMode, type ViewMode } from "./mode"
import { useStore } from "./store"

let manager: Manager | null = null
let started = false

export function connections(): Manager {
  if (manager) return manager
  manager = createManager({
    storage: AsyncStorage,
    onMessage: (connId, msg) => useStore.getState().ingest(connId, msg),
    onStatus: (connId, status, error) => useStore.getState().setStatus(connId, status, error),
    onConfigs: (configs) => useStore.getState().setConfigs(configs),
  })
  return manager
}

/** Called once from the root layout. The supervisors own reconnection from here on. */
export function startConnections(): void {
  if (started) return
  started = true
  const active = connections()
  void Promise.all([active.start(), readMode()]).then(([, mode]) => useStore.getState().setReady(mode))
  AppState.addEventListener("change", (state) => {
    if (state === "active") active.wake()
  })
}

/** A device with no preference stored yet, or an unreadable one, gets the default. */
async function readMode(): Promise<ViewMode> {
  try {
    return parseMode(await AsyncStorage.getItem(MODE_KEY))
  } catch {
    return parseMode(null)
  }
}
