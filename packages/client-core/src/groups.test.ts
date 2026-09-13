import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Project } from "@hangar/contracts"
import { buildSidebarEntries, type SidebarEntry } from "./groups.ts"

const project = (name: string, gitRemote?: string, processes: string[] = ["dev"]): Project => ({
  name,
  path: `/repos/${name}`,
  gitRemote,
  processes: processes.map((process) => ({ name: process, cmd: `run ${process}` })),
})

/** "entry(machine+machine), entry(machine)" — the shape every assertion below reads. */
const sketch = (entries: SidebarEntry[]): string =>
  entries.map((entry) => `${entry.key}(${entry.parts.map((part) => part.connId).join("+")})`).join(", ")

const presences = (entries: SidebarEntry[]): string[] => entries.map((entry) => entry.presence)

/** The single entry a model is expected to hold. */
const only = (entries: SidebarEntry[]): SidebarEntry => entries[0]!

const processNames = (entry: SidebarEntry): string[][] =>
  entry.parts.map((part) => part.processes.map((process) => process.name))

describe("buildSidebarEntries", () => {
  it("keeps one machine exactly as it comes in, gitRemote or not", () => {
    const projects = [project("local::api", "github.com/acme/api"), project("local::web")]
    const entries = buildSidebarEntries(["local"], projects, "")
    assert.equal(sketch(entries), "local::api(local), local::web(local)")
    assert.deepEqual(
      entries.map((entry) => entry.parts[0].project),
      projects,
    )
    assert.deepEqual(presences(entries), ["local-only", "local-only"])
  })

  it("never merges two checkouts of one repo on a single machine", () => {
    const entries = buildSidebarEntries(
      ["local"],
      [project("local::api", "github.com/acme/api"), project("local::api-2", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(entries), "local::api(local), local::api-2(local)")
  })

  it("merges the same repo across machines into one mixed entry anchored at the first connection", () => {
    const entries = buildSidebarEntries(
      ["local", "mini"],
      [project("local::api", "github.com/acme/api"), project("mini::api", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(entries), "local::api(local+mini)")
    assert.deepEqual(
      only(entries).parts.map((part) => part.project.name),
      ["local::api", "mini::api"],
    )
    assert.deepEqual(presences(entries), ["mixed"])
  })

  it("anchors by connection order, not by position in the project list", () => {
    const entries = buildSidebarEntries(
      ["local", "mini"],
      [project("mini::api", "github.com/acme/api"), project("local::api", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(entries), "local::api(local+mini)")
  })

  it("merges across three machines into one entry", () => {
    const entries = buildSidebarEntries(
      ["local", "mini", "studio"],
      [
        project("local::api", "github.com/acme/api"),
        project("mini::api", "github.com/acme/api"),
        project("studio::api", "github.com/acme/api"),
      ],
      "",
    )
    assert.equal(sketch(entries), "local::api(local+mini+studio)")
  })

  it("keeps a repo shared by two paired machines remote-only", () => {
    const entries = buildSidebarEntries(
      ["local", "mini", "studio"],
      [
        project("local::web"),
        project("mini::api", "github.com/acme/api"),
        project("studio::api", "github.com/acme/api"),
      ],
      "",
    )
    assert.equal(sketch(entries), "local::web(local), mini::api(mini+studio)")
    assert.deepEqual(presences(entries), ["local-only", "remote-only"])
  })

  it("leaves alone anything without a shared, non-empty remote", () => {
    const entries = buildSidebarEntries(
      ["local", "mini"],
      [
        project("local::api", "github.com/acme/api"),
        project("mini::api", "github.com/acme/other"),
        project("local::web"),
        project("mini::web"),
      ],
      "",
    )
    assert.equal(sketch(entries), "local::api(local), mini::api(mini), local::web(local), mini::web(mini)")
    assert.deepEqual(presences(entries), ["local-only", "remote-only", "local-only", "remote-only"])
  })

  it("disables merging for a remote that is ambiguous on any machine", () => {
    const entries = buildSidebarEntries(
      ["local", "mini"],
      [
        project("local::api", "github.com/acme/api"),
        project("local::api-clone", "github.com/acme/api"),
        project("mini::api", "github.com/acme/api"),
      ],
      "",
    )
    assert.equal(sketch(entries), "local::api(local), local::api-clone(local), mini::api(mini)")
  })

  it("merges repos whose names differ per machine, keeping the anchor's key", () => {
    const entries = buildSidebarEntries(
      ["local", "mini"],
      [project("local::api", "github.com/acme/api"), project("mini::acme-api", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(entries), "local::api(local+mini)")
  })

  it("still lists a project whose machine went away", () => {
    const entries = buildSidebarEntries(["local", "mini"], [project("gone::api", "github.com/acme/api")], "")
    assert.equal(sketch(entries), "gone::api(gone)")
    assert.deepEqual(presences(entries), ["remote-only"])
  })

  it("keeps the incoming order: the local registry first, then each machine's own", () => {
    const entries = buildSidebarEntries(
      ["local", "mini"],
      [project("local::api"), project("local::web"), project("mini::web"), project("mini::api")],
      "",
    )
    assert.equal(sketch(entries), "local::api(local), local::web(local), mini::web(mini), mini::api(mini)")
  })
})

describe("buildSidebarEntries filtering", () => {
  const merged = [
    project("local::api", "github.com/acme/api", ["dev", "test"]),
    project("mini::api", "github.com/acme/api", ["dev", "deploy"]),
  ]

  it("keeps every machine of a merged entry when the name matches", () => {
    const entries = buildSidebarEntries(["local", "mini"], merged, "ap")
    assert.equal(sketch(entries), "local::api(local+mini)")
    assert.deepEqual(processNames(only(entries)), [
      ["dev", "test"],
      ["dev", "deploy"],
    ])
  })

  it("finds processes inside a merged entry, on either machine", () => {
    const entries = buildSidebarEntries(["local", "mini"], merged, "dev")
    assert.equal(sketch(entries), "local::api(local+mini)")
    assert.deepEqual(processNames(only(entries)), [["dev"], ["dev"]])
  })

  it("drops the machines of a merged entry that match nothing", () => {
    const entries = buildSidebarEntries(["local", "mini"], merged, "test")
    assert.equal(sketch(entries), "local::api(local)")
    assert.deepEqual(processNames(only(entries)), [["test"]])
    assert.deepEqual(presences(entries), ["local-only"])
  })

  it("re-anchors a merged entry when the filter strips its anchor", () => {
    const entries = buildSidebarEntries(["local", "mini"], merged, "deploy")
    assert.equal(sketch(entries), "mini::api(mini)")
    assert.deepEqual(presences(entries), ["remote-only"])
  })

  it("filters unmerged projects exactly as before", () => {
    const projects = [project("local::api", undefined, ["dev"]), project("local::web", undefined, ["serve"])]
    assert.equal(sketch(buildSidebarEntries(["local"], projects, "serve")), "local::web(local)")
    assert.equal(sketch(buildSidebarEntries(["local"], projects, "api")), "local::api(local)")
    assert.equal(buildSidebarEntries(["local"], projects, "nope").length, 0)
  })

  it("keeps a name-matched project with no matching process whole", () => {
    const entries = buildSidebarEntries(["local"], [project("local::api", undefined, ["dev"])], "api")
    assert.deepEqual(processNames(only(entries)), [["dev"]])
  })
})
