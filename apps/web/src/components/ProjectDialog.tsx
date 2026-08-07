import type { Project, ProjectProcess } from "@hangar/contracts"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import * as actions from "../actions"
import { useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { Field, TextInput } from "../ui/Field"
import { IconButton } from "../ui/IconButton"

/* Ports of the retired `.field` / `.text-button` rules. The `Field` primitive
 * covers the plain label-wrapped case; these two fields need a `<div>` (a
 * button and a `htmlFor` label can't live inside a wrapping `<label>`). */
const FIELD = "flex flex-col items-start gap-[5px]"
const FIELD_LABEL = "text-sm tracking-label text-surface-10"
const FIELD_HINT = "text-sm text-surface-9"
/* `enabled:hover:` because the old rules leaned on source order to let
 * :disabled beat :hover, and utility order is not something to lean on. */
const TEXT_BUTTON =
  "py-[3px] text-base text-surface-10 enabled:hover:text-accent-9 disabled:cursor-default disabled:text-surface-7"
const PROC_HEAD = "text-xs tracking-label text-surface-9"
const ELLIPSIS = "overflow-hidden text-ellipsis whitespace-nowrap"

/** A process being edited. `id` only keeps React keys stable across row removals. */
type Row = { id: number; name: string; cmd: string; cwd: string; shell: boolean }
type PackageScript = { name: string; value: string; cmd: string }
type ProjectInfo = {
  path: string
  exists: boolean
  package: null | {
    name: string | null
    manager: string
    scripts: PackageScript[]
  }
}

let nextRowId = 0
function emptyRow(): Row {
  nextRowId += 1
  return { id: nextRowId, name: "", cmd: "", cwd: "", shell: false }
}

export function ProjectDialog() {
  const open = useStore((s) => s.editorOpen)
  const editing = useStore((s) => s.editingProject)

  // Remounting per open keeps the form state fresh without an explicit reset.
  if (!open) return null
  return <Editor key={editing ?? "__new__"} editing={editing} />
}

function Editor({ editing }: { editing: string | null }) {
  const closeEditor = useStore((s) => s.closeEditor)
  const existing = useStore((s) => s.projects.find((p) => p.name === editing))
  const running = useStore((s) =>
    s.sessions.some((session) => session.project === editing && session.status === "running"),
  )
  const port = useStore((s) => s.port)

  const [name, setName] = useState(existing?.name ?? "")
  const [path, setPath] = useState(existing?.path ?? "")
  const [rows, setRows] = useState<Row[]>(() =>
    existing && existing.processes.length > 0
      ? existing.processes.map((p) => ({
          ...emptyRow(),
          name: p.name,
          cmd: p.cmd,
          cwd: p.cwd ?? "",
          shell: p.shell ?? false,
        }))
      : [emptyRow()],
  )
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const nameEdited = useRef(false)

  useEffect(() => {
    const candidate = path.trim()
    if (candidate === "") {
      setProjectInfo(null)
      setInspecting(false)
      return
    }

    setProjectInfo(null)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setInspecting(true)
      fetch(`http://127.0.0.1:${port}/project-info?path=${encodeURIComponent(candidate)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not inspect project")
          return response.json() as Promise<ProjectInfo>
        })
        .then(setProjectInfo)
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setProjectInfo(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setInspecting(false)
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [path, port])

  useEffect(() => {
    if (editing !== null || nameEdited.current || projectInfo === null || !projectInfo.exists) return
    const folderName = projectInfo.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? ""
    const packageName = projectInfo.package?.name?.split("/").pop() ?? ""
    const suggested = (packageName || folderName).trim().replace(/[\s/]+/g, "-")
    if (suggested !== "") setName(suggested)
  }, [editing, projectInfo])

  const problem = useMemo(() => validate(name, path, rows), [name, path, rows])
  const valid = problem === null

  const save = (): void => {
    if (!valid) return
    actions.upsertProject(toProject(name, path, rows, existing?.env))
    closeEditor()
  }

  const remove = (): void => {
    if (editing === null) return
    if (!confirmingRemove) {
      setConfirmingRemove(true)
      return
    }
    actions.removeProject(editing)
    closeEditor()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation()
      closeEditor()
      return
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  }

  const patchRow = (id: number, patch: Partial<Row>): void =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  const browse = async (): Promise<void> => {
    const choose = window.hangarDesktop?.chooseDirectory
    if (!choose || browsing) return
    setBrowsing(true)
    try {
      const selected = await choose("Choose a project folder")
      if (selected !== null) setPath(selected)
    } finally {
      setBrowsing(false)
    }
  }

  const addPackageScript = (script: PackageScript): void => {
    setRows((current) => {
      if (current.some((row) => row.name.trim() === script.name)) return current
      const blank = current.find(
        (row) => row.name === "" && row.cmd === "" && row.cwd === "" && !row.shell,
      )
      if (blank) {
        return current.map((row) =>
          row.id === blank.id
            ? { ...row, name: script.name, cmd: script.cmd, shell: false }
            : row,
        )
      }
      return [...current, { ...emptyRow(), name: script.name, cmd: script.cmd }]
    })
  }

  return (
    // mousedown (not click) so a drag that ends on the backdrop keeps the dialog up.
    <Overlay onDismiss={closeEditor}>
      <Dialog label={editing === null ? "New project" : `Edit ${editing}`} onKeyDown={onKeyDown}>
        <DialogHeader title={editing === null ? "New project" : "Edit project"} />

        <DialogBody>
          <Field
            label="Name"
            hint={
              editing === null
                ? "No spaces or slashes."
                : "The name identifies the project and can't change."
            }
          >
            <TextInput
              autoFocus={editing === null}
              value={name}
              readOnly={editing !== null}
              spellCheck={false}
              autoComplete="off"
              placeholder="my-app"
              onChange={(e) => {
                nameEdited.current = true
                setName(e.target.value)
              }}
            />
          </Field>

          <div className={FIELD}>
            <label className={FIELD_LABEL} htmlFor="project-path">Path</label>
            <div className="flex w-full gap-1.5">
              <TextInput
                mono
                id="project-path"
                autoFocus={editing !== null}
                value={path}
                spellCheck={false}
                autoComplete="off"
                placeholder="~/code/my-app"
                onChange={(e) => setPath(e.target.value)}
              />
              {window.hangarDesktop && (
                <Button
                  className="flex-none whitespace-nowrap"
                  disabled={browsing}
                  onClick={() => void browse()}
                >
                  {browsing ? "Opening…" : "Choose…"}
                </Button>
              )}
            </div>
            <span className={FIELD_HINT}>
              {inspecting ? "Looking for package.json…" : <><code>~</code> expands to your home directory.</>}
            </span>
          </div>

          {projectInfo?.package && projectInfo.package.scripts.length > 0 && (
            <div className={cx(FIELD, "w-full")}>
              <span className={FIELD_LABEL}>
                package.json scripts · {projectInfo.package.manager}
              </span>
              <div className="max-h-[150px] w-full overflow-y-auto rounded-md border border-surface-5 bg-surface-1">
                {projectInfo.package.scripts.map((script) => {
                  const added = rows.some((row) => row.name.trim() === script.name)
                  return (
                    <div
                      className="grid min-h-[28px] grid-cols-[minmax(70px,0.7fr)_minmax(120px,2fr)_42px] items-center gap-2 border-b border-surface-4 px-[7px] py-[3px] last:border-b-0"
                      key={script.name}
                      title={script.value}
                    >
                      <code className={cx(ELLIPSIS, "text-sm text-surface-12")}>{script.name}</code>
                      <span className={cx(ELLIPSIS, "font-mono text-xs text-surface-9")}>
                        {script.value}
                      </span>
                      <button
                        type="button"
                        className={cx(TEXT_BUTTON, "justify-self-end")}
                        disabled={added}
                        onClick={() => addPackageScript(script)}
                      >
                        {added ? "Added" : "+ Add"}
                      </button>
                    </div>
                  )
                })}
              </div>
              <span className={FIELD_HINT}>Add any scripts you want, then edit them or add custom commands below.</span>
            </div>
          )}

          <div className={FIELD}>
            <span className={FIELD_LABEL}>Processes</span>
            <div className="grid w-full grid-cols-[1.1fr_2fr_1.2fr_24px] items-center gap-1">
              <span className={PROC_HEAD}>name</span>
              <span className={PROC_HEAD}>command</span>
              <span className={PROC_HEAD}>cwd (optional)</span>
              <span />
              {rows.map((row) => (
                <ProcRow
                  key={row.id}
                  row={row}
                  canRemove={rows.length > 1}
                  onChange={(patch) => patchRow(row.id, patch)}
                  onRemove={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                />
              ))}
            </div>
            <span className={FIELD_HINT}>
              A cwd is relative to the project path and defaults to its root.
            </span>
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => setRows((current) => [...current, emptyRow()])}
            >
              + Add process
            </button>
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { ...emptyRow(), name: uniqueTerminalName(current), shell: true },
                ])
              }
            >
              + Add empty terminal
            </button>
          </div>
        </DialogBody>

        <DialogFooter>
          {editing !== null && (
            // The span carries the tooltip: browsers swallow hover on a disabled button.
            <span
              title={
                running
                  ? "Stop this project's processes before removing it"
                  : "Remove this project from the registry"
              }
            >
              <Button
                variant="danger"
                className={cx(confirmingRemove && "enabled:bg-danger-10 enabled:text-white")}
                disabled={running}
                onClick={remove}
                onBlur={() => setConfirmingRemove(false)}
              >
                {confirmingRemove ? "Really remove?" : "Remove project"}
              </Button>
            </span>
          )}
          <span className="flex-1" />
          {problem !== null && (
            <span className={cx(ELLIPSIS, "text-sm text-surface-9")}>{problem}</span>
          )}
          <Button onClick={closeEditor}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            title={valid ? "Save (⌘↵)" : (problem ?? undefined)}
            onClick={save}
          >
            Save
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}

function ProcRow({
  row,
  canRemove,
  onChange,
  onRemove,
}: {
  row: Row
  canRemove: boolean
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
}) {
  return (
    <>
      <TextInput
        value={row.name}
        spellCheck={false}
        autoComplete="off"
        placeholder="web"
        onChange={(e) => onChange({ name: e.target.value })}
      />
      {row.shell ? (
        <div
          className={cx(
            ELLIPSIS,
            "w-full min-w-0 rounded-md border border-surface-5 bg-surface-a2 px-2 py-[6px] font-mono text-sm italic text-surface-9",
          )}
          title="Starts your interactive login shell"
        >
          Interactive shell
        </div>
      ) : (
        <TextInput
          mono
          value={row.cmd}
          spellCheck={false}
          autoComplete="off"
          placeholder="pnpm dev"
          onChange={(e) => onChange({ cmd: e.target.value })}
        />
      )}
      <TextInput
        mono
        value={row.cwd}
        spellCheck={false}
        autoComplete="off"
        placeholder="apps/web"
        onChange={(e) => onChange({ cwd: e.target.value })}
      />
      <IconButton
        title={canRemove ? "Remove this process" : "A project needs at least one process"}
        disabled={!canRemove}
        onClick={onRemove}
      >
        ×
      </IconButton>
    </>
  )
}

/** Mirrors the server's `validateProject` so the form can refuse early. */
function validate(name: string, path: string, rows: Row[]): string | null {
  if (name.trim() === "") return "Name is required."
  if (/[\s/]/.test(name)) return "Name can't contain spaces or slashes."
  if (path.trim() === "") return "Path is required."
  if (rows.length === 0) return "A project needs at least one process."
  if (rows.some((row) => row.name.trim() === "" || (!row.shell && row.cmd.trim() === ""))) {
    return "Every process needs a name and a command."
  }
  const names = new Set(rows.map((row) => row.name.trim()))
  if (names.size !== rows.length) return "Process names must be unique."
  return null
}

function toProject(
  name: string,
  path: string,
  rows: Row[],
  env: Record<string, string> | undefined,
): Project {
  const processes: ProjectProcess[] = rows.map((row) => {
    const cwd = row.cwd.trim()
    return {
      name: row.name.trim(),
      cmd: row.shell ? "" : row.cmd.trim(),
      ...(row.shell ? { shell: true } : {}),
      ...(cwd === "" ? {} : { cwd }),
    }
  })
  return { name: name.trim(), path: path.trim(), processes, ...(env === undefined ? {} : { env }) }
}

function uniqueTerminalName(rows: Row[]): string {
  const names = new Set(rows.map((row) => row.name.trim()))
  if (!names.has("terminal")) return "terminal"
  let suffix = 2
  while (names.has(`terminal-${suffix}`)) suffix += 1
  return `terminal-${suffix}`
}
