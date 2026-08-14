import assert from "node:assert/strict"
import { test } from "node:test"
import { DEFAULT_MODE, parseMode } from "./mode.ts"

test("a stored mode is honoured", () => {
  assert.equal(parseMode("projects"), "projects")
  assert.equal(parseMode("machines"), "machines")
})

test("anything else reads as the default", () => {
  assert.equal(parseMode(null), DEFAULT_MODE)
  assert.equal(parseMode(undefined), DEFAULT_MODE)
  assert.equal(parseMode(""), DEFAULT_MODE)
  assert.equal(parseMode("Projects"), DEFAULT_MODE)
  assert.equal(parseMode('{"mode":"projects"}'), DEFAULT_MODE)
})
