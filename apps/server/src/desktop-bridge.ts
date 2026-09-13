import type { DesktopUpdateAction, DesktopUpdateState } from "@hangar/contracts"

/**
 * The server's line to the desktop app that spawned it, when there is one.
 * Electron opens a Node IPC channel on the server child; over it the app pushes
 * its updater state and the server relays update requests from any connected
 * client — a paired Mac included, which is how one machine updates another.
 * Without a channel (headless `hangar serve`, `pnpm dev`) there is no updater
 * to speak of: the state stays null and requests are refused.
 */

/** App → server. */
export type DesktopToServer = { type: "desktopUpdateState"; state: DesktopUpdateState }

/** Server → app. */
export type ServerToDesktop = { type: "hello" } | { type: "desktopUpdate"; action: DesktopUpdateAction }

export type DesktopBridge = {
  /** The updater as last reported; null when no desktop app supervises this server. */
  state: () => DesktopUpdateState | null
  /** Forwards a client's request to the app; throws when nothing can act on it. */
  request: (action: DesktopUpdateAction) => void
}

export function connectDesktopBridge(onChange: () => void): DesktopBridge {
  const send = process.send?.bind(process)
  if (send === undefined) {
    return {
      state: () => null,
      request: () => {
        throw new Error("No desktop app supervises this server, so there is nothing to update")
      },
    }
  }

  let state: DesktopUpdateState | null = null
  process.on("message", (raw: unknown) => {
    const msg = raw as Partial<DesktopToServer> | null
    if (msg?.type !== "desktopUpdateState" || msg.state === undefined) return
    state = msg.state
    onChange()
  })
  // The app may have broadcast before this listener existed; ask for a fresh
  // snapshot rather than trust the channel to have queued it.
  send({ type: "hello" } satisfies ServerToDesktop)

  return {
    state: () => state,
    request: (action) => {
      send({ type: "desktopUpdate", action } satisfies ServerToDesktop)
    },
  }
}
