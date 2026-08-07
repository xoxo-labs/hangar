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

export function loadHistory(settings: AppSettings): SessionHistoryEntry[] {
  if (!settings.sessionHistory.enabled) return []
  try {
    const parsed = JSON.parse(readFileSync(historyPath(), "utf8")) as unknown
    if (!Array.isArray(parsed)) return []
    return prune(parsed as SessionHistoryEntry[], settings)
  } catch {
    return []
  }
}

export function appendHistory(entry: SessionHistoryEntry, settings: AppSettings): void {
  if (!settings.sessionHistory.enabled) return
  const entries = prune([entry, ...loadHistory(settings)], settings).slice(0, MAX_ENTRIES)
  mkdirSync(hangarHome(), { recursive: true })
  const path = historyPath()
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 })
  renameSync(temporary, path)
  pruneReplays(new Set(entries.filter((item) => item.hasReplay).map((item) => item.runId)), settings)
}

export function loadHistoryReplay(runId: string, settings: AppSettings): { events: HistoryOutputEvent[]; truncated: boolean } {
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
    .filter((entry) =>
      typeof entry?.runId === "string" &&
      typeof entry?.endedAt === "number" &&
      entry.endedAt >= cutoff,
    )
    .sort((a, b) => b.startedAt - a.startedAt)
}
