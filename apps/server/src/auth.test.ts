import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.HANGAR_HOME = mkdtempSync(join(tmpdir(), "hangar-auth-"))

const {
  consumeTicket,
  createPairingToken,
  issueTicket,
  listSessions,
  redeemPairingToken,
  revokeSession,
  verifyBearer,
} = await import("./auth.ts")

test("pairing codes redeem once and mint a working bearer token", () => {
  const { token, expiresAt } = createPairingToken()
  assert.match(token, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/)
  assert.ok(expiresAt > Date.now())

  const paired = redeemPairingToken(token, "laptop")
  assert.ok(paired.ok)
  assert.match(paired.sessionToken, /^hgr_/)
  assert.equal(redeemPairingToken(token, "laptop").ok, false)

  assert.equal(verifyBearer(`Bearer ${paired.sessionToken}`), paired.sessionId)
  assert.equal(verifyBearer("Bearer nope"), null)
  assert.equal(verifyBearer(undefined), null)

  const sessions = listSessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0]?.label, "laptop")
  assert.equal("tokenHash" in (sessions[0] as object), false)

  assert.equal(revokeSession(paired.sessionId), true)
  assert.equal(verifyBearer(`Bearer ${paired.sessionToken}`), null)
  assert.equal(listSessions().length, 0)
})

test("tickets are single-use and bound to their session", () => {
  const { ticket } = issueTicket("session-1")
  assert.equal(consumeTicket(ticket), "session-1")
  assert.equal(consumeTicket(ticket), null)
  assert.equal(consumeTicket("made-up"), null)
})

test("the brute-force guard locks pairing until a new code is minted", () => {
  createPairingToken()
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.deepEqual(redeemPairingToken("WRONGWRONGWR", "x"), { ok: false, reason: "invalid" })
  }
  assert.deepEqual(redeemPairingToken("WRONGWRONGWR", "x"), { ok: false, reason: "locked" })
  const { token } = createPairingToken()
  assert.equal(redeemPairingToken(token, "x").ok, true)
})
