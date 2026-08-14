import assert from "node:assert/strict"
import { test } from "node:test"
import {
  paletteColor,
  softWrap,
  spanLines,
  stripAnsi,
  stripExceptColor,
  toLines,
  visibleSpans,
  WRAP_CHUNK,
  ZERO_WIDTH_SPACE,
} from "./ansi.ts"

/** What a line of spans reads as, ignoring colour. */
const plain = (spans: { text: string }[]): string => spans.map((span) => span.text).join("")

const ESC = "\u001B"
const BEL = "\u0007"

test("strips colour and cursor sequences", () => {
  assert.equal(stripAnsi(`${ESC}[32mready${ESC}[0m`), "ready")
  assert.equal(stripAnsi(`${ESC}[2K${ESC}[1Gbuilding`), "building")
  assert.equal(stripAnsi(`${ESC}[38;5;204mvite${ESC}[39m v7`), "vite v7")
})

test("strips OSC title sequences", () => {
  assert.equal(stripAnsi(`${ESC}]0;pnpm dev${BEL}done`), "done")
})

test("leaves plain text alone", () => {
  assert.equal(stripAnsi("plain output 100% ~/code"), "plain output 100% ~/code")
})

test("a carriage return rewrites its line", () => {
  assert.deepEqual(toLines("12%\r45%\r99%\ndone"), ["99%", "done"])
})

test("a PTY's CRLF is a line break, not a rewrite", () => {
  assert.deepEqual(toLines("tick 1\r\ntick 2\r\n"), ["tick 1", "tick 2", ""])
})

test("keeps tabs but drops stray control bytes", () => {
  assert.deepEqual(toLines("a\tb\u0000c"), ["a\tbc"])
})

test("visibleSpans keeps the tail and drops the trailing cursor line", () => {
  const text = ["one", "two", "three", ""].join("\n")
  assert.deepEqual(visibleSpans(text, 10).map(plain), ["one", "two", "three"])
  assert.deepEqual(visibleSpans(text, 2).map(plain), ["two", "three"])
})

test("keeps colour codes while dropping the rest", () => {
  assert.equal(stripExceptColor(`${ESC}[2K${ESC}[1G${ESC}[32mready${ESC}[0m`), `${ESC}[32mready${ESC}[0m`)
  assert.equal(
    stripExceptColor(`${ESC}]0;pnpm dev${BEL}${ESC}[38;5;204mvite${ESC}[39m`),
    `${ESC}[38;5;204mvite${ESC}[39m`,
  )
})

test("spans carry the colour a line opened with", () => {
  const [line] = spanLines(`${ESC}[31mred${ESC}[0m plain`)
  assert.deepEqual(line, [{ text: "red", color: "#cc0000" }, { text: " plain" }])
})

test("a colour opened on one line still applies to the next", () => {
  const lines = spanLines(`${ESC}[32mfirst\nsecond${ESC}[0m\nthird`)
  assert.deepEqual(
    lines.map((line) => line.map((span) => span.color ?? "default")),
    [["#4e9a06"], ["#4e9a06"], ["default"]],
  )
})

test("256-colour and truecolor resolve to real colours", () => {
  const [line] = spanLines(`${ESC}[38;5;204mpink${ESC}[39m${ESC}[38;2;10;20;30mexact`)
  assert.deepEqual(
    line?.map((span) => span.color),
    ["rgb(255, 95, 135)", "rgb(10, 20, 30)"],
  )
  assert.equal(paletteColor(1), "#cc0000")
  assert.equal(paletteColor(231), "rgb(255, 255, 255)")
  assert.equal(paletteColor(232), "rgb(8, 8, 8)")
  assert.equal(paletteColor(300), undefined)
})

test("bold and underline survive, plain text stays plain", () => {
  const [line] = spanLines(`${ESC}[1mbold${ESC}[0m${ESC}[4munder`)
  assert.deepEqual(line, [
    { text: "bold", bold: true },
    { text: "under", underline: true },
  ])
  assert.deepEqual(spanLines("nothing special"), [[{ text: "nothing special" }]])
})

test("visibleSpans keeps the tail, cleaned of cursor moves", () => {
  const raw = ["one", `${ESC}[2Ktwo`, `${ESC}[33mthree`, ""].join("\n")
  const lines = visibleSpans(raw, 2)
  assert.deepEqual(lines.map(plain), ["two", "three"])
  assert.equal(lines[1]?.[0]?.color, "#c4a000")
})

test("visibleSpans survives an empty buffer", () => {
  assert.deepEqual(visibleSpans("", 10), [[]])
})

test("softWrap leaves text that can already wrap alone", () => {
  const sentence = "the quick brown fox jumps over the lazy dog again and again"
  assert.equal(softWrap(sentence), sentence)
  assert.equal(softWrap("short"), "short")
  assert.equal(softWrap("x".repeat(WRAP_CHUNK)), "x".repeat(WRAP_CHUNK))
})

test("softWrap gives an unbreakable run somewhere to fold", () => {
  const url = `https://example.com/${"a".repeat(60)}?token=${"b".repeat(40)}`
  const wrapped = softWrap(url)
  assert.equal(wrapped.split(ZERO_WIDTH_SPACE).join(""), url)
  assert.ok(wrapped.split(ZERO_WIDTH_SPACE).every((piece) => piece.length <= WRAP_CHUNK))
})

test("softWrap only touches the long run inside a line", () => {
  const line = `INFO loaded ${"z".repeat(40)} ok`
  const wrapped = softWrap(line)
  assert.ok(wrapped.startsWith("INFO loaded "))
  assert.ok(wrapped.endsWith(" ok"))
  assert.equal(wrapped.split(ZERO_WIDTH_SPACE).join(""), line)
})

test("softWrap is idempotent", () => {
  const once = softWrap("y".repeat(100))
  assert.equal(softWrap(once), once)
})
