import assert from "node:assert/strict"
import { test } from "node:test"
import { appendBuffer, BUFFER_LIMIT, trimBuffer } from "./buffer.ts"

test("a short buffer is left alone", () => {
  assert.equal(trimBuffer("hello"), "hello")
  assert.equal(appendBuffer(undefined, "hello"), "hello")
  assert.equal(appendBuffer("hel", "lo"), "hello")
})

test("the buffer stops growing at the cap", () => {
  let text = ""
  for (let i = 0; i < 500; i += 1) text = appendBuffer(text, `${"x".repeat(999)}\n`, 10_000)
  assert.ok(text.length <= 10_000, `expected ≤ 10000, got ${text.length}`)
  assert.ok(text.length > 8_000, "the cap should not collapse the buffer")
})

test("trimming snaps to a line boundary", () => {
  const text = "aaaa\nbbbb\ncccc\n"
  assert.equal(trimBuffer(text, 11), "bbbb\ncccc\n")
})

test("one enormous line is cut mid-line rather than emptied", () => {
  const text = "y".repeat(50)
  assert.equal(trimBuffer(text, 10), "y".repeat(10))
})

test("the default cap is the ~200 KB the spec asks for", () => {
  assert.equal(BUFFER_LIMIT, 200_000)
})
