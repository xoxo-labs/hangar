import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AppSettings, HistoryOutputEvent, SessionHistoryEntry } from "@hangar/contracts"
import { hangarHome } from "./registry.ts"

const MAX_ENTRIES = 1_000

function historyPath(): string {
  return join(hangarHome(), "history.json")
}

function replayDirectory(): string {
  return join(hangarHome(), "history-replays")
}

/** Path used only with server-generated UUIDs or run ids validated against history. */
export function historyReplayPath(runId: string): string {
  return join(replayDirectory(), `${runId}.jsonl`)
}

export function ensureReplayDirectory(): void {
  mkdirSync(replayDirectory(), { recursive: true, mode: 0o700 })
}

/**
 * Parsed history.json, reused until the file changes on disk. stateMsg() calls
 * loadHistory on every broadcast, and re-parsing up to a thousand runs' metric
 * timelines each time was pure GC pressure.
 */
let cache: { mtimeMs: number; size: number; entries: SessionHistoryEntry[] } | null = null

function readEntries(): SessionHistoryEntry[] {
  try {
    const stats = statSync(historyPath())
    if (cache && cache.mtimeMs === stats.mtimeMs && cache.size === stats.size) return cache.entries
    const parsed = JSON.parse(readFileSync(historyPath(), "utf8")) as unknown
    const entries = Array.isArray(parsed) ? (parsed as SessionHistoryEntry[]) : []
    cache = { mtimeMs: stats.mtimeMs, size: stats.size, entries }
    return entries
  } catch {
    return []
  }
}

function saveHistory(entries: SessionHistoryEntry[]): void {
  mkdirSync(hangarHome(), { recursive: true })
  const path = historyPath()
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 })
  renameSync(temporary, path)
  // mtime alone could alias a same-millisecond rewrite; drop rather than risk it.
  cache = null
}

export function loadHistory(settings: AppSettings): SessionHistoryEntry[] {
  if (!settings.sessionHistory.enabled) return []
  return prune(readEntries(), settings)
}

export function appendHistory(entry: SessionHistoryEntry, settings: AppSettings): void {
  if (!settings.sessionHistory.enabled) return
  const entries = prune([entry, ...loadHistory(settings)], settings).slice(0, MAX_ENTRIES)
  saveHistory(entries)
  pruneReplays(new Set(entries.filter((item) => item.hasReplay).map((item) => item.runId)), settings)
}

/**
 * Remove one run from history along with its private replay capture. The
 * session log on disk (`logPath`) belongs to the user and stays. Works on the
 * raw file, past the enabled/retention gates: a run you can still see, you can
 * delete.
 */
export function deleteHistoryRun(runId: string): boolean {
  const entries = readEntries()
  const entry = entries.find((item) => item.runId === runId)
  if (!entry) return false
  saveHistory(entries.filter((item) => item !== entry))
  // The id was validated against history above, so the replay path cannot be
  // steered outside the replay directory by a hostile runId.
  try {
    unlinkSync(historyReplayPath(entry.runId))
  } catch {}
  return true
}

export function loadHistoryReplay(
  runId: string,
  settings: AppSettings,
): { events: HistoryOutputEvent[]; truncated: boolean } {
  const entry = loadHistory(settings).find((item) => item.runId === runId)
  if (!entry?.hasReplay) return { events: [], truncated: false }
  try {
    const events = readFileSync(historyReplayPath(entry.runId), "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line): HistoryOutputEvent[] => {
        try {
          const value = JSON.parse(line) as Partial<HistoryOutputEvent>
          return typeof value.timestamp === "number" && typeof value.data === "string"
            ? [{ timestamp: value.timestamp, data: value.data }]
            : []
        } catch {
          return []
        }
      })
    return { events, truncated: entry.replayTruncated ?? false }
  } catch {
    return { events: [], truncated: entry.replayTruncated ?? false }
  }
}

function pruneReplays(retained: Set<string>, settings: AppSettings): void {
  const days = settings.sessionHistory.retentionDays
  if (days === null) return
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    for (const name of readdirSync(replayDirectory())) {
      if (!name.endsWith(".jsonl")) continue
      const runId = name.slice(0, -".jsonl".length)
      const path = join(replayDirectory(), name)
      // A fresh unlisted file may belong to a run that is still active.
      if (!retained.has(runId) && statSync(path).mtimeMs < cutoff) unlinkSync(path)
    }
  } catch {}
}

function prune(entries: SessionHistoryEntry[], settings: AppSettings): SessionHistoryEntry[] {
  const days = settings.sessionHistory.retentionDays
  const cutoff = days === null ? 0 : Date.now() - days * 24 * 60 * 60 * 1000
  return entries
    .filter(
      (entry) => typeof entry?.runId === "string" && typeof entry?.endedAt === "number" && entry.endedAt >= cutoff,
    )
    .sort((a, b) => b.startedAt - a.startedAt)
}
