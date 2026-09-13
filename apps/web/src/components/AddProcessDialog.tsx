import { connIdOf, displayName } from "@hangar/client-core"
import type { Project } from "@hangar/contracts"
import { type FormEvent, useState } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { useProjectInfo } from "../hooks/useProjectInfo"
import { connectionOf, machineLabel, useStore } from "../store"
import { Button } from "../ui/Button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { TextInput } from "../ui/Field"
import { cx } from "../ui/cx"
import { DetectedScripts } from "./DetectedScripts"
import { MachineTabs } from "./MachineTabs"
import type { PackageScript } from "./packageScripts.logic"

/**
 * The quick way to grow a project from its context menu: package.json scripts
 * not yet in the process list, one Add each, plus a custom row for anything
 * package.json doesn't know. The full editor stays the place for cwd, env and
 * reordering. A project the sidebar merged across machines arrives as one
 * copy per Mac; the tabs pick which Mac's copy grows.
 */
export function AddProcessDialog({ projects, onClose }: { projects: [Project, ...Project[]]; onClose: () => void }) {
  const connections = useStore((state) => state.connections)
  const [active, setActive] = useState(projects[0].name)
  const project = projects.find((item) => item.name === active) ?? projects[0]
  const tabbed = projects.length > 1
  const connection = connectionOf(connections, connIdOf(project.name))
  const config = connection.config
  const on = machineLabel(connection)
  const { info, inspecting } = useProjectInfo(config, project.path)
  const [customName, setCustomName] = useState("")
  const [customCmd, setCustomCmd] = useState("")

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

  return createPortal(
    <Overlay onDismiss={onClose}>
      <Dialog
        label={`Add process to ${displayName(project.name)}`}
        /* Pinned height with tabs, so switching Macs never re-centres the box. */
        className={
          tabbed ? "h-[min(560px,calc(100vh-48px))] w-[min(720px,100%)]! overflow-hidden" : "w-[min(560px,100%)]!"
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <div className={cx("flex min-h-0 flex-1", !tabbed && "flex-col")}>
          {tabbed && (
            <MachineTabs names={projects.map((item) => item.name)} active={project.name} onSelect={setActive} />
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            <DialogHeader title={tabbed ? `Add process on ${on}` : `Add process to ${displayName(project.name)}`} />
            {/* Reserved gutter: the list loads after the dialog opens, and its
             * scrollbar must not shift the custom-command row underneath. */}
            <DialogBody className={cx(tabbed && "flex-1 [scrollbar-gutter:stable]")}>
              {/* What the project already runs here, live from the registry: an
               * Add below shows up in this row the moment the server confirms it. */}
              <div className="flex w-full flex-col items-start gap-[5px]">
                <span className="text-sm tracking-label text-surface-10">
                  {tabbed ? `Processes on ${on}` : "Processes"}
                </span>
                {project.processes.length === 0 ? (
                  <span className="text-xs text-surface-9">None yet.</span>
                ) : (
                  <div className="flex w-full flex-wrap gap-1">
                    {project.processes.map((process) => (
                      <span
                        key={process.name}
                        className="rounded-md border border-surface-5 bg-surface-a2 px-1.5 py-px text-xs text-surface-11"
                        title={process.shell ? "Interactive shell" : process.cmd}
                      >
                        {process.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <DetectedScripts
                pkg={info?.package ?? null}
                addedNames={names}
                onAdd={addScript}
                placeholder={
                  inspecting
                    ? "Inspecting package.json…"
                    : "No package.json scripts found here — add a custom command below."
                }
              />

              <form className="flex w-full flex-col items-start gap-[5px]" onSubmit={addCustom}>
                <span className="text-sm tracking-label text-surface-10">Custom command</span>
                <div className="flex w-full gap-1.5">
                  {/* The wrapper owns the width: TextInput's own w-full would win
                   * the utility fight against a width class on the input itself. */}
                  <div className="w-[130px] flex-none">
                    <TextInput
                      value={customName}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="name"
                      aria-label="Process name"
                      onChange={(event) => setCustomName(event.target.value)}
                    />
                  </div>
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
              {/* An action, not a dismissal — it sits apart from Done, on the left. */}
              <Button
                onClick={() => {
                  actions.openEmptyTerminal(project)
                  onClose()
                }}
              >
                Open empty terminal
              </Button>
              <span className="flex-1" />
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </main>
        </div>
      </Dialog>
    </Overlay>,
    document.body,
  )
}
