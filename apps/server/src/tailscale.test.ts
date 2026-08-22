import assert from "node:assert/strict"
import { test } from "node:test"
import type { ServeConfig } from "./tailscale.ts"
import {
  funnelDenied,
  pickServePort,
  readShares,
  servePortOwner,
  shareArgs,
  stateFromStatus,
  stopTarget,
  tailscaleBin,
  unshareArgs,
} from "./tailscale.ts"

const DNS = "sorins-macbook-pro.tailf18df4.ts.net"

/** The user's real hand-made serve config: 443 proxying a local app. Hangar must leave it alone. */
const HAND_MADE: ServeConfig = {
  TCP: { "443": { HTTPS: true } },
  Web: { [`${DNS}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3021" } } } },
}

function withHangarShare(base: ServeConfig): ServeConfig {
  return {
    TCP: { ...base.TCP, "8443": { HTTPS: true } },
    Web: { ...base.Web, [`${DNS}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } },
  }
}

// ---------------------------------------------------------------------------
// The safety contract: a hand-made serve config survives everything Hangar does.

test("hangar never resets and never reaches past its own --https entry", () => {
  // No argument vector this module can emit contains `reset` or `clear`; the
  // only off-switch is scoped to a single HTTPS port.
  for (const kind of ["tailnet", "public"] as const) {
    for (const servePort of [443, 8443, 10000, 10023]) {
      const on = shareArgs(kind, servePort, 3000)
      const off = unshareArgs(kind, servePort)
      for (const args of [on, off]) {
        assert.equal(args.includes("reset"), false, args.join(" "))
        assert.equal(args.includes("clear"), false, args.join(" "))
      }
      assert.deepEqual(off.slice(1), [`--https=${servePort}`, "off"])
    }
  }
})

test("stopping hangar's share leaves the hand-made 443 entry untouched", () => {
  // Hangar created 8443 -> 3000 and recorded that; the user's own 443 -> 3021
  // exists beside it. Unsharing 3000 targets 8443 and only 8443.
  const config = withHangarShare(HAND_MADE)
  assert.deepEqual(stopTarget(config, DNS, 3000, 8443), { kind: "tailnet", servePort: 8443 })
  assert.deepEqual(unshareArgs("tailnet", 8443), ["serve", "--https=8443", "off"])
})

