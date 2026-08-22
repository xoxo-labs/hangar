import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PortShare } from "@hangar/contracts"
import { flattenShares, hasPublicShare, shareForSession, shareLabel, type ShareSource } from "./shares.logic.ts"

function share(port: number, kind: PortShare["kind"], session?: string): PortShare {
  return {
    port,
    kind,
    url: "https://mac.tail1234.ts.net",
    servePort: 443,
    createdAt: 0,
    ...(session === undefined ? {} : { session }),
  }
}

describe("flattenShares", () => {
  it("floats public shares above tailnet ones, whatever machine they are on", () => {
    const sources: ShareSource[] = [
      { connId: "local", machine: "This Mac", shares: [share(3000, "tailnet")] },
      { connId: "studio", machine: "Studio", shares: [share(8080, "public")] },
    ]
    assert.deepEqual(
      flattenShares(sources).map((entry) => [entry.machine, entry.port]),
      [
        ["Studio", 8080],
        ["This Mac", 3000],
      ],
    )
  })

  it("orders by machine then port within a kind, and tags every share with its connection", () => {
    const sources: ShareSource[] = [
      { connId: "studio", machine: "Studio", shares: [share(5173, "tailnet")] },
      { connId: "local", machine: "This Mac", shares: [share(4000, "tailnet"), share(3000, "tailnet")] },
    ]
    assert.deepEqual(
      flattenShares(sources).map((entry) => `${entry.connId}:${entry.port}`),
      ["studio:5173", "local:3000", "local:4000"],
    )
  })

  it("is empty when no machine is sharing", () => {
    assert.deepEqual(flattenShares([{ connId: "local", machine: "This Mac", shares: [] }]), [])
  })
})

describe("shareForSession", () => {
  const shares = flattenShares([
    { connId: "local", machine: "This Mac", shares: [share(3000, "public", "local::api/web"), share(9000, "tailnet")] },
  ])

  it("finds the share a session started", () => {
    assert.equal(shareForSession(shares, "local::api/web")?.port, 3000)
  })

  it("never matches an adopted share against a row with no session", () => {
    // The 9000 share has no session; a loose lookup would attach it to every
    // unshared row in the sidebar.
    assert.equal(shareForSession(shares, undefined), undefined)
    assert.equal(shareForSession(shares, "local::api/other"), undefined)
  })
})

describe("share copy and alarm", () => {
  it("names the reach in words, not jargon", () => {
    assert.equal(shareLabel("public"), "Public on the internet")
    assert.equal(shareLabel("tailnet"), "Shared on your tailnet")
  })

  it("raises the alarm only for shares that leave the tailnet", () => {
    const tailnetOnly = flattenShares([{ connId: "local", machine: "m", shares: [share(3000, "tailnet")] }])
    const withPublic = flattenShares([{ connId: "local", machine: "m", shares: [share(3000, "public")] }])
    assert.equal(hasPublicShare(tailnetOnly), false)
    assert.equal(hasPublicShare(withPublic), true)
  })
})
