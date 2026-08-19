import assert from "node:assert/strict"
import { test } from "node:test"
import { commandShellFlags } from "./sessions.ts"

test("zsh and bash run commands interactively, so .zshrc-installed tools are on PATH", () => {
  for (const shell of ["/bin/zsh", "/opt/homebrew/bin/zsh", "/bin/bash", "/usr/local/bin/bash"]) {
    assert.equal(commandShellFlags(shell), "-ilc", shell)
  }
})

test("an unfamiliar shell keeps the login-only flags rather than a flag it may reject", () => {
  for (const shell of ["/bin/sh", "/bin/dash", "/opt/homebrew/bin/fish", "/usr/local/bin/nu", "/bin/ksh"]) {
    assert.equal(commandShellFlags(shell), "-lc", shell)
  }
})

test("the decision follows the shell's name, not the directory it happens to live in", () => {
  assert.equal(commandShellFlags("/Users/someone/zsh/bin/fish"), "-lc")
  assert.equal(commandShellFlags("/Users/someone/fish/bin/zsh"), "-ilc")
})