test("hangar's record wins when the same local port is also shared by hand", () => {
  // The user hand-shared 3000 on 443 AND Hangar shared 3000 on 8443. The
  // record of what Hangar created keeps the unshare off the hand-made entry.
  const config: ServeConfig = {
    TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
    Web: {
      [`${DNS}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
      [`${DNS}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
    },
  }
  assert.deepEqual(stopTarget(config, DNS, 3000, 8443), { kind: "tailnet", servePort: 8443 })
})

test("stopping an unshared port is a no-op, not an error", () => {
  assert.equal(stopTarget(HAND_MADE, DNS, 9999), null)
  assert.equal(stopTarget({}, DNS, 3000), null)
})

test("a new share never lands on an occupied HTTPS port", () => {
  // 443 carries the hand-made entry, so the next share goes to 8443.
  assert.equal(pickServePort(HAND_MADE, DNS, "public"), 8443)
  assert.equal(pickServePort(HAND_MADE, DNS, "tailnet"), 8443)
})

test("a foreign handler blocks its HTTPS port outright", () => {
  const cases: [string, ServeConfig][] = [
    // Proxy to something that is not loopback HTTP: not ours.
    ["remote proxy", { Web: { [`${DNS}:443`]: { Handlers: { "/": { Proxy: "http://192.168.1.10:80" } } } } }],
    ["https target", { Web: { [`${DNS}:443`]: { Handlers: { "/": { Proxy: "https://127.0.0.1:8443" } } } } }],
    // Extra path handlers mean a hand-built layout, not a Hangar share.
    [
      "path handlers",
      {
        Web: {
          [`${DNS}:443`]: {
            Handlers: { "/": { Proxy: "http://127.0.0.1:3000" }, "/api": { Proxy: "http://127.0.0.1:4000" } },
          },
        },
      },
    ],
    // A raw TCP forwarder has no Web entry at all.
    ["tcp forwarder", { TCP: { "443": {} } }],
  ]
  for (const [name, config] of cases) {
    assert.equal(servePortOwner(config, DNS, 443), "foreign", name)
    assert.equal(pickServePort(config, DNS, "public"), 8443, name)
    // Foreign entries are invisible to unshare: no local port maps to them.
    assert.deepEqual(readShares(config, DNS), [], name)
  }
})

// ---------------------------------------------------------------------------
// Reading the serve config back into shares.

test("reads the hand-made config as an adopted tailnet share", () => {
  assert.deepEqual(readShares(HAND_MADE, DNS), [
    { port: 3021, kind: "tailnet", url: `https://${DNS}`, servePort: 443, createdAt: 0 },
  ])
})

test("AllowFunnel is what makes a share public, and non-443 ports show in the url", () => {
  const config: ServeConfig = {
    TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
    Web: {
      [`${DNS}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3021" } } },
      [`${DNS}:8443`]: { Handlers: { "/": { Proxy: "http://localhost:3000" } } },
    },
    AllowFunnel: { [`${DNS}:8443`]: true },
  }
  assert.deepEqual(readShares(config, DNS), [
    { port: 3021, kind: "tailnet", url: `https://${DNS}`, servePort: 443, createdAt: 0 },
    { port: 3000, kind: "public", url: `https://${DNS}:8443`, servePort: 8443, createdAt: 0 },
  ])
})

test("entries for other hosts and empty configs read as no shares", () => {
  const foreignHost: ServeConfig = {
    Web: { "some-other-node.tailf18df4.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } },
  }
  assert.deepEqual(readShares(foreignHost, DNS), [])
  assert.deepEqual(readShares({}, DNS), [])
})

test("servePortOwner tells free from hangar-shaped", () => {
  assert.equal(servePortOwner({}, DNS, 443), "free")
  assert.equal(servePortOwner(HAND_MADE, DNS, 8443), "free")
  // Loopback "/" is the shape Hangar manages — including entries it adopts.
  assert.equal(servePortOwner(HAND_MADE, DNS, 443), "hangar")
})

// ---------------------------------------------------------------------------
// Picking ports and building commands.

test("funnel is capped at three public ports; serve keeps going", () => {
  const config: ServeConfig = { TCP: {}, Web: {} }
  for (const servePort of [443, 8443, 10000]) {
    config.TCP![String(servePort)] = { HTTPS: true }
    config.Web![`${DNS}:${servePort}`] = { Handlers: { "/": { Proxy: `http://127.0.0.1:${3000 + servePort}` } } }
  }
  assert.equal(pickServePort(config, DNS, "public"), null)
  assert.equal(pickServePort(config, DNS, "tailnet"), 10001)
})

test("an empty config starts at 443", () => {
  assert.equal(pickServePort({}, DNS, "public"), 443)
  assert.equal(pickServePort({}, DNS, "tailnet"), 443)
})

test("share commands match the CLI the module drives", () => {
  assert.deepEqual(shareArgs("public", 443, 3000), ["funnel", "--bg", "--yes", "--https=443", "3000"])
  assert.deepEqual(shareArgs("tailnet", 8443, 5173), ["serve", "--bg", "--yes", "--https=8443", "5173"])
  assert.deepEqual(unshareArgs("public", 443), ["funnel", "--https=443", "off"])
  assert.deepEqual(unshareArgs("tailnet", 10000), ["serve", "--https=10000", "off"])
})

// ---------------------------------------------------------------------------
// Backend state and error texts.

test("backend state maps to ready-to-show messages", () => {
  assert.deepEqual(stateFromStatus({ BackendState: "Running", Self: { DNSName: `${DNS}.` } }), {
    running: true,
    dnsName: DNS,
  })
  assert.deepEqual(stateFromStatus({ BackendState: "Stopped" }), { running: false, message: "Tailscale is stopped" })
  assert.deepEqual(stateFromStatus({ BackendState: "NeedsLogin" }), {
    running: false,
    message: "Tailscale is not logged in",
  })
  assert.deepEqual(stateFromStatus({}), { running: false, message: "Tailscale is not running (unknown state)" })
})

test("the funnel policy refusal is recognized so its admin link survives", () => {
  assert.equal(
    funnelDenied('Funnel not available; "funnel" node attribute not set. See https://tailscale.com/s/no-funnel.'),
    true,
  )
  assert.equal(funnelDenied("To allow funnel, visit https://login.tailscale.com/f/funnel?node=n123"), true)
  assert.equal(funnelDenied("invalid port"), false)
  assert.equal(funnelDenied(""), false)
})

test("TAILSCALE_BIN wins the binary lookup, but only when it exists", () => {
  const previous = process.env.TAILSCALE_BIN
  try {
    process.env.TAILSCALE_BIN = process.execPath
    assert.equal(tailscaleBin(), process.execPath)
    process.env.TAILSCALE_BIN = "/nowhere/tailscale"
    assert.equal(tailscaleBin(), null)
  } finally {
    if (previous === undefined) delete process.env.TAILSCALE_BIN
    else process.env.TAILSCALE_BIN = previous
  }
})
