import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { browseDirectories } from "./serve.ts"

/**
 * One directory that holds every shape the picker has to survive: a project, a
 * plain folder, a dotfile, a file, a symlinked checkout and a dangling link.
 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hangar-browse-"))
  mkdirSync(join(root, "project-a", ".git"), { recursive: true })
  writeFileSync(join(root, "project-a", "package.json"), "{}\n")
  mkdirSync(join(root, "project-b"))
  mkdirSync(join(root, "other"))
  mkdirSync(join(root, ".hidden"))
  writeFileSync(join(root, "notes.txt"), "not a directory\n")
  symlinkSync(join(root, "project-b"), join(root, "project-link"))
  symlinkSync(join(root, "gone"), join(root, "broken-link"))
  return root
}

const ROOT = fixture()
after(() => rmSync(ROOT, { recursive: true, force: true }))

const names = (path: string): string[] => browseDirectories(path).entries.map((entry) => entry.name)

test("a trailing separator lists the directory itself", () => {
  const result = browseDirectories(`${ROOT}/`)
  assert.equal(result.parent, ROOT)
  assert.equal(result.prefix, "")
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["other", "project-a", "project-b", "project-link"],
  )
  assert.equal(result.truncated, false)
})

test("the last typed segment filters the directory above it", () => {
  const result = browseDirectories(join(ROOT, "pro"))
  assert.equal(result.parent, ROOT)
  assert.equal(result.prefix, "pro")
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["project-a", "project-b", "project-link"],
  )
})

test("prefix matching ignores case, because typing does", () => {
  assert.deepEqual(names(join(ROOT, "PrO")), ["project-a", "project-b", "project-link"])
})

test("dotted entries appear only once the dot is typed", () => {
  assert.equal(names(`${ROOT}/`).includes(".hidden"), false)
  assert.deepEqual(names(join(ROOT, ".h")), [".hidden"])
})

test("files are never offered, only directories", () => {
  assert.equal(names(`${ROOT}/`).includes("notes.txt"), false)
  assert.deepEqual(names(join(ROOT, "notes")), [])
})

test("a symlinked checkout is a directory; a dangling one is nothing", () => {
  const linked = browseDirectories(join(ROOT, "project-link")).entries
  assert.deepEqual(
    linked.map((entry) => entry.name),
    ["project-link"],
  )
  assert.deepEqual(names(join(ROOT, "broken")), [])
})

test("git and package.json are what mark a folder as a project", () => {
  const entries = browseDirectories(join(ROOT, "pro")).entries
  const projectA = entries.find((entry) => entry.name === "project-a")
  assert.deepEqual(projectA, { name: "project-a", path: join(ROOT, "project-a"), git: true, pkg: true })
  const projectB = entries.find((entry) => entry.name === "project-b")
  assert.deepEqual(projectB, { name: "project-b", path: join(ROOT, "project-b"), git: false, pkg: false })
})

test("an unreadable or missing directory is a dead end, not an error", () => {
  const result = browseDirectories(`${join(ROOT, "nowhere")}/`)
  assert.equal(result.parent, join(ROOT, "nowhere"))
  assert.deepEqual(result.entries, [])
  assert.equal(result.truncated, false)
})

test("an empty path browses home, where picking a project starts", () => {
  for (const input of ["", "   ", "~"]) {
    const result = browseDirectories(input)
    assert.equal(result.parent, homedir(), input)
    assert.equal(result.prefix, "", input)
  }
})
