import assert from "node:assert/strict"
import { test } from "node:test"
import { Scrollback } from "./sessions.ts"

const MAX = 512 * 1024
const SLACK = 64 * 1024

/** The behavior Scrollback replaces: `(buffer + data).slice(-MAX)` per append. */
function referenceTail(full: string, count: number): string {
  return full.slice(-count)
}

function chunk(seed: number, length: number): string {
  // Distinct, position-dependent content so an off-by-one in trimming shows up
  // as a content mismatch, not just a length mismatch.
  return String.fromCharCode(97 + (seed % 26)).repeat(length - 1) + String(seed % 10)
}

test("short of the cap it holds everything, verbatim", () => {
  const scrollback = new Scrollback()
  let full = ""
  for (let index = 0; index < 100; index += 1) {
    const data = chunk(index, 1000)
    scrollback.append(data)
    full += data
  }
  assert.equal(scrollback.length, full.length)
  assert.equal(scrollback.toString(), full)
})

test("past the cap it keeps a bounded, exact suffix of the stream", () => {
  const scrollback = new Scrollback()
  let full = ""
  // ~3 MB in pty-sized chunks, interleaving reads the way snapshots would.
  for (let index = 0; index < 750; index += 1) {
    const data = chunk(index, 4096)
    scrollback.append(data)
    full += data
    if (index % 100 === 0) {
      assert.equal(scrollback.toString(), referenceTail(full, scrollback.length))
    }
  }
  assert.ok(scrollback.length >= MAX, `kept ${scrollback.length}, below the cap`)
  assert.ok(scrollback.length <= MAX + SLACK, `kept ${scrollback.length}, past cap + slack`)
  assert.equal(scrollback.toString(), referenceTail(full, scrollback.length))
})

test("one oversized append is trimmed to exactly the cap", () => {
  const scrollback = new Scrollback()
  const full = chunk(3, 3 * 1024 * 1024)
  scrollback.append(full)
  assert.equal(scrollback.length, MAX)
  assert.equal(scrollback.toString(), referenceTail(full, MAX))
})

test("tail returns the same slice the old string buffer did", () => {
  const scrollback = new Scrollback()
  let full = ""
  for (let index = 0; index < 300; index += 1) {
    const data = chunk(index, 4096)
    scrollback.append(data)
    full += data
  }
  const kept = scrollback.toString()
  assert.equal(scrollback.tail(2000), kept.slice(-2000))
  assert.equal(scrollback.tail(2000), referenceTail(full, scrollback.length).slice(-2000))
})

test("empty appends change nothing", () => {
  const scrollback = new Scrollback()
  scrollback.append("")
  assert.equal(scrollback.length, 0)
  assert.equal(scrollback.toString(), "")
  scrollback.append("abc")
  scrollback.append("")
  assert.equal(scrollback.toString(), "abc")
})
