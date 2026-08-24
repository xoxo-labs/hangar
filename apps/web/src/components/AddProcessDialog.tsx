import { connIdOf, displayName } from "@hangar/client-core"
import type { Project } from "@hangar/contracts"
import { type FormEvent, useState } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { useProjectInfo } from "../hooks/useProjectInfo"
import { connectionOf, useStore } from "../store"
import { Button } from "../ui/Button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { TextInput } from "../ui/Field"
import { DetectedScripts } from "./DetectedScripts"
import type { PackageScript } from "./packageScripts.logic"

/**
 * The quick way to grow a project from its context menu: package.json scripts
 * not yet in the process list, one Add each, plus a custom row for anything
 * package.json doesn't know. The full editor stays the place for cwd, env and
 * reordering.
 */
export function AddProcessDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const connections = useStore((state) => state.connections)
  const config = connectionOf(connections, connIdOf(project.name)).config
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
        className="w-[min(560px,100%)]!"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <DialogHeader title={`Add process to ${displayName(project.name)}`} />
        <DialogBody>
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
      </Dialog>
    </Overlay>,
    document.body,
  )
}
