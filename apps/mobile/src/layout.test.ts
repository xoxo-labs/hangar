import assert from "node:assert/strict"
import { test } from "node:test"
import { adoptOnResize, layoutModeFor, REGULAR_MIN_WIDTH } from "./layout.ts"

test("phone widths are compact, iPad widths are regular", () => {
  assert.equal(layoutModeFor(320), "compact")
  assert.equal(layoutModeFor(402), "compact")
  assert.equal(layoutModeFor(REGULAR_MIN_WIDTH - 1), "compact")
  assert.equal(layoutModeFor(REGULAR_MIN_WIDTH), "regular")
  assert.equal(layoutModeFor(834), "regular")
  assert.equal(layoutModeFor(1_366), "regular")
})

test("a width that never crosses the threshold changes nothing", () => {
  assert.deepEqual(adoptOnResize("regular", "regular", null, "ca::demo/chatty"), {
    selection: "ca::demo/chatty",
    pop: false,
  })
  assert.deepEqual(adoptOnResize("compact", "compact", "ca::demo/chatty", null), { selection: null, pop: false })
})

test("widening onto a session route adopts it and pops the screen", () => {
  assert.deepEqual(adoptOnResize("compact", "regular", "ca::demo/chatty", null), {
    selection: "ca::demo/chatty",
    pop: true,
  })
})

test("widening replaces whatever the pane was showing", () => {
  assert.deepEqual(adoptOnResize("compact", "regular", "ca::demo/chatty", "cb::web/build"), {
    selection: "ca::demo/chatty",
    pop: true,
  })
})

test("widening elsewhere in the stack leaves the pane alone", () => {
  assert.deepEqual(adoptOnResize("compact", "regular", null, "ca::demo/chatty"), {
    selection: "ca::demo/chatty",
    pop: false,
  })
  assert.deepEqual(adoptOnResize("compact", "regular", null, null), { selection: null, pop: false })
})

test("narrowing keeps the selection and pushes nothing", () => {
  assert.deepEqual(adoptOnResize("regular", "compact", null, "ca::demo/chatty"), {
    selection: "ca::demo/chatty",
    pop: false,
  })
})
