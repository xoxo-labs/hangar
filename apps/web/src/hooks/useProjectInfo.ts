import { useEffect, useState } from "react"
import type { ConnectionConfig } from "@hangar/client-core"
import { authHeaders, serverOrigin } from "../links"
import type { PackageScript } from "../components/packageScripts.logic"

export type PackageInfo = {
  name: string | null
  manager: string
  scripts: PackageScript[]
  workspaceScriptCount?: number
}

export type ProjectInfo = {
  path: string
  exists: boolean
  package: null | PackageInfo
}

/** How long an answer is served as-is before a lookup is quietly repeated. */
const FRESH_MS = 30_000
/** Typing pause before an unseen path is inspected; a known path pays nothing. */
const DEBOUNCE_MS = 250

/*
 * One answer per machine and path, shared by every dialog that asks. A
 * project's tabs remount their form per machine, so without this each switch
 * re-inspected the same folder — and a switch mid-request threw the answer
 * away. A stale entry is still shown at once and refreshed behind the scenes.
 */
const cache = new Map<string, { info: ProjectInfo; at: number }>()
const inflight = new Map<string, Promise<ProjectInfo>>()

function inspect(config: ConnectionConfig, key: string, path: string): Promise<ProjectInfo> {
  const pending = inflight.get(key)
  if (pending) return pending
  const request = fetch(`${serverOrigin(config)}/project-info?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(config),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Could not inspect project")
      return response.json() as Promise<ProjectInfo>
    })
    .then((info) => {
      cache.set(key, { info, at: Date.now() })
      return info
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, request)
  return request
}

/**
 * Inspects a folder on the machine the project lives on: package.json, its
 * manager, and monorepo workspace scripts. `inspecting` is true from the first
 * render of a path nothing has answered for yet, so a dialog never claims
 * "no package.json" about a folder it has not looked at.
 */
export function useProjectInfo(
  config: ConnectionConfig,
  path: string,
): { info: ProjectInfo | null; inspecting: boolean } {
  const candidate = path.trim()
  const key = `${config.id}\n${candidate}`
  const known = cache.get(key)
  const [info, setInfo] = useState<ProjectInfo | null>(known?.info ?? null)
  const [inspecting, setInspecting] = useState(candidate !== "" && known === undefined)

  useEffect(() => {
    if (candidate === "") {
      setInfo(null)
      setInspecting(false)
      return
    }
    let cancelled = false
    const cached = cache.get(key)
    const fresh = cached !== undefined && Date.now() - cached.at < FRESH_MS
    setInfo(cached?.info ?? null)
    setInspecting(cached === undefined)
    if (fresh) return

    const run = (): void => {
      inspect(config, key, candidate)
        .then((next) => {
          if (!cancelled) setInfo(next)
        })
        .catch(() => {
          if (!cancelled && cached === undefined) setInfo(null)
        })
        .finally(() => {
          if (!cancelled) setInspecting(false)
        })
    }
    // A revalidation of something already on screen can go now; an unseen
    // path may still be mid-typing and waits for the pause.
    const timer = cached === undefined ? window.setTimeout(run, DEBOUNCE_MS) : null
    if (timer === null) run()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [key, candidate, config])

  return { info, inspecting }
}
