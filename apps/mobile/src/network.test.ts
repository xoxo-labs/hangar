import assert from "node:assert/strict"
import { test } from "node:test"
import { candidates, normalizeInfo, readAddress, sameAddress } from "./network.ts"

const config = { host: "192.168.1.20", port: 4780 }

test("offers Tailscale first, then the LAN, all on the current port", () => {
  const list = candidates({ lan: ["192.168.1.20", "10.0.0.4"], tailscale: ["100.90.1.5"] }, config)
  assert.deepEqual(
    list.map((item) => `${item.kind} ${item.host}:${item.port}`),
    ["tailscale 100.90.1.5:4780", "lan 192.168.1.20:4780", "lan 10.0.0.4:4780"],
  )
})

test("marks the address already in use instead of hiding it", () => {
  const list = candidates({ lan: ["192.168.1.20", "10.0.0.4"], tailscale: [] }, config)
  assert.deepEqual(
    list.map((item) => item.current),
    [true, false],
  )
})

test("drops blanks and duplicates", () => {
  const list = candidates({ lan: ["10.0.0.4", " 10.0.0.4 ", "", "  "], tailscale: ["10.0.0.4"] }, config)
  assert.deepEqual(
    list.map((item) => `${item.kind} ${item.host}`),
    ["tailscale 10.0.0.4"],
  )
})

test("an unreachable machine simply offers nothing", () => {
  assert.deepEqual(candidates(null, config), [])
  assert.deepEqual(candidates({ lan: [], tailscale: [] }, config), [])
})

test("readAddress takes a host and a port apart", () => {
  assert.deepEqual(readAddress(" 100.90.1.5 ", " 4780 "), { host: "100.90.1.5", port: 4780 })
  assert.deepEqual(readAddress("http://mac.local/", "4780"), { host: "mac.local", port: 4780 })
})

test("readAddress refuses what would not connect", () => {
  assert.equal(readAddress("", "4780"), null)
  assert.equal(readAddress("10.0.0.4", ""), null)
  assert.equal(readAddress("10.0.0.4", "0"), null)
  assert.equal(readAddress("10.0.0.4", "70000"), null)
  assert.equal(readAddress("10.0.0.4", "port"), null)
  assert.equal(readAddress("two hosts", "4780"), null)
})

test("sameAddress spots the save that would change nothing", () => {
  assert.equal(sameAddress(config, { host: "192.168.1.20", port: 4780 }), true)
  assert.equal(sameAddress(config, { host: "192.168.1.20", port: 4781 }), false)
  assert.equal(sameAddress(config, { host: "100.90.1.5", port: 4780 }), false)
})

test("normalizeInfo survives whatever the other machine sent", () => {
  assert.deepEqual(normalizeInfo({ lan: ["10.0.0.4"], tailscale: null }), { lan: ["10.0.0.4"], tailscale: [] })
  assert.deepEqual(normalizeInfo({ lan: [1, "10.0.0.4", ""] }), { lan: ["10.0.0.4"], tailscale: [] })
  assert.deepEqual(normalizeInfo("nope"), { lan: [], tailscale: [] })
  assert.deepEqual(normalizeInfo(null), { lan: [], tailscale: [] })
})
