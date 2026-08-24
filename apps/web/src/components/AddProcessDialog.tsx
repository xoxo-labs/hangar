import { connIdOf, displayName } from "@hangar/client-core"
import type { Project } from "@hangar/contracts"
import { type FormEvent, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { authHeaders, serverOrigin } from "../links"
import { connectionOf, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { TextInput } from "../ui/Field"
import {
  filterPackageScripts,
  groupPackageScripts,
  type PackageScript,
  SCRIPT_FILTER_THRESHOLD,
} from "./packageScripts.logic"

const ELLIPSIS = "overflow-hidden text-ellipsis whitespace-nowrap"
const ADD_BUTTON =
  "py-[3px] text-base text-surface-10 enabled:hover:text-accent-9 disabled:cursor-default disabled:text-surface-7"

type DetectedPackage = {
  manager: string
  scripts: PackageScript[]
  workspaceScriptCount?: number
}

/**
 * The quick way to grow a project from its context menu: package.json scripts
 * not yet in the process list, one Add each, plus a custom row for anything
 * package.json doesn't know. The full editor stays the place for cwd, env and
 * reordering.
 */
export function AddProcessDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const connections = useStore((state) => state.connections)
  const config = connectionOf(connections, connIdOf(project.name)).config
  const [detected, setDetected] = useState<DetectedPackage | null>(null)
  const [inspecting, setInspecting] = useState(true)
  const [query, setQuery] = useState("")
  const [customName, setCustomName] = useState("")
  const [customCmd, setCustomCmd] = useState("")

  // The path is fixed here, so one inspection on mount — no debounce needed.
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${serverOrigin(config)}/project-info?path=${encodeURIComponent(project.path)}`, {
      headers: authHeaders(config),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not inspect project")
        return response.json() as Promise<{ package: DetectedPackage | null }>
      })
      .then((info) => setDetected(info.package))
      .catch(() => setDetected(null))
      .finally(() => {
        if (!controller.signal.aborted) setInspecting(false)
      })
    return () => controller.abort()
  }, [config, project.path])

  const names = new Set(project.processes.map((process) => process.name))

  const addScript = (script: PackageScript): void => {
    actions.upsertProject({
      ...project,
      processes: [
        ...project.processes,
        { name: script.name, cmd: script.cmd, ...(script.cwd ? { cwd: script.cwd } : {}) },
      ],
    })
  }

  const trimmedName = customName.trim()
  const customProblem =
    trimmedName === "" || customCmd.trim() === ""
      ? "empty"
      : /[\s/]/.test(trimmedName)
        ? "invalid"
        : names.has(trimmedName)
          ? "taken"
          : null

  const addCustom = (event: FormEvent): void => {
    event.preventDefault()
    if (customProblem !== null) return
    actions.upsertProject({
      ...project,
      processes: [...project.processes, { name: trimmedName, cmd: customCmd.trim() }],
    })
    setCustomName("")
    setCustomCmd("")
  }

  const scripts = detected?.scripts ?? []
  const filterable = scripts.length > SCRIPT_FILTER_THRESHOLD
  const shown = filterable ? filterPackageScripts(scripts, query) : scripts

  return createPortal(
    <Overlay onDismiss={onClose}>
      <Dialog
        label={`Add process to ${displayName(project.name)}`}
        className="w-[min(560px,100%)]!"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <DialogHeader title={`Add process to ${displayName(project.name)}`} />
        <DialogBody>
          <div className="flex w-full flex-col items-start gap-[5px]">
            <span className="text-sm tracking-label text-surface-10">
              {detected
                ? detected.workspaceScriptCount
                  ? `Monorepo scripts · ${detected.manager}`
                  : `package.json scripts · ${detected.manager}`
                : "Detected scripts"}
            </span>
            {filterable && (
              <TextInput
                className="py-1 text-sm"
                value={query}
                spellCheck={false}
                autoComplete="off"
                placeholder="Filter scripts…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || query === "") return
                  event.stopPropagation()
                  setQuery("")
                }}
              />
            )}
            <div className="max-h-[240px] w-full overflow-y-auto rounded-md border border-surface-5 bg-surface-1">
              {inspecting && <p className="px-2 py-2.5 text-sm text-surface-9">Inspecting package.json…</p>}
              {!inspecting && scripts.length === 0 && (
                <p className="px-2 py-2.5 text-sm text-surface-9">
                  No package.json scripts found here — add a custom command below.
                </p>
              )}
              {!inspecting && scripts.length > 0 && shown.length === 0 && (
                <p className="px-2 py-2.5 text-sm text-surface-9">No matching scripts</p>
              )}
              {groupPackageScripts(shown).map((group) => (
                <section key={group.label}>
                  <div className="sticky top-0 z-[1] flex items-center border-b border-surface-5 bg-surface-2 px-2 py-1 text-2xs font-semibold tracking-caps text-surface-9 uppercase">
                    <span className="truncate">{group.label}</span>
                    <span className="ml-auto font-normal tabular-nums text-surface-8">{group.scripts.length}</span>
                  </div>
                  {group.scripts.map((script) => {
                    const added = names.has(script.name)
                    const label = script.workspace ? script.name.slice(script.workspace.length + 1) : script.name
                    return (
                      <div
                        key={script.name}
                        className="grid min-h-[28px] grid-cols-[minmax(70px,0.7fr)_minmax(120px,2fr)_42px] items-center gap-2 border-b border-surface-4 px-[7px] py-[3px] last:border-b-0"
                        title={`${script.name}: ${script.value}`}
                      >
                        <code className={cx(ELLIPSIS, "text-sm text-surface-12")}>{label}</code>
                        <span className={cx(ELLIPSIS, "font-mono text-xs text-surface-9")}>{script.value}</span>
                        <button
                          type="button"
                          className={cx(ADD_BUTTON, "justify-self-end")}
                          disabled={added}
                          onClick={() => addScript(script)}
                        >
                          {added ? "Added" : "+ Add"}
                        </button>
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          </div>

          <form className="flex w-full flex-col items-start gap-[5px]" onSubmit={addCustom}>
            <span className="text-sm tracking-label text-surface-10">Custom command</span>
            <div className="flex w-full gap-1.5">
              <TextInput
                className="w-[130px] flex-none"
                value={customName}
                spellCheck={false}
                autoComplete="off"
                placeholder="name"
                aria-label="Process name"
                onChange={(event) => setCustomName(event.target.value)}
              />
              <TextInput
                mono
                value={customCmd}
                spellCheck={false}
                autoComplete="off"
                placeholder="pnpm run dev"
                aria-label="Command"
                onChange={(event) => setCustomCmd(event.target.value)}
              />
              <Button type="submit" className="flex-none" disabled={customProblem !== null}>
                Add
              </Button>
            </div>
            <span className="text-xs text-surface-9">
              {customProblem === "taken"
                ? `A process named ${trimmedName} already exists.`
                : customProblem === "invalid"
                  ? "Names carry no spaces or slashes."
                  : "Runs from the project root; use Edit project for a working directory."}
            </span>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              actions.openEmptyTerminal(project)
              onClose()
            }}
          >
            Open empty terminal
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>,
    document.body,
  )
}
