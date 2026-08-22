import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PortShare, SessionId, SessionInfo, SessionMetrics } from "@hangar/contracts"
import { buildPortGroups, loopbackOnly, type PortSource } from "./portManager.logic.ts"

function metrics(ports: number[], portBindings?: Record<number, string[]>): SessionMetrics {
  return {
    cpuPercent: 0,
    memoryBytes: 0,
    processCount: 1,
    outputBytes: 0,
    outputBytesPerSecond: 0,
    ports,
    sampledAt: 0,
    peakCpuPercent: 0,
    peakMemoryBytes: 0,
    ...(portBindings === undefined ? {} : { portBindings }),
  }
}

/** A running session with metrics, since that is the only kind that opens ports. */
function session(id: SessionId, over: Partial<SessionInfo> = {}): SessionInfo {
  const slash = id.lastIndexOf("/")
  return {
    id,
    runId: `${id}@1`,
    project: id.slice(0, slash),
    process: id.slice(slash + 1),
    status: "running",
    startedAt: 0,
    cmd: "pnpm dev",
    metrics: metrics([]),
    ...over,
  }
}

function share(port: number, kind: PortShare["kind"], sessionOf?: SessionId): PortShare {
  return {
    port,
    kind,
    url: "https://mac.tail1234.ts.net",
    servePort: 443,
    createdAt: 0,
    ...(sessionOf === undefined ? {} : { session: sessionOf }),
  }
}

describe("loopbackOnly", () => {
  it("never warns about bindings nobody reported", () => {
    assert.equal(loopbackOnly([]), false)
  })

  it("accepts every spelling of the local machine", () => {
    assert.equal(loopbackOnly(["127.0.0.1", "::1", "[::1]", "localhost"]), true)
  })

  it("is false as soon as one binding faces the network", () => {
    assert.equal(loopbackOnly(["127.0.0.1", "0.0.0.0"]), false)
    assert.equal(loopbackOnly(["localhost", "192.168.1.20"]), false)
  })
})

describe("buildPortGroups", () => {
  it("turns the ports of running sessions into rows, public first, then tailnet, then locals by port", () => {
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [share(8080, "public"), share(5173, "tailnet")],
        sessions: [session("local::api/web", { metrics: metrics([9229, 3000, 5173, 8080]) })],
      },
    ]
    const [group] = buildPortGroups(sources)
    assert.deepEqual(
      group?.rows.map((row) => [row.port, row.share?.kind ?? "local"]),
      [
        [8080, "public"],
        [5173, "tailnet"],
        [3000, "local"],
        [9229, "local"],
      ],
    )
    assert.deepEqual(
      group?.rows.map((row) => [row.connId, row.session, row.project, row.process]),
      group?.rows.map(() => ["local", "local::api/web", "local::api", "web"]),
    )
  })

  it("lists no ports for an exited session or one that never reported metrics", () => {
    // An exited session keeps its last metrics; dialing those ports would fail.
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [],
        sessions: [
          session("local::api/web", { status: "exited", exitCode: 0, metrics: metrics([3000]) }),
          session("local::api/worker", { metrics: undefined }),
        ],
      },
    ]
    assert.deepEqual(buildPortGroups(sources), [])
  })

  it("merges a share into the detected row instead of listing the port twice", () => {
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [share(3000, "public", "local::api/web")],
        sessions: [session("local::api/web", { metrics: metrics([3000]) })],
      },
    ]
    const rows = buildPortGroups(sources)[0]?.rows
    assert.equal(rows?.length, 1)
    assert.deepEqual(
      rows?.map((row) => [row.port, row.share?.kind, row.session, row.project]),
      [[3000, "public", "local::api/web", "local::api"]],
    )
  })

  it("still lists a share whose port no sampler saw, and names its owner when it has one", () => {
    // Reachable but invisible is the one state this panel must not allow.
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [share(4000, "tailnet", "local::api/web")],
        sessions: [session("local::api/web", { metrics: metrics([3000]) })],
      },
    ]
    const rows = buildPortGroups(sources)[0]?.rows
    assert.deepEqual(
      rows?.map((row) => [row.port, row.share?.kind ?? "local", row.session, row.project, row.process]),
      [
        [4000, "tailnet", "local::api/web", "local::api", "web"],
        [3000, "local", "local::api/web", "local::api", "web"],
      ],
    )
    assert.equal(rows?.[0]?.loopbackOnly, false)
  })

  it("keeps an adopted share ownerless rather than guessing whose port it is", () => {
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [share(4000, "public"), share(5000, "tailnet", "local::gone/web")],
        sessions: [session("local::api/web", { metrics: metrics([3000]) })],
      },
    ]
    const rows = buildPortGroups(sources)[0]?.rows
    assert.deepEqual(
      rows?.map((row) => [row.port, row.session, row.project, row.process]),
      [
        [4000, undefined, undefined, undefined],
        [5000, "local::gone/web", undefined, undefined],
        [3000, "local::api/web", "local::api", "web"],
      ],
    )
  })

  it("drops machines with nothing open", () => {
    const sources: PortSource[] = [
      { connId: "idle", machine: "Studio", shares: [], sessions: [] },
      {
        connId: "local",
        machine: "This Mac",
        shares: [],
        sessions: [session("local::api/web", { metrics: metrics([3000]) })],
      },
      { connId: "quiet", machine: "Server", shares: [], sessions: [session("quiet::api/web")] },
    ]
    assert.deepEqual(
      buildPortGroups(sources).map((group) => group.connId),
      ["local"],
    )
  })

  it("floats the exposed machine to the top and leaves the rest in the order given", () => {
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [share(5173, "tailnet")],
        sessions: [session("local::api/web", { metrics: metrics([5173]) })],
      },
      {
        connId: "server",
        machine: "Server",
        shares: [],
        sessions: [session("server::api/web", { metrics: metrics([3000]) })],
      },
      {
        connId: "studio",
        machine: "Studio",
        shares: [share(8080, "public")],
        sessions: [session("studio::api/web", { metrics: metrics([8080]) })],
      },
    ]
    assert.deepEqual(
      buildPortGroups(sources).map((group) => group.machine),
      ["Studio", "This Mac", "Server"],
    )
  })

  it("reads loopbackOnly from the owning session's bindings for that one port", () => {
    const sources: PortSource[] = [
      {
        connId: "local",
        machine: "This Mac",
        shares: [],
        sessions: [
          session("local::api/web", {
            metrics: metrics([3000, 4000, 5000], { 3000: ["127.0.0.1", "[::1]"], 4000: ["0.0.0.0"] }),
          }),
          session("local::api/worker", { metrics: metrics([6000], { 3000: ["0.0.0.0"] }) }),
        ],
      },
    ]
    assert.deepEqual(
      buildPortGroups(sources)[0]?.rows.map((row) => [row.port, row.loopbackOnly]),
      [
        [3000, true],
        [4000, false],
        // No bindings reported for 5000, and none of the worker's business.
        [5000, false],
        [6000, false],
      ],
    )
  })
})
