import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadTargets, parseAddress, saveTargets } from "./targets.ts"

test("parses target addresses and defaults the Hangar port", () => {
  assert.deepEqual(parseAddress("studio.local"), { host: "studio.local", port: 4780, secure: false })
  assert.deepEqual(parseAddress("100.90.1.5:4890"), { host: "100.90.1.5", port: 4890, secure: false })
  assert.deepEqual(parseAddress("https://hangar.example"), { host: "hangar.example", port: 443, secure: true })
  assert.deepEqual(parseAddress("[fd7a::1]:4780"), { host: "fd7a::1", port: 4780, secure: false })
})

test("stores target credentials in a mode-0600 file", () => {
  const directory = mkdtempSync(join(tmpdir(), "hangar-targets-"))
  const path = join(directory, "targets.json")
  process.env.HANGAR_CLI_CONFIG = path
  const target = { id: "studio", host: "100.90.1.5", port: 4780, secure: false, token: "hgr_secret" }
  saveTargets([target])
  assert.deepEqual(loadTargets(), [target])
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.match(readFileSync(path, "utf8"), /hgr_secret/)
  delete process.env.HANGAR_CLI_CONFIG
})
