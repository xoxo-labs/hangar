import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { type Row, toProject, uniqueTerminalName, validate } from "./projectForm.logic.ts"

let id = 0
const row = (overrides: Partial<Row>): Row => ({
  id: ++id,
  name: "web",
  cmd: "pnpm dev",
  cwd: "",
  shell: false,
  ...overrides,
})

describe("validate", () => {
  it("walks the required fields in order", () => {
    assert.equal(validate("", "~/x", [row({})]), "Name is required.")
    assert.equal(validate("my app", "~/x", [row({})]), "Name can't contain spaces or slashes.")
    assert.equal(validate("app", "", [row({})]), "Path is required.")
    assert.equal(validate("app", "~/x", []), "A project needs at least one process.")
    assert.equal(validate("app", "~/x", [row({ cmd: "" })]), "Every process needs a name and a command.")
    assert.equal(validate("app", "~/x", [row({}), row({})]), "Process names must be unique.")
    assert.equal(validate("app", "~/x", [row({})]), null)
  })

  it("lets a shell row omit its command", () => {
    assert.equal(validate("app", "~/x", [row({ name: "terminal", cmd: "", shell: true })]), null)
  })
})

describe("toProject", () => {
  it("trims and omits what is empty or default", () => {
    const project = toProject(" app ", " ~/x ", [row({ name: " web ", cmd: " pnpm dev ", cwd: " " })], undefined, "")
    assert.deepEqual(project, {
      name: "app",
      path: "~/x",
      processes: [{ name: "web", cmd: "pnpm dev" }],
    })
  })

  it("keeps what the dialog does not edit: description, browser, env", () => {
    const project = toProject(
      "app",
      "~/x",
      [row({ description: "the site", browser: "arc" })],
      { PORT: "3000" },
      "chrome",
    )
    assert.deepEqual(project.processes[0], { name: "web", cmd: "pnpm dev", description: "the site", browser: "arc" })
    assert.deepEqual(project.env, { PORT: "3000" })
    assert.equal(project.browser, "chrome")
  })

  it("empties a shell row's command and marks it", () => {
    assert.deepEqual(toProject("app", "~/x", [row({ cmd: "ignored", shell: true })], undefined, "").processes[0], {
      name: "web",
      cmd: "",
      shell: true,
    })
  })
})

describe("uniqueTerminalName", () => {
  it("takes the plain name first, then counts past what exists", () => {
    assert.equal(uniqueTerminalName([]), "terminal")
    assert.equal(uniqueTerminalName([row({ name: "terminal" })]), "terminal-2")
    assert.equal(uniqueTerminalName([row({ name: "terminal" }), row({ name: "terminal-2" })]), "terminal-3")
  })
})
