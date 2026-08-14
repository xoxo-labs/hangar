import assert from "node:assert/strict"
import { test } from "node:test"
import { newConnId, parseStored, STORAGE_KEY } from "./manager.ts"
import { pairError, readTarget, UNREACHABLE } from "./pairing.ts"

test("the stored machine list uses the desktop app's key", () => {
  assert.equal(STORAGE_KEY, "hangar.connections.v1")
})

test("stored machines are validated, not trusted", () => {
  const good = { id: "c1", label: "Studio", host: "100.90.1.5", port: 4780, secure: false, token: "hgr_x" }
  const raw = JSON.stringify([
    good,
    { ...good, id: "has:colon" },
    { ...good, id: "" },
    { ...good, token: "" },
    { ...good, port: "4780" },
    { ...good, host: "" },
    "nonsense",
    null,
  ])
  assert.deepEqual(parseStored(raw), [good])
})

test("a missing or broken blob reads as no machines", () => {
  assert.deepEqual(parseStored("not json"), [])
  assert.deepEqual(parseStored('{"id":"c1"}'), [])
  assert.deepEqual(parseStored("[]"), [])
})

test("secure is normalised to a boolean", () => {
  const raw = JSON.stringify([{ id: "c1", label: "l", host: "h", port: 1, token: "t" }])
  assert.equal(parseStored(raw)[0]?.secure, false)
})

test("connection ids never contain the scope separator", () => {
  for (let i = 0; i < 50; i += 1) assert.ok(!newConnId().includes(":"))
})

test("pairing refusals map to the desktop app's sentences", () => {
  assert.match(pairError(401), /wrong or has expired/)
  assert.match(pairError(429), /too many tries/)
  assert.match(pairError(500), /refused the pairing \(500\)/)
  assert.match(UNREACHABLE, /Could not reach that Mac/)
})

test("the pairing fields are read leniently but validated", () => {
  assert.deepEqual(readTarget(" 100.90.1.5 ", "4780", " abcd2345wxyz "), {
    host: "100.90.1.5",
    port: 4780,
    code: "ABCD2345WXYZ",
  })
  assert.equal(readTarget("", "4780", "CODE"), null)
  assert.equal(readTarget("host", "nope", "CODE"), null)
  assert.equal(readTarget("host", "70000", "CODE"), null)
  assert.equal(readTarget("host", "4780", "   "), null)
})
