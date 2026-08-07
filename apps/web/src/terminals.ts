import type { SessionId } from "@hangar/contracts"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useStore } from "./store"
import { send } from "./ws"

/*
 * xterm wants concrete colours, not CSS variables, so the two tokens the
 * terminal shares with the app chrome are mirrored here: they must stay equal
 * to `--color-surface-1` and `--color-surface-12` in styles.css (Radix mauve
 * dark, steps 1 and 12). The pane's padding is painted by CSS and the rest by
 * xterm, so a mismatch shows up as a seam.
 */
export const TERMINAL_BACKGROUND = "#121113"
const TERMINAL_FOREGROUND = "#eeeef0"

type Entry = {
  term: Terminal
  fit: FitAddon
  el: HTMLElement | null
  observer: ResizeObserver | null
  cols: number
  rows: number
}

const entries = new Map<SessionId, Entry>()

/**
 * Terminals are created lazily — on the first snapshot/output for a session, or
 * when its tab is opened — and then kept alive until the session disappears.
 */
function ensure(id: SessionId): Entry {
  const existing = entries.get(id)
  if (existing) return existing

  const term = new Terminal({
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: true,
    theme: {
      background: TERMINAL_BACKGROUND,
      foreground: TERMINAL_FOREGROUND,
      cursor: TERMINAL_FOREGROUND,
      cursorAccent: TERMINAL_BACKGROUND,
      selectionBackground: "#3a4a63",
    },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.onData((data) => send({ type: "write", id, data }))

  const entry: Entry = { term, fit, el: null, observer: null, cols: term.cols, rows: term.rows }
  entries.set(id, entry)
  useStore.getState().noteTerminal(id)
  return entry
}

export function writeOutput(id: SessionId, data: string): void {
  ensure(id).term.write(data)
}

/**
 * Snapshots are the full scrollback and arrive again on every reconnect, so a
 * terminal that already has content is reset (`ESC c`) before being refilled.
 */
export function writeSnapshot(id: SessionId, data: string): void {
  const fresh = !entries.has(id)
  const entry = ensure(id)
  if (!fresh) entry.term.write("\x1bc")
  entry.term.write(data)
}

export function noteExit(id: SessionId, exitCode: number | null): void {
  const entry = entries.get(id)
  if (!entry) return
  const label = exitCode === null ? "signal" : `code ${exitCode}`
  entry.term.write(`\r\n\x1b[90m[hangar] process exited (${label})\x1b[0m\r\n`)
}

/** Mounts the session's terminal into `el` and keeps it fitted. */
export function attachTerminal(id: SessionId, el: HTMLElement): () => void {
  const entry = ensure(id)
  if (entry.el !== el) {
    entry.el = el
    entry.term.open(el)
  }

  entry.observer?.disconnect()
  const observer = new ResizeObserver(() => fitTerminal(id))
  observer.observe(el)
  entry.observer = observer
  fitTerminal(id)

  return () => {
    observer.disconnect()
    if (entry.observer === observer) entry.observer = null
  }
}

export function fitTerminal(id: SessionId): void {
  const entry = entries.get(id)
  if (!entry?.el) return
  // Hidden panes measure 0x0; fitting them would clamp the pty to 1x1.
  if (entry.el.clientWidth === 0 || entry.el.clientHeight === 0) return

  try {
    entry.fit.fit()
  } catch {
    return
  }

  const { cols, rows } = entry.term
  if (cols === entry.cols && rows === entry.rows) return
  entry.cols = cols
  entry.rows = rows
  send({ type: "resize", id, cols, rows })
}

export function focusTerminal(id: SessionId): void {
  entries.get(id)?.term.focus()
}

export function disposeTerminal(id: SessionId): void {
  const entry = entries.get(id)
  if (!entry) return
  entry.observer?.disconnect()
  entry.term.dispose()
  entries.delete(id)
  useStore.getState().dropTerminal(id)
}
