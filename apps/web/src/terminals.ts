import { DEFAULT_SETTINGS, type AppSettings, type SessionId } from "@hangar/contracts"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal, type IDecoration, type IMarker } from "@xterm/xterm"
import { useStore } from "./store"
import { send } from "./ws"

/*
 * xterm wants concrete colours, not CSS variables, so the tokens the terminal
 * shares with the app chrome are mirrored here: background/foreground must stay
 * equal to `--color-surface-1` and `--color-surface-12` in styles.css (Radix
 * mauve, steps 1 and 12, per theme). The pane's padding is painted by CSS and
 * the rest by xterm, so a mismatch shows up as a seam.
 */
const TERMINAL_THEMES = {
  dark: {
    background: "#121113",
    foreground: "#eeeef0",
    cursor: "#eeeef0",
    cursorAccent: "#121113",
    selectionBackground: "#3a4a63",
    scrollbarSliderBackground: "#77727e70",
    scrollbarSliderHoverBackground: "#aaa6b080",
    scrollbarSliderActiveBackground: "#d0cdd7a0",
  },
  light: {
    background: "#fdfcfd",
    foreground: "#211f26",
    cursor: "#211f26",
    cursorAccent: "#fdfcfd",
    selectionBackground: "#c2e5ff",
    scrollbarSliderBackground: "#10003332",
    scrollbarSliderHoverBackground: "#08003145",
    scrollbarSliderActiveBackground: "#05001d73",
  },
} as const

/** The html class is settled before any terminal exists, so it is the truth. */
export function currentTerminalTheme() {
  return TERMINAL_THEMES[document.documentElement.classList.contains("dark") ? "dark" : "light"]
}

type Entry = {
  term: Terminal
  fit: FitAddon
  el: HTMLElement | null
  observer: ResizeObserver | null
  cols: number
  rows: number
  metricMarkers: Map<number, IMarker>
  metricDecoration: IDecoration | null
  decorationTimer: ReturnType<typeof setTimeout> | null
  metricSelectionListeners: Set<(range: MetricSelection | null) => void>
}

const entries = new Map<SessionId, Entry>()

/**
 * Terminals are created lazily — on the first snapshot/output for a session, or
 * when its tab is opened — and then kept alive until the session disappears.
 */
