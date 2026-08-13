import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { countdown, pairingString, parsePairingString } from "./pairing.logic.ts"

describe("parsePairingString", () => {
  it("reads the string the pairing panel hands out", () => {
    assert.deepEqual(parsePairingString(" 100.90.1.5:4780#ABCD2345WXYZ "), {
      host: "100.90.1.5",
      port: 4780,
      code: "ABCD2345WXYZ",
    })
  })

  it("accepts a URL form and lower-cased codes", () => {
    assert.deepEqual(parsePairingString("http://mac.local:4899/#abcd2345wxyz"), {
      host: "mac.local",
      port: 4899,
      code: "ABCD2345WXYZ",
    })
  })

  it("keeps a bracketed IPv6 host together", () => {
    assert.deepEqual(parsePairingString("[fd7a::1]:4780#CODE"), { host: "[fd7a::1]", port: 4780, code: "CODE" })
  })

  it("allows an address with no code, for the separate code field", () => {
    assert.deepEqual(parsePairingString("192.168.1.20:4780"), { host: "192.168.1.20", port: 4780, code: "" })
  })

  it("refuses anything without a usable port", () => {
    assert.equal(parsePairingString(""), null)
    assert.equal(parsePairingString("mac.local"), null)
    assert.equal(parsePairingString("mac.local:0"), null)
    assert.equal(parsePairingString("mac.local:70000"), null)
    assert.equal(parsePairingString(":4780"), null)
  })

  it("round-trips what the panel formats", () => {
    const formatted = pairingString("100.90.1.5", 4780, "ABCD2345WXYZ")
    assert.deepEqual(parsePairingString(formatted), { host: "100.90.1.5", port: 4780, code: "ABCD2345WXYZ" })
  })
})

describe("countdown", () => {
  it("counts down in minutes and seconds, never past zero", () => {
    assert.equal(countdown(300_000), "5:00")
    assert.equal(countdown(61_500), "1:01")
    assert.equal(countdown(9_000), "0:09")
    assert.equal(countdown(-5_000), "0:00")
  })
})
