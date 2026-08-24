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

/**
 * Inspects a folder on the machine the project lives on: package.json, its
 * manager, and monorepo workspace scripts. Debounced because the project
 * dialog feeds it a path mid-typing; a fixed path just pays the delay once.
 */
export function useProjectInfo(
  config: ConnectionConfig,
  path: string,
): { info: ProjectInfo | null; inspecting: boolean } {
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [inspecting, setInspecting] = useState(false)

  useEffect(() => {
    const candidate = path.trim()
    if (candidate === "") {
      setInfo(null)
      setInspecting(false)
      return
    }

    setInfo(null)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setInspecting(true)
      fetch(`${serverOrigin(config)}/project-info?path=${encodeURIComponent(candidate)}`, {
        headers: authHeaders(config),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not inspect project")
          return response.json() as Promise<ProjectInfo>
        })
        .then(setInfo)
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setInfo(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setInspecting(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [path, config])

  return { info, inspecting }
}
