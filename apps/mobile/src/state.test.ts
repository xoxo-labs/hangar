import assert from "node:assert/strict"
import { test } from "node:test"
import { scoped } from "@hangar/client-core"
import type { Project, SessionInfo, SessionMetrics } from "@hangar/contracts"
import {
  applyExit,
  applyMetrics,
  applyOutput,
  applySnapshot,
  applyState,
  dropScope,
  EMPTY_WORLD,
  METRIC_WINDOW_MS,
  keepSelection,
  processCounts,
  projectsOf,
  sessionIdFor,
  splitSessionId,
  type StateMessage,
} from "./state.ts"

const A = "ca"
const B = "cb"

function project(connId: string, name: string, processes: string[]): Project {
  return {
    name: scoped(connId, name),
    path: `/tmp/${name}`,
    processes: processes.map((process) => ({ name: process, cmd: "pnpm dev" })),
  }
}

function session(connId: string, id: string, status: "running" | "exited" = "running"): SessionInfo {
  const [projectName = "", processName = ""] = id.split("/")
  return {
    id: scoped(connId, id),
    runId: scoped(connId, `${id}#1`),
    project: scoped(connId, projectName),
    process: processName,
    status,
    startedAt: 1,
    cmd: "pnpm dev",
  }
}

function state(connId: string, projects: Project[], sessions: SessionInfo[]): StateMessage {
  return { projects, sessions }
}

test("a machine's state replaces only its own slice", () => {
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev"])], [session(A, "web/dev")]))
  world = applyState(world, B, state(B, [project(B, "api", ["serve"])], [session(B, "api/serve")]))

  assert.deepEqual(
    world.projects.map((entry) => entry.name),
    ["ca::web", "cb::api"],
  )

  world = applyState(world, A, state(A, [project(A, "web", ["dev", "test"])], []))
  assert.deepEqual(
    world.projects.map((entry) => entry.name),
    ["cb::api", "ca::web"],
  )
  // B's session survived A's update.
  assert.deepEqual(
    world.sessions.map((entry) => entry.id),
    ["cb::api/serve"],
  )
})

test("known sessions keep their position across a reconnect snapshot", () => {
  const first = session(A, "web/dev")
  const second = session(A, "web/test")
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev", "test"])], [first, second]))
  world = applyState(world, A, state(A, [project(A, "web", ["dev", "test"])], [second, first]))
  assert.deepEqual(
    world.sessions.map((entry) => entry.id),
    ["ca::web/dev", "ca::web/test"],
  )
})

test("output buffers of sessions a machine dropped are released", () => {
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev"])], [session(A, "web/dev")]))
  world = applyOutput(world, "ca::web/dev", "hello")
  world = applyState(world, B, state(B, [], []))
  world = applyOutput(world, "cb::gone/x", "orphan")
  assert.equal(world.output["ca::web/dev"], "hello")

  world = applyState(world, A, state(A, [project(A, "web", ["dev"])], []))
  assert.equal(world.output["ca::web/dev"], undefined)
  assert.equal(world.output["cb::gone/x"], "orphan")
})

test("snapshot replaces, output appends", () => {
  let world = applySnapshot(EMPTY_WORLD, "ca::web/dev", "first\n")
  world = applyOutput(world, "ca::web/dev", "second\n")
  assert.equal(world.output["ca::web/dev"], "first\nsecond\n")
  world = applySnapshot(world, "ca::web/dev", "replaced\n")
  assert.equal(world.output["ca::web/dev"], "replaced\n")
})

test("metrics land on the session and are trimmed to the window", () => {
  const now = 10 * METRIC_WINDOW_MS
  const sample = (sampledAt: number, cpuPercent: number): SessionMetrics => ({
    cpuPercent,
    memoryBytes: 1024,
    processCount: 1,
    outputBytes: 0,
    outputBytesPerSecond: 0,
    ports: [],
    sampledAt,
    peakCpuPercent: cpuPercent,
    peakMemoryBytes: 1024,
  })

  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev"])], [session(A, "web/dev")]))
  world = applyMetrics(world, "ca::web/dev", sample(now - METRIC_WINDOW_MS - 1_000, 5), now)
  world = applyMetrics(world, "ca::web/dev", sample(now - 1_000, 42), now)

  assert.deepEqual(
    world.metrics["ca::web/dev"]?.map((point) => point.cpuPercent),
    [42],
  )
  assert.equal(world.sessions[0]?.metrics?.cpuPercent, 42)
})

test("an exit marks the session, not the machine", () => {
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev"])], [session(A, "web/dev")]))
  world = applyExit(world, "ca::web/dev", 137)
  assert.equal(world.sessions[0]?.status, "exited")
  assert.equal(world.sessions[0]?.exitCode, 137)
})

test("removing a machine purges everything scoped to it", () => {
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev"])], [session(A, "web/dev")]))
  world = applyState(world, B, state(B, [project(B, "api", ["serve"])], [session(B, "api/serve")]))
  world = applyOutput(world, "ca::web/dev", "bye")
  world = dropScope(world, A)

  assert.deepEqual(
    world.projects.map((entry) => entry.name),
    ["cb::api"],
  )
  assert.deepEqual(
    world.sessions.map((entry) => entry.id),
    ["cb::api/serve"],
  )
  assert.deepEqual(world.output, {})
})

test("a process's session id is scoped like the project it belongs to", () => {
  assert.equal(sessionIdFor("ca::web", "dev"), "ca::web/dev")
  // A bare name is the local machine's, per the scoping rules.
  assert.equal(sessionIdFor("web", "dev"), "local::web/dev")
})

test("counts and project lists are per machine", () => {
  let world = applyState(
    EMPTY_WORLD,
    A,
    state(A, [project(A, "web", ["dev", "test"])], [session(A, "web/dev"), session(A, "web/test", "exited")]),
  )
  world = applyState(world, B, state(B, [project(B, "api", ["serve"])], [session(B, "api/serve")]))

  assert.deepEqual(processCounts(world, A), { running: 1, total: 2 })
  assert.deepEqual(processCounts(world, B), { running: 1, total: 1 })
  assert.deepEqual(
    projectsOf(world, B).map((entry) => entry.name),
    ["cb::api"],
  )
})

test("a session id splits back into the project and process it addresses", () => {
  assert.deepEqual(splitSessionId("ca::web/dev"), { project: "ca::web", process: "dev" })
  assert.deepEqual(splitSessionId("local::web/dev"), { project: "local::web", process: "dev" })
})

test("a selection survives as long as its process is listed", () => {
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev", "test"])], [session(A, "web/dev")]))

  assert.equal(keepSelection(world, "ca::web/dev"), "ca::web/dev")
  // Never started, so it has no session — the project listing it is enough.
  assert.equal(keepSelection(world, "ca::web/test"), "ca::web/test")
  assert.equal(keepSelection(world, "ca::web/gone"), null)
  assert.equal(keepSelection(world, null), null)

  // A machine that drops the process takes the selection with it.
  world = applyState(world, A, state(A, [project(A, "web", ["test"])], []))
  assert.equal(keepSelection(world, "ca::web/dev"), null)
})

test("unpairing a machine clears a selection pointed at it", () => {
  let world = applyState(EMPTY_WORLD, A, state(A, [project(A, "web", ["dev"])], [session(A, "web/dev")]))
  world = applyState(world, B, state(B, [project(B, "api", ["serve"])], [session(B, "api/serve")]))
  world = dropScope(world, A)

  assert.equal(keepSelection(world, "ca::web/dev"), null)
  assert.equal(keepSelection(world, "cb::api/serve"), "cb::api/serve")
})
