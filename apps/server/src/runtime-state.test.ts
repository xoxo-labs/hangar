import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { clearRuntimeState, readRuntimeState, runtimeStatePath, writeRuntimeState } from "./runtime-state.ts"

/** A pid that has certainly exited: the child is reaped before we ever use it. */
const DEAD_PID = spawnSync(process.execPath, ["-e", ""]).pid

function homeFixture(t: TestContext, { create = true } = {}): string {
  const previous = process.env.HANGAR_HOME
  const home = create
    ? mkdtempSync(join(tmpdir(), "hangar-runtime-"))
    : join(mkdtempSync(join(tmpdir(), "hangar-runtime-")), "nested", "home")
  process.env.HANGAR_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.HANGAR_HOME
    else process.env.HANGAR_HOME = previous
  })
  return home
}

test("a written marker round-trips through the live pid check", (t) => {
  const home = homeFixture(t)
  const before = Date.now()
  writeRuntimeState("127.0.0.1", 4780)

  assert.equal(runtimeStatePath(), join(home, "server-runtime.json"))
  const state = readRuntimeState()
  assert.ok(state)
  assert.equal(state.version, 1)
  assert.equal(state.pid, process.pid)
  assert.equal(state.host, "127.0.0.1")
  assert.equal(state.port, 4780)
  assert.ok(state.startedAt >= before && state.startedAt <= Date.now())

  // The rename is atomic: no half-written temporary is left behind.
  assert.deepEqual(readdirSync(home), ["server-runtime.json"])
})

test("writing creates HANGAR_HOME when the server starts fresh", (t) => {
  homeFixture(t, { create: false })
  writeRuntimeState("0.0.0.0", 4781)
  assert.equal(readRuntimeState()?.port, 4781)
})

test("a rewrite replaces the previous marker", (t) => {
  homeFixture(t)
  writeRuntimeState("127.0.0.1", 4780)
  writeRuntimeState("100.90.1.5", 4890)
  assert.equal(readRuntimeState()?.host, "100.90.1.5")
  assert.equal(readRuntimeState()?.port, 4890)
})

test("unreadable, malformed and stale markers all read as nothing running", (t) => {
  homeFixture(t)
  assert.equal(readRuntimeState(), null)

  const cases: string[] = [
    "not json at all",
    "",
    JSON.stringify({ version: 2, pid: process.pid, host: "127.0.0.1", port: 4780, startedAt: 0 }),
    JSON.stringify({ version: 1, pid: "12", host: "127.0.0.1", port: 4780, startedAt: 0 }),
    JSON.stringify({ version: 1, pid: process.pid, port: 4780, startedAt: 0 }),
    JSON.stringify({ version: 1, pid: process.pid, host: "127.0.0.1", port: "4780", startedAt: 0 }),
    // Well-formed, but the process behind it is gone — a SIGKILLed server.
    JSON.stringify({ version: 1, pid: DEAD_PID, host: "127.0.0.1", port: 4780, startedAt: Date.now() }),
  ]
  for (const raw of cases) {
    writeFileSync(runtimeStatePath(), raw)
    assert.equal(readRuntimeState(), null, raw)
  }
})

test("clearing removes our own marker and tolerates a missing one", (t) => {
  homeFixture(t)
  writeRuntimeState("127.0.0.1", 4780)
  clearRuntimeState()
  assert.equal(existsSync(runtimeStatePath()), false)
  assert.equal(readRuntimeState(), null)
  clearRuntimeState()
})

test("a restarting server never clears its successor's marker", (t) => {
  homeFixture(t)
  const foreign = JSON.stringify({ version: 1, pid: process.pid + 1, host: "127.0.0.1", port: 4780, startedAt: 1 })
  writeFileSync(runtimeStatePath(), foreign)
  clearRuntimeState()
  assert.equal(readFileSync(runtimeStatePath(), "utf8"), foreign)

  // Garbage is not ours either, so it stays for a human to look at.
  writeFileSync(runtimeStatePath(), "{oops")
  clearRuntimeState()
  assert.equal(readFileSync(runtimeStatePath(), "utf8"), "{oops")
})
