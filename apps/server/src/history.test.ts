import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import type { AppSettings, SessionHistoryEntry } from "@hangar/contracts"
import { deleteHistoryRun, historyReplayPath, loadHistory } from "./history.ts"

const settings = { sessionHistory: { enabled: true, retentionDays: null } } as AppSettings

function homeFixture(t: TestContext): string {
  const previous = process.env.HANGAR_HOME
  const home = mkdtempSync(join(tmpdir(), "hangar-history-"))
  process.env.HANGAR_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.HANGAR_HOME
    else process.env.HANGAR_HOME = previous
  })
  return home
}

function entryFixture(runId: string, overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    runId,
    id: "demo/dev",
    project: "demo",
    process: "dev",
    cmd: "npm run dev",
    startedAt: 1_000,
    endedAt: 2_000,
    durationMs: 1_000,
    exitCode: 0,
    reason: "completed",
    peakCpuPercent: 1,
    peakMemoryBytes: 1,
    totalOutputBytes: 1,
    ...overrides,
  }
}

function writeHistoryFile(home: string, entries: SessionHistoryEntry[]): void {
  writeFileSync(join(home, "history.json"), JSON.stringify(entries, null, 2) + "\n")
}

test("deleting a run removes its entry and its replay file", (t) => {
  const home = homeFixture(t)
  writeHistoryFile(home, [
    entryFixture("r1", { hasReplay: true, startedAt: 2_000, endedAt: 3_000 }),
    entryFixture("r2"),
  ])
  mkdirSync(join(home, "history-replays"), { recursive: true })
  const replay = historyReplayPath("r1")
  writeFileSync(replay, JSON.stringify({ timestamp: 1_500, data: "hello" }) + "\n")

  assert.equal(loadHistory(settings).length, 2)
  assert.equal(deleteHistoryRun("r1"), true)

  assert.deepEqual(
    loadHistory(settings).map((entry) => entry.runId),
    ["r2"],
  )
  assert.equal(existsSync(replay), false)
  // The file on disk agrees with the cache, not just the in-memory view.
  const onDisk = JSON.parse(readFileSync(join(home, "history.json"), "utf8")) as SessionHistoryEntry[]
  assert.deepEqual(
    onDisk.map((entry) => entry.runId),
    ["r2"],
  )
})

test("deleting an unknown run touches nothing and reports it", (t) => {
  const home = homeFixture(t)
  writeHistoryFile(home, [entryFixture("r1")])
  assert.equal(deleteHistoryRun("missing"), false)
  assert.equal(loadHistory(settings).length, 1)
})

test("a hostile runId cannot reach outside the replay directory", (t) => {
  const home = homeFixture(t)
  writeHistoryFile(home, [entryFixture("r1")])
  const victim = join(home, "victim.txt")
  writeFileSync(victim, "precious")
  assert.equal(deleteHistoryRun("../victim.txt"), false)
  assert.equal(existsSync(victim), true)
})

test("the parse cache notices an external rewrite of history.json", (t) => {
  const home = homeFixture(t)
  writeHistoryFile(home, [entryFixture("r1")])
  assert.equal(loadHistory(settings).length, 1)
  // Different byte size on purpose: mtime alone can alias within a millisecond.
  writeHistoryFile(home, [entryFixture("r1"), entryFixture("r2-external")])
  assert.equal(loadHistory(settings).length, 2)
})
