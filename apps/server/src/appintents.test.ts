import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { appIntentsDir, type AppIntentsCommand, watchAppIntentsCommands } from "./appintents.ts"

/** The bridge is a no-op off macOS, so the whole file only means anything there. */
const darwin = process.platform === "darwin"

function storeFixture(t: TestContext): string {
  const previous = process.env.HANGAR_APPINTENTS_DIR
  const dir = mkdtempSync(join(tmpdir(), "hangar-appintents-"))
  process.env.HANGAR_APPINTENTS_DIR = dir
  t.after(() => {
    if (previous === undefined) delete process.env.HANGAR_APPINTENTS_DIR
    else process.env.HANGAR_APPINTENTS_DIR = previous
  })
  return dir
}

/** Writes a command under a name that sorts against issuedAt, as UUIDs do. */
function writeCommand(dir: string, fileName: string, command: AppIntentsCommand): void {
  writeFileSync(join(dir, `${fileName}.json`), JSON.stringify(command))
}

test("HANGAR_APPINTENTS_DIR overrides the location under HANGAR_HOME", (t) => {
  const dir = storeFixture(t)
  assert.equal(appIntentsDir(), dir)
})

test("pending commands drain in issuedAt order, not file-name order", { skip: !darwin }, (t) => {
  const dir = storeFixture(t)
  mkdirSync(join(dir, "Commands"), { recursive: true })

  // Names deliberately sort the opposite way round from the timestamps.
  writeCommand(join(dir, "Commands"), "aaa", {
    kind: "start-process",
    targetId: "demo/last",
    issuedAt: "2026-08-19T12:00:02.000Z",
  })
  writeCommand(join(dir, "Commands"), "zzz", {
    kind: "start-process",
    targetId: "demo/first",
    issuedAt: "2026-08-19T12:00:01.000Z",
  })

  const executed: string[] = []
  const watcher = watchAppIntentsCommands((command) => executed.push(command.targetId))
  t.after(() => watcher?.close())

  assert.deepEqual(executed, ["demo/first", "demo/last"])
  // Draining consumes the queue: the disk holds only what is still pending.
  assert.deepEqual(readdirSync(join(dir, "Commands")), [])
})

test("a command with no issuedAt still runs, after the timestamped ones", { skip: !darwin }, (t) => {
  const dir = storeFixture(t)
  mkdirSync(join(dir, "Commands"), { recursive: true })

  writeCommand(join(dir, "Commands"), "aaa", { kind: "start-project", targetId: "demo" })
  writeCommand(join(dir, "Commands"), "bbb", {
    kind: "start-project",
    targetId: "hangar",
    issuedAt: "2026-08-19T12:00:00.000Z",
  })

  const executed: string[] = []
  const watcher = watchAppIntentsCommands((command) => executed.push(command.targetId))
  t.after(() => watcher?.close())

  assert.deepEqual(executed, ["hangar", "demo"])
})

test("a half-written command survives the drain and is retried later", { skip: !darwin }, (t) => {
  const dir = storeFixture(t)
  mkdirSync(join(dir, "Commands"), { recursive: true })

  writeFileSync(join(dir, "Commands", "partial.json"), '{"kind":"start-pro')
  writeCommand(join(dir, "Commands"), "whole", {
    kind: "start-project",
    targetId: "demo",
    issuedAt: "2026-08-19T12:00:00.000Z",
  })

  const executed: string[] = []
  const watcher = watchAppIntentsCommands((command) => executed.push(command.targetId))
  t.after(() => watcher?.close())

  assert.deepEqual(executed, ["demo"])
  assert.deepEqual(readdirSync(join(dir, "Commands")), ["partial.json"])
})
