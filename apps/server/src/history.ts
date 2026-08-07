import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AppSettings, SessionHistoryEntry } from "@hangar/contracts"
import { hangarHome } from "./registry.ts"

const MAX_ENTRIES = 1_000

function historyPath(): string {
  return join(hangarHome(), "history.json")
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
