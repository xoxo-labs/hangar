import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const { gitRemoteFor, normalizeGitUrl } = await import("./git.ts")

function repoFixture(url: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "hangar-git-"))
  mkdirSync(join(root, ".git"), { recursive: true })
  const remote =
    url === null ? "" : `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
  writeFileSync(join(root, ".git", "config"), `[core]\n\tbare = false\n${remote}`)
  return root
}

test("normalizes every remote URL flavour to host/owner/repo", () => {
  const cases: [string, string | undefined][] = [
    ["git@github.com:xoxo-labs/Hangar.git", "github.com/xoxo-labs/hangar"],
    ["git@GitHub.com:xoxo-labs/hangar", "github.com/xoxo-labs/hangar"],
    ["ssh://git@github.com:2222/xoxo-labs/hangar.git", "github.com/xoxo-labs/hangar"],
    ["ssh://github.com/xoxo-labs/hangar", "github.com/xoxo-labs/hangar"],
    ["https://user:token@github.com/xoxo-labs/hangar.git", "github.com/xoxo-labs/hangar"],
    ["https://github.com:443/xoxo-labs/hangar.git/", "github.com/xoxo-labs/hangar"],
    ["http://git.example.org/xoxo-labs/hangar.git", "git.example.org/xoxo-labs/hangar"],
    ["git://github.com/xoxo-labs/hangar.git", "github.com/xoxo-labs/hangar"],
    ["https://gitlab.com/group/subgroup/team/hangar.git", "gitlab.com/group/subgroup/team/hangar"],
    ["git@gitlab.com:group/subgroup/team/hangar.git", "gitlab.com/group/subgroup/team/hangar"],
    ["git@bitbucket.org:/owner/repo.git", "bitbucket.org/owner/repo"],
    ["git@host.example:repo.git", "host.example/repo"],
    // Local remotes can't identify a repo on another machine.
    ["/Users/sorin/code/hangar", undefined],
    ["./sibling-repo", undefined],
    ["../sibling-repo/.git", undefined],
    ["~/code/hangar", undefined],
    ["file:///Users/sorin/code/hangar", undefined],
    ["C:\\code\\hangar", undefined],
    // Unparsable or empty.
    ["", undefined],
    ["   ", undefined],
    ["https://github.com", undefined],
    ["ssh://git@github.com/", undefined],
    ["not a url", undefined],
  ]
  for (const [url, expected] of cases) {
    assert.equal(normalizeGitUrl(url), expected, `normalizeGitUrl(${JSON.stringify(url)})`)
  }
})

test("reads origin from a plain .git directory", () => {
  const root = repoFixture("git@github.com:xoxo-labs/hangar.git")
  assert.equal(gitRemoteFor(root), "github.com/xoxo-labs/hangar")
})

test("walks up from a subdirectory of the repo", () => {
  const root = repoFixture("https://github.com/xoxo-labs/hangar.git")
  const nested = join(root, "apps", "server", "src")
  mkdirSync(nested, { recursive: true })
  assert.equal(gitRemoteFor(nested), "github.com/xoxo-labs/hangar")
})

test("follows the gitdir: indirection of worktrees and submodules", () => {
  const host = repoFixture("git@github.com:xoxo-labs/host.git")
  const moduleDir = join(host, ".git", "modules", "vendor")
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(join(moduleDir, "config"), `[remote "origin"]\n\turl = git@github.com:xoxo-labs/vendor.git\n`)

  // Absolute gitdir.
  const absolute = join(host, "vendor-absolute")
  mkdirSync(absolute, { recursive: true })
  writeFileSync(join(absolute, ".git"), `gitdir: ${moduleDir}\n`)
  assert.equal(gitRemoteFor(absolute), "github.com/xoxo-labs/vendor")

  // Relative gitdir, resolved against the directory holding the .git file.
  const relative = join(host, "vendor-relative")
  mkdirSync(relative, { recursive: true })
  writeFileSync(join(relative, ".git"), "gitdir: ../.git/modules/vendor\n")
  assert.equal(gitRemoteFor(relative), "github.com/xoxo-labs/vendor")

  // A linked worktree has no config of its own; commondir points at the shared one.
  const worktreeGitDir = join(host, ".git", "worktrees", "wt")
  mkdirSync(worktreeGitDir, { recursive: true })
  writeFileSync(join(worktreeGitDir, "commondir"), "../..\n")
  const worktree = mkdtempSync(join(tmpdir(), "hangar-git-wt-"))
  writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`)
  assert.equal(gitRemoteFor(worktree), "github.com/xoxo-labs/host")
})

test("returns undefined without origin, without a repo, and for local remotes", () => {
  assert.equal(gitRemoteFor(repoFixture(null)), undefined)
  assert.equal(gitRemoteFor(repoFixture("/Users/sorin/code/mirror")), undefined)
  assert.equal(gitRemoteFor(mkdtempSync(join(tmpdir(), "hangar-nogit-"))), undefined)
  assert.equal(gitRemoteFor(join(tmpdir(), "hangar-does-not-exist-", String(Date.now()))), undefined)
})

test("the cache follows the config's mtime", () => {
  const root = repoFixture("git@github.com:xoxo-labs/before.git")
  assert.equal(gitRemoteFor(root), "github.com/xoxo-labs/before")
  const config = join(root, ".git", "config")
  writeFileSync(config, `[remote "origin"]\n\turl = git@github.com:xoxo-labs/after.git\n`)
  const later = new Date(Date.now() + 2000)
  utimesSync(config, later, later)
  assert.equal(gitRemoteFor(root), "github.com/xoxo-labs/after")
})

test("the state message carries gitRemote without touching the registry", async () => {
  const home = mkdtempSync(join(tmpdir(), "hangar-git-home-"))
  process.env.HANGAR_HOME = home
  const root = repoFixture("git@github.com:xoxo-labs/state.git")
  const { loadRegistry, saveRegistry } = await import("./registry.ts")

  saveRegistry({ version: 1, projects: [{ name: "state", path: root, processes: [{ name: "dev", cmd: "true" }] }] })
  const project = loadRegistry().projects[0]
  assert.ok(project)

  // The same shape stateMsg() builds: a spread copy, never the registry object.
  const wire = { ...project, gitRemote: gitRemoteFor(project.path) }
  assert.equal(wire.gitRemote, "github.com/xoxo-labs/state")
  assert.equal("gitRemote" in project, false)
  assert.equal("gitRemote" in (loadRegistry().projects[0] as object), false)
})
