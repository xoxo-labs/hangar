import assert from "node:assert/strict"
import { test } from "node:test"
import { CliFailure, compileUntil, splitLines, tailText, untilMatch } from "./cli.ts"

test("the snapshot tail keeps only the last lines, verbatim", () => {
  const scrollback = "one\ntwo\nthree\nfour\n"
  assert.equal(tailText(scrollback, 2), "three\nfour\n")
  assert.equal(tailText(scrollback, 1), "four\n")
  // Asking for more than there is returns everything, not a padded version.
  assert.equal(tailText(scrollback, 99), scrollback)
  assert.equal(tailText(scrollback, 0), "")
  assert.equal(tailText("", 10), "")
})

test("a snapshot ending mid-line stays mid-line, so live output continues it", () => {
  assert.equal(tailText("one\ntwo\nbuilding", 2), "two\nbuilding")
  // Windows endings survive the slice untouched.
  assert.equal(tailText("one\r\ntwo\r\nthree", 2), "two\r\nthree")
})

test("lines are assembled across chunks that split them anywhere", () => {
  let rest = ""
  const seen: string[] = []
  for (const chunk of ["rea", "dy in 2", "12ms\nnext ", "line\npartial"]) {
    const split = splitLines(rest, chunk)
    rest = split.rest
    seen.push(...split.lines)
  }
  assert.deepEqual(seen, ["ready in 212ms", "next line"])
  // The unterminated tail is held back rather than reported as a line.
  assert.equal(rest, "partial")
})

test("a \\r\\n split across two chunks ends exactly one line", () => {
  const first = splitLines("", "done\r")
  assert.deepEqual(first.lines, [])
  assert.equal(first.rest, "done\r")
  const second = splitLines(first.rest, "\nnext")
  assert.deepEqual(second.lines, ["done"])
  assert.equal(second.rest, "next")
})

test("a bare \\r ends a line the way a progress bar redraws one", () => {
  const { lines, rest } = splitLines("", "10%\r50%\r100%")
  assert.deepEqual(lines, ["10%", "50%"])
  assert.equal(rest, "100%")
})

test("--until matches a completed line and never a partial one", () => {
  const regex = /ready|Error/
  const first = untilMatch(regex, "", "Local: http://localhost:3000\nrea")
  assert.equal(first.matched, null)
  assert.equal(first.rest, "rea")
  const second = untilMatch(regex, first.rest, "dy in 212ms\nmore output\n")
  assert.equal(second.matched, "ready in 212ms")
  // Matching stops at the first hit; the rest of the chunk is not consumed.
  assert.equal(second.rest, "")
})

test("--until reports the whole line it matched, not the pattern", () => {
  const { matched } = untilMatch(/listening/, "", "server listening on 4780\n")
  assert.equal(matched, "server listening on 4780")
})

test("an unusable --until pattern fails as a usage error", () => {
  assert.ok(compileUntil("ready|Error") instanceof RegExp)
  assert.equal(compileUntil("^ready$").source, "^ready$")
  assert.throws(
    () => compileUntil("([unclosed"),
    (error: unknown) => {
      assert.ok(error instanceof CliFailure)
      assert.equal(error.code, "invalid_usage")
      assert.equal(error.exitCode, 2)
      assert.match(error.message, /^invalid --until pattern: /)
      return true
    },
  )
})
