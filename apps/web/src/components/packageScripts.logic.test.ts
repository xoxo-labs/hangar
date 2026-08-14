import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { filterPackageScripts, groupPackageScripts, type PackageScript } from "./packageScripts.logic.ts"

const script = (name: string, value: string, workspace?: string): PackageScript => ({
  name: workspace === undefined ? name : `${workspace}/${name}`,
  value,
  cmd: `pnpm run ${name}`,
  ...(workspace === undefined ? {} : { workspace, cwd: `apps/${workspace}` }),
})

const scripts = [
  script("dev", "hangar dev"),
  script("build", "turbo build"),
  script("dev", "vite --port 4790", "web"),
  script("test", "node --test src/**/*.test.ts", "web"),
  script("build", "tsc -p .", "server"),
]

const names = (list: PackageScript[]): string[] => list.map((entry) => entry.name)

describe("filterPackageScripts", () => {
  it("returns everything for an empty or blank query", () => {
    assert.deepEqual(filterPackageScripts(scripts, ""), scripts)
    assert.deepEqual(filterPackageScripts(scripts, "   "), scripts)
  })

  it("matches the display name, prefix included", () => {
    assert.deepEqual(names(filterPackageScripts(scripts, "web/dev")), ["web/dev"])
    assert.deepEqual(names(filterPackageScripts(scripts, "build")), ["build", "server/build"])
  })

  it("matches the workspace label", () => {
    assert.deepEqual(names(filterPackageScripts(scripts, "server")), ["server/build"])
  })

  it("matches the command it runs", () => {
    assert.deepEqual(names(filterPackageScripts(scripts, "vite")), ["web/dev"])
    assert.deepEqual(names(filterPackageScripts(scripts, "--port")), ["web/dev"])
  })

  it("ignores case on both sides", () => {
    assert.deepEqual(names(filterPackageScripts(scripts, "TURBO")), ["build"])
    assert.deepEqual(names(filterPackageScripts([script("Lint", "Biome Check")], "biome check")), ["Lint"])
  })

  it("can't match across two fields", () => {
    // "dev" ends the name and "vite" starts the command; neither field holds both.
    assert.deepEqual(filterPackageScripts(scripts, "dev vite"), [])
  })

  it("returns nothing when nothing matches", () => {
    assert.deepEqual(filterPackageScripts(scripts, "deploy"), [])
  })
})

describe("groupPackageScripts", () => {
  it("keeps root scripts together and splits workspaces by label", () => {
    assert.deepEqual(
      groupPackageScripts(scripts).map((group) => [group.label, group.scripts.length]),
      [
        ["Root", 2],
        ["web", 2],
        ["server", 1],
      ],
    )
  })

  it("drops groups a filter emptied", () => {
    assert.deepEqual(
      groupPackageScripts(filterPackageScripts(scripts, "web")).map((group) => group.label),
      ["web"],
    )
    assert.deepEqual(groupPackageScripts(filterPackageScripts(scripts, "deploy")), [])
  })
})
