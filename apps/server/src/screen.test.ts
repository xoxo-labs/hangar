import assert from "node:assert/strict"
import { test } from "node:test"
import { stripVTControlCharacters } from "node:util"
import { Screen } from "./screen.ts"

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

test("plain lines round-trip through serialize", async () => {
  const screen = new Screen({ cols: 80, rows: 24 })
  screen.write("first line\r\nsecond line\r\nthird line")
  await screen.flush()
  const text = stripVTControlCharacters(screen.serialize())
  assert.deepEqual(
    text.split("\r\n").filter((line) => line !== ""),
    ["first line", "second line", "third line"],
  )
  screen.dispose()
})

test("a bottom-row menu survives a resize exactly once", async () => {
  // What docker compose does: log lines, then an absolute move to the last row.
  const screen = new Screen({ cols: 80, rows: 24 })
  screen.write("a\r\nb\r\n\x1b[24;1H\x1b[2mmenu\x1b[0m")
  await screen.flush()
  screen.resize(80, 40)
  await screen.flush()
  const serialized = screen.serialize()
  assert.equal(occurrences(serialized, "menu"), 1)
  assert.deepEqual(screen.size, { cols: 80, rows: 40 })
  screen.dispose()
})

test("the alternate buffer is serialized as such", async () => {
  const screen = new Screen({ cols: 80, rows: 24 })
  screen.write("\x1b[?1049h\x1b[HTUI")
  await screen.flush()
  const serialized = screen.serialize()
  assert.ok(serialized.includes("?1049h"), serialized.slice(0, 80))
  assert.ok(serialized.includes("TUI"))
  assert.equal(screen.tailText(1000), "TUI")
  screen.dispose()
})

test("serialize sees a large payload only after a flush", async () => {
  const screen = new Screen({ cols: 80, rows: 24 })
  const filler = Array.from({ length: 400 }, (_, index) => `line ${index} ${"x".repeat(60)}`).join("\r\n")
  screen.write(`${filler}\r\nMARKER-END`)
  await screen.flush()
  assert.ok(screen.serialize().includes("MARKER-END"))
  screen.dispose()
})

test("tailText skips trailing blank rows and honours its char budget", async () => {
  const screen = new Screen({ cols: 80, rows: 24 })
  screen.write("alpha\r\nbravo\r\ncharlie\r\n\r\n\r\n")
  await screen.flush()
  assert.equal(screen.tailText(1000), "alpha\nbravo\ncharlie")
  assert.equal(screen.tailText(5), "charlie")
  screen.dispose()
})

test("an untouched screen serializes to nothing", () => {
  const screen = new Screen({ cols: 80, rows: 24 })
  assert.equal(screen.serialize(), "")
  assert.equal(screen.tailText(100), "")
  screen.dispose()
})
