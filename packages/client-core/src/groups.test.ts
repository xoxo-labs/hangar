import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Project } from "@hangar/contracts"
import { buildSidebarModel, flatEntries, type SidebarEntry, type SidebarGroup } from "./groups.ts"

const project = (name: string, gitRemote?: string, processes: string[] = ["dev"]): Project => ({
  name,
  path: `/repos/${name}`,
  gitRemote,
  processes: processes.map((process) => ({ name: process, cmd: `run ${process}` })),
})

/** "group: entry(machine+machine)" — the shape every assertion below reads. */
const sketch = (groups: SidebarGroup[]): string =>
  groups
    .map(
      (group) =>
        `${group.connId}: ${group.entries.map((entry) => `${entry.key}(${entry.parts.map((part) => part.connId).join("+")})`).join(", ")}`,
    )
    .join(" | ")

/** The single entry a model is expected to hold. */
const only = (groups: SidebarGroup[]): SidebarEntry => flatEntries(groups)[0]!

const processNames = (entry: SidebarEntry): string[][] =>
  entry.parts.map((part) => part.processes.map((process) => process.name))

describe("buildSidebarModel", () => {
  it("keeps one machine exactly as it comes in, gitRemote or not", () => {
    const projects = [project("local::api", "github.com/acme/api"), project("local::web")]
    const groups = buildSidebarModel(["local"], projects, "")
    assert.equal(sketch(groups), "local: local::api(local), local::web(local)")
    assert.deepEqual(
      flatEntries(groups).map((entry) => entry.parts[0].project),
      projects,
    )
  })

  it("never merges two checkouts of one repo on a single machine", () => {
    const groups = buildSidebarModel(
      ["local"],
      [project("local::api", "github.com/acme/api"), project("local::api-2", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local), local::api-2(local)")
  })

  it("merges the same repo across machines, anchored at the first connection", () => {
    const groups = buildSidebarModel(
      ["local", "mini"],
      [project("local::api", "github.com/acme/api"), project("mini::api", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local+mini) | mini: ")
    assert.deepEqual(
      only(groups).parts.map((part) => part.project.name),
      ["local::api", "mini::api"],
    )
  })

  it("anchors by connection order, not by position in the project list", () => {
    const groups = buildSidebarModel(
      ["local", "mini"],
      [project("mini::api", "github.com/acme/api"), project("local::api", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local+mini) | mini: ")
  })

  it("merges across three machines into one entry", () => {
    const groups = buildSidebarModel(
      ["local", "mini", "studio"],
      [
        project("local::api", "github.com/acme/api"),
        project("mini::api", "github.com/acme/api"),
        project("studio::api", "github.com/acme/api"),
      ],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local+mini+studio) | mini:  | studio: ")
  })

  it("leaves alone anything without a shared, non-empty remote", () => {
    const groups = buildSidebarModel(
      ["local", "mini"],
      [
        project("local::api", "github.com/acme/api"),
        project("mini::api", "github.com/acme/other"),
        project("local::web"),
        project("mini::web"),
      ],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local), local::web(local) | mini: mini::api(mini), mini::web(mini)")
  })

  it("disables merging for a remote that is ambiguous on any machine", () => {
    const groups = buildSidebarModel(
      ["local", "mini"],
      [
        project("local::api", "github.com/acme/api"),
        project("local::api-clone", "github.com/acme/api"),
        project("mini::api", "github.com/acme/api"),
      ],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local), local::api-clone(local) | mini: mini::api(mini)")
  })

  it("merges repos whose names differ per machine, keeping the anchor's key", () => {
    const groups = buildSidebarModel(
      ["local", "mini"],
      [project("local::api", "github.com/acme/api"), project("mini::acme-api", "github.com/acme/api")],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local+mini) | mini: ")
  })

  it("keeps a group for every connection, and one for machines that went away", () => {
    const groups = buildSidebarModel(["local", "mini"], [project("gone::api", "github.com/acme/api")], "")
    assert.equal(sketch(groups), "local:  | mini:  | gone: gone::api(gone)")
  })

  it("orders groups by connection, whatever order the projects arrive in", () => {
    const groups = buildSidebarModel(
      ["local", "mini"],
      [project("mini::web"), project("local::api"), project("mini::api")],
      "",
    )
    assert.equal(sketch(groups), "local: local::api(local) | mini: mini::web(mini), mini::api(mini)")
  })
})

describe("buildSidebarModel filtering", () => {
  const merged = [
    project("local::api", "github.com/acme/api", ["dev", "test"]),
    project("mini::api", "github.com/acme/api", ["dev", "deploy"]),
  ]

  it("keeps every machine of a merged entry when the name matches", () => {
    const groups = buildSidebarModel(["local", "mini"], merged, "ap")
    assert.equal(sketch(groups), "local: local::api(local+mini) | mini: ")
    assert.deepEqual(processNames(only(groups)), [
      ["dev", "test"],
      ["dev", "deploy"],
    ])
  })

  it("finds processes inside a merged entry, on either machine", () => {
    const groups = buildSidebarModel(["local", "mini"], merged, "dev")
    assert.equal(sketch(groups), "local: local::api(local+mini) | mini: ")
    assert.deepEqual(processNames(only(groups)), [["dev"], ["dev"]])
  })

  it("drops the machines of a merged entry that match nothing", () => {
    const groups = buildSidebarModel(["local", "mini"], merged, "test")
    assert.equal(sketch(groups), "local: local::api(local) | mini: ")
    assert.deepEqual(processNames(only(groups)), [["test"]])
  })

  it("re-anchors a merged entry when the filter strips its anchor", () => {
    const groups = buildSidebarModel(["local", "mini"], merged, "deploy")
    assert.equal(sketch(groups), "local:  | mini: mini::api(mini)")
  })

  it("filters unmerged projects exactly as before", () => {
    const projects = [project("local::api", undefined, ["dev"]), project("local::web", undefined, ["serve"])]
    assert.equal(sketch(buildSidebarModel(["local"], projects, "serve")), "local: local::web(local)")
    assert.equal(sketch(buildSidebarModel(["local"], projects, "api")), "local: local::api(local)")
    assert.equal(flatEntries(buildSidebarModel(["local"], projects, "nope")).length, 0)
  })

  it("keeps a name-matched project with no matching process whole", () => {
    const groups = buildSidebarModel(["local"], [project("local::api", undefined, ["dev"])], "api")
    assert.deepEqual(processNames(only(groups)), [["dev"]])
  })
})
