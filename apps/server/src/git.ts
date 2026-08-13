import { readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { expandHome } from "./registry.ts"

/** Transports that can name the same repo from another machine; `file://` deliberately cannot. */
const SCHEMES = new Set(["ssh", "git", "http", "https"])

type Cached = { configPath: string; mtimeMs: number; gitRemote: string | undefined }

const cache = new Map<string, Cached>()

/** Walks up from `start` looking for `.git`, following the `gitdir:` file worktrees and submodules use. */
function findGitDir(start: string): string | undefined {
  let dir = start
  for (;;) {
    const dotGit = join(dir, ".git")
    let isFile = false
    try {
      const stats = statSync(dotGit)
      if (stats.isDirectory()) return dotGit
      isFile = stats.isFile()
    } catch {
      // No .git here — keep climbing.
    }
    if (isFile) {
      const match = readFileSync(dotGit, "utf8").match(/^\s*gitdir:\s*(.+?)\s*$/m)
      if (!match?.[1]) return undefined
      return isAbsolute(match[1]) ? match[1] : resolve(dir, match[1])
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Linked worktrees keep no config of their own; `commondir` points at the shared git dir. */
function configPathFor(gitDir: string): string {
  let commonDir = ""
  try {
    commonDir = readFileSync(join(gitDir, "commondir"), "utf8").trim()
  } catch {
    // Not a linked worktree.
  }
  if (commonDir === "") return join(gitDir, "config")
  return join(isAbsolute(commonDir) ? commonDir : resolve(gitDir, commonDir), "config")
}

function originUrl(config: string): string | undefined {
  let inOrigin = false
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("[")) {
      inOrigin = /^\[\s*remote\s+"origin"\s*\]/i.test(line)
      continue
    }
    if (!inOrigin) continue
    const match = line.match(/^url\s*=\s*(.*)$/i)
    if (match?.[1]) return match[1].trim().replace(/^"(.*)"$/, "$1")
  }
  return undefined
}

/** Drops credentials and the port; a single-character host is a Windows drive letter, not a host. */
function hostOf(authority: string): string | undefined {
  const at = authority.lastIndexOf("@")
  let host = at === -1 ? authority : authority.slice(at + 1)
  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    if (end === -1) return undefined
    host = host.slice(1, end)
  } else {
    const colon = host.indexOf(":")
    if (colon !== -1) host = host.slice(0, colon)
  }
  return host.length > 1 ? host.toLowerCase() : undefined
}

/** `host/owner/repo`, lowercased, or undefined for anything that can't identify a repo across machines. */
export function normalizeGitUrl(input: string): string | undefined {
  const url = input.trim()
  if (url === "") return undefined

  let authority: string
  let path: string
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (scheme?.[1]) {
    if (!SCHEMES.has(scheme[1].toLowerCase())) return undefined
    const rest = url.slice(scheme[0].length)
    const slash = rest.indexOf("/")
    if (slash === -1) return undefined
    authority = rest.slice(0, slash)
    path = rest.slice(slash)
  } else {
    // scp-like: [user@]host:path — a local path never has a colon before its first slash.
    const scp = url.match(/^([^/]*?):(.*)$/)
    if (!scp?.[2]) return undefined
    authority = scp[1] ?? ""
    path = scp[2]
  }

  const host = hostOf(authority)
  if (!host) return undefined

  const segments = path.split("/").filter((segment) => segment !== "")
  const last = segments.pop()?.replace(/\.git$/i, "")
  if (last !== undefined && last !== "") segments.push(last)
  if (segments.length === 0) return undefined

  return [host, ...segments].join("/").toLowerCase()
}

/**
 * Normalized origin identity for a project path, without shelling out to git.
 * Cached per path and invalidated by the config's mtime, so state broadcasts stay cheap.
 */
export function gitRemoteFor(projectPath: string): string | undefined {
  const cached = cache.get(projectPath)
  if (cached) {
    try {
      if (statSync(cached.configPath).mtimeMs === cached.mtimeMs) return cached.gitRemote
    } catch {
      // Config vanished — recompute below.
    }
  }
  try {
    const gitDir = findGitDir(resolve(expandHome(projectPath)))
    if (!gitDir) {
      cache.delete(projectPath)
      return undefined
    }
    const configPath = configPathFor(gitDir)
    const mtimeMs = statSync(configPath).mtimeMs
    const url = originUrl(readFileSync(configPath, "utf8"))
    const gitRemote = url === undefined ? undefined : normalizeGitUrl(url)
    cache.set(projectPath, { configPath, mtimeMs, gitRemote })
    return gitRemote
  } catch {
    cache.delete(projectPath)
    return undefined
  }
}