function ensure(id: SessionId): Entry {
  const existing = entries.get(id)
  if (existing) return existing

  const terminalSettings = useStore.getState().settings.terminal
  const term = new Terminal({
    fontSize: terminalSettings.fontSize ?? DEFAULT_SETTINGS.terminal.fontSize,
    fontFamily: terminalSettings.fontFamily ?? DEFAULT_SETTINGS.terminal.fontFamily,
    scrollback: 5000,
    cursorBlink: true,
    allowProposedApi: true,
    theme: currentTerminalTheme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.onData((data) => send({ type: "write", id, data }))
  term.onSelectionChange(() => {
    if (!useStore.getState().settings.terminal.copyOnSelect || !term.hasSelection()) return
    const selection = term.getSelection()
    const lineCount = selection.split(/\r?\n/).length
    void navigator.clipboard
      .writeText(selection)
      .then(() => useStore.getState().showNotice(`Copied ${lineCount} line${lineCount === 1 ? "" : "s"}`))
      .catch(() => {})
  })

  const entry: Entry = {
    term,
    fit,
    el: null,
    observer: null,
    cols: term.cols,
    rows: term.rows,
    metricMarkers: new Map(),
    metricDecoration: null,
    decorationTimer: null,
    metricSelectionListeners: new Set(),
  }
  term.onSelectionChange(() => notifyMetricSelection(entry))
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
  if (!fresh) {
    clearMetricPositions(entry)
    entry.term.write("\x1bc")
  }
  entry.term.write(data)
}

/** Associates a metrics sample with xterm's current line after pending output is parsed. */
export function recordMetricPosition(id: SessionId, sampledAt: number): void {
  const entry = ensure(id)
  entry.term.write("", () => {
    if (entries.get(id) !== entry) return
    const marker = entry.term.registerMarker()
    entry.metricMarkers.set(sampledAt, marker)
    marker.onDispose(() => entry.metricMarkers.delete(sampledAt))

    // Metric history only retains 450 samples; avoid holding older markers.
    while (entry.metricMarkers.size > 450) {
      entry.metricMarkers.values().next().value?.dispose()
    }
    notifyMetricSelection(entry)
  })
}

export type MetricSelection = { startSampledAt: number; endSampledAt: number }

/** Maps xterm's native line selection to the corresponding metrics time range. */
export function subscribeToMetricSelection(id: SessionId, listener: (range: MetricSelection | null) => void): () => void {
  const entry = ensure(id)
  entry.metricSelectionListeners.add(listener)
  notifyMetricSelection(entry)
  return () => entry.metricSelectionListeners.delete(listener)
}

function notifyMetricSelection(entry: Entry): void {
  const selection = entry.term.getSelectionPosition()
  let range: MetricSelection | null = null
  if (selection && entry.metricMarkers.size > 0) {
    // Selection and marker coordinates both refer to absolute buffer lines.
    const firstLine = Math.min(selection.start.y, selection.end.y)
    const lastLine = Math.max(selection.start.y, selection.end.y)
    const startSampledAt = nearestMetricAtLine(entry, firstLine)
    const endSampledAt = nearestMetricAtLine(entry, lastLine)
    if (startSampledAt !== null && endSampledAt !== null) {
      range = startSampledAt <= endSampledAt
        ? { startSampledAt, endSampledAt }
        : { startSampledAt: endSampledAt, endSampledAt: startSampledAt }
    }
  }
  for (const listener of entry.metricSelectionListeners) listener(range)
}

function nearestMetricAtLine(entry: Entry, line: number): number | null {
  let nearest: { sampledAt: number; distance: number } | null = null
  for (const [sampledAt, marker] of entry.metricMarkers) {
    if (marker.isDisposed || marker.line < 0) continue
    const distance = Math.abs(marker.line - line)
    if (nearest === null || distance < nearest.distance) nearest = { sampledAt, distance }
  }
  return nearest?.sampledAt ?? null
}

/** Scrolls to a sample's output line and briefly marks it with a subtle rule. */
export function scrollToMetricPosition(id: SessionId, sampledAt: number): boolean {
  const entry = entries.get(id)
  const marker = entry?.metricMarkers.get(sampledAt)
  if (!entry || !marker || marker.isDisposed || marker.line < 0) return false

  entry.term.scrollToLine(marker.line)
  entry.metricDecoration?.dispose()
  if (entry.decorationTimer !== null) clearTimeout(entry.decorationTimer)

  const decoration = entry.term.registerDecoration({ marker, width: entry.term.cols, layer: "top" }) ?? null
  entry.metricDecoration = decoration
  decoration?.onRender((element) => element.classList.add("metric-line-decoration"))
  entry.decorationTimer = setTimeout(() => {
    decoration?.dispose()
    if (entry.metricDecoration === decoration) entry.metricDecoration = null
    entry.decorationTimer = null
  }, 2_000)
  return true
}

function clearMetricPositions(entry: Entry): void {
  if (entry.decorationTimer !== null) clearTimeout(entry.decorationTimer)
  entry.decorationTimer = null
  entry.metricDecoration?.dispose()
  entry.metricDecoration = null
  for (const marker of entry.metricMarkers.values()) marker.dispose()
  entry.metricMarkers.clear()
  for (const listener of entry.metricSelectionListeners) listener(null)
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

/** Repaints every live terminal when the app theme flips. */
export function applyTerminalTheme(resolved: "light" | "dark"): void {
  const theme = TERMINAL_THEMES[resolved]
  for (const entry of entries.values()) {
    entry.term.options.theme = theme
  }
}

/** Applies appearance changes to existing terminals and recalculates their PTY size. */
export function applyTerminalSettings(settings: AppSettings["terminal"]): void {
  const fontFamily = settings.fontFamily ?? DEFAULT_SETTINGS.terminal.fontFamily
  const fontSize = settings.fontSize ?? DEFAULT_SETTINGS.terminal.fontSize
  for (const [id, entry] of entries) {
    if (entry.term.options.fontFamily === fontFamily && entry.term.options.fontSize === fontSize) continue
    entry.term.options.fontFamily = fontFamily
    entry.term.options.fontSize = fontSize
    fitTerminal(id)
  }
}

export function hasTerminalSelection(id: SessionId): boolean {
  return entries.get(id)?.term.hasSelection() ?? false
}

export async function copyTerminalSelection(id: SessionId): Promise<number> {
  const text = entries.get(id)?.term.getSelection() ?? ""
  if (!text) return 0
  await navigator.clipboard.writeText(text)
  return text.split("\n").length
}

export async function copyTerminalOutput(id: SessionId, lastLines?: number): Promise<number> {
  const term = entries.get(id)?.term
  if (!term) return 0
  const buffer = term.buffer.active
  let end = buffer.length
  while (end > 0 && !(buffer.getLine(end - 1)?.translateToString(true) ?? "")) end -= 1
  const start = lastLines === undefined ? 0 : Math.max(0, end - lastLines)
  const lines: string[] = []
  for (let index = start; index < end; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "")
  }
  if (lines.length === 0) return 0
  if (lastLines !== undefined) {
    term.selectLines(start, lines.length)
    term.scrollToLine(start)
  }
  await navigator.clipboard.writeText(lines.join("\n"))
  return lines.length
}

export function clearTerminal(id: SessionId): void {
  const entry = entries.get(id)
  if (!entry) return
  clearMetricPositions(entry)
  entry.term.clear()
}

export function disposeTerminal(id: SessionId): void {
  const entry = entries.get(id)
  if (!entry) return
  entry.observer?.disconnect()
  clearMetricPositions(entry)
  entry.term.dispose()
  entries.delete(id)
  useStore.getState().dropTerminal(id)
}
