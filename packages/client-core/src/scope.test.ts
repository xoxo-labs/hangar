import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ServerMsg } from "@hangar/contracts"
import { routeOutbound, scopeInbound } from "./route.ts"
import { connIdOf, displayName, parseScoped, scoped } from "./scope.ts"

describe("scope", () => {
  it("round-trips a scoped value", () => {
    assert.equal(scoped("c1", "api/web"), "c1::api/web")
    assert.deepEqual(parseScoped("c1::api/web"), { connId: "c1", value: "api/web" })
    assert.equal(displayName("c1::api/web"), "api/web")
  })

  it("reads a bare value as local", () => {
    assert.deepEqual(parseScoped("api"), { connId: "local", value: "api" })
    assert.equal(connIdOf("api"), "local")
    assert.equal(displayName("api"), "api")
  })

  it("splits on the first separator only", () => {
    assert.deepEqual(parseScoped("local::a::b"), { connId: "local", value: "a::b" })
  })
})

describe("scopeInbound", () => {
  it("scopes ids in a state message and leaves process names bare", () => {
    const msg = {
      type: "state",
      projects: [{ name: "api", path: "/tmp", processes: [{ name: "web", cmd: "pnpm dev" }] }],
      sessions: [
        {
          id: "api/web",
          runId: "r1",
          project: "api",
          process: "web",
          status: "running",
          startedAt: 0,
          cmd: "pnpm dev",
        },
      ],
      history: [
        {
          runId: "r0",
          id: "api/web",
          project: "api",
          process: "web",
          cmd: "pnpm dev",
          startedAt: 0,
          endedAt: 1,
          durationMs: 1,
          exitCode: 0,
          reason: "completed",
          peakCpuPercent: 0,
          peakMemoryBytes: 0,
          totalOutputBytes: 0,
        },
      ],
      settings: {},
    } as unknown as ServerMsg
    const scopedMsg = scopeInbound("c1", msg)
    assert.equal(scopedMsg.type, "state")
    if (scopedMsg.type !== "state") return
    assert.equal(scopedMsg.projects[0]?.name, "c1::api")
    assert.deepEqual(
      [scopedMsg.sessions[0]?.id, scopedMsg.sessions[0]?.project, scopedMsg.sessions[0]?.runId],
      ["c1::api/web", "c1::api", "c1::r1"],
    )
    assert.equal(scopedMsg.sessions[0]?.process, "web")
    assert.deepEqual(
      [scopedMsg.history[0]?.runId, scopedMsg.history[0]?.id, scopedMsg.history[0]?.project],
      ["c1::r0", "c1::api/web", "c1::api"],
    )
  })

  it("scopes the session a share came from, and leaves an adopted share alone", () => {
    const msg = {
      type: "state",
      projects: [],
      sessions: [],
      history: [],
      settings: {},
      shares: [
        { port: 3000, kind: "public", url: "https://m.ts.net", servePort: 443, createdAt: 0, session: "api/web" },
        { port: 9000, kind: "tailnet", url: "https://m.ts.net:8443", servePort: 8443, createdAt: 0 },
      ],
    } as unknown as ServerMsg
    const scopedMsg = scopeInbound("c1", msg)
    if (scopedMsg.type !== "state") return assert.fail("expected a state message")
    assert.equal(scopedMsg.shares?.[0]?.session, "c1::api/web")
    // A share Hangar adopted rather than created names no session; scoping
    // `undefined` would invent one and glue the share to an arbitrary row.
    assert.equal("session" in (scopedMsg.shares?.[1] ?? {}), false)
  })

  it("scopes session-addressed messages", () => {
    assert.deepEqual(scopeInbound("c1", { type: "output", id: "api/web", data: "hi" }), {
      type: "output",
      id: "c1::api/web",
      data: "hi",
    })
    assert.deepEqual(scopeInbound("c1", { type: "error", message: "nope" }), { type: "error", message: "nope" })
  })
})

describe("routeOutbound", () => {
  it("strips the scope and names the owning connection", () => {
    assert.deepEqual(routeOutbound({ type: "start", project: "c1::api", process: "web" }), [
      { connId: "c1", msg: { type: "start", project: "api", process: "web" } },
    ])
    assert.deepEqual(routeOutbound({ type: "write", id: "c1::api/web", data: "x" }), [
      { connId: "c1", msg: { type: "write", id: "api/web", data: "x" } },
    ])
    assert.deepEqual(routeOutbound({ type: "getHistoryReplay", runId: "local::r1" }), [
      { connId: "local", msg: { type: "getHistoryReplay", runId: "r1" } },
    ])
    assert.deepEqual(routeOutbound({ type: "deleteHistoryRun", runId: "c1::r1" }), [
      { connId: "c1", msg: { type: "deleteHistoryRun", runId: "r1" } },
    ])
  })

  it("splits a reorder across the machines it touches", () => {
    assert.deepEqual(routeOutbound({ type: "reorderProjects", projects: ["local::a", "c1::b", "local::c"] }), [
      { connId: "local", msg: { type: "reorderProjects", projects: ["a", "c"] } },
      { connId: "c1", msg: { type: "reorderProjects", projects: ["b"] } },
    ])
  })

  it("sends unscoped messages to the local machine", () => {
    const [routed] = routeOutbound({ type: "createPairingToken" })
    assert.equal(routed?.connId, "local")
  })
})
