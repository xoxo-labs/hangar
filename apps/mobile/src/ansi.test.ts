import assert from "node:assert/strict"
import { test } from "node:test"
import { stripAnsi, toLines, visibleLines } from "./ansi.ts"

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

test("visibleLines keeps the tail and drops the trailing cursor line", () => {
  const text = ["one", "two", "three", ""].join("\n")
  assert.deepEqual(visibleLines(text, 10), ["one", "two", "three"])
  assert.deepEqual(visibleLines(text, 2), ["two", "three"])
})

test("visibleLines survives an empty buffer", () => {
  assert.deepEqual(visibleLines("", 10), [""])
})
