import { connIdOf, displayName, LOCAL_CONN_ID, scoped } from "@hangar/client-core"
import type { BrowserChoice } from "@hangar/contracts"
import { FolderOpen } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import * as actions from "../actions"
import { useProjectInfo } from "../hooks/useProjectInfo"
import { type ConnectionState, connectionOf, machineLabel, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { Field, Select, TextInput } from "../ui/Field"
import { IconButton } from "../ui/IconButton"
import { BrowserSelect } from "./BrowserSelect"
import { DetectedScripts } from "./DetectedScripts"
import type { PackageScript } from "./packageScripts.logic"
import { PathBrowser, type PathBrowserHandle } from "./PathBrowser"
import { type Row, toProject, uniqueTerminalName, validate } from "./projectForm.logic"

/* Ports of the retired `.field` / `.text-button` rules. The `Field` primitive
 * covers the plain label-wrapped case; these two fields need a `<div>` (a
 * button and a `htmlFor` label can't live inside a wrapping `<label>`). */
const FIELD = "flex flex-col items-start gap-[5px]"
const FIELD_LABEL = "text-sm tracking-label text-surface-10"
/* One step below FIELD_LABEL on the ramp: at the same size the two only
 * differed by a 1.12:1 colour delta, which read as one voice. */
const FIELD_HINT = "text-xs text-surface-9"
/* `enabled:hover:` because the old rules leaned on source order to let
 * :disabled beat :hover, and utility order is not something to lean on. */
const TEXT_BUTTON =
  "py-[3px] text-base text-surface-10 enabled:hover:text-accent-9 disabled:cursor-default disabled:text-surface-7"
const PROC_HEAD = "text-xs tracking-label text-surface-9"
const ELLIPSIS = "overflow-hidden text-ellipsis whitespace-nowrap"

let nextRowId = 0
function emptyRow(): Row {
  nextRowId += 1
  return { id: nextRowId, name: "", cmd: "", cwd: "", shell: false }
}

export function ProjectDialog() {
  const open = useStore((s) => s.editorOpen)
  const editing = useStore((s) => s.editingProject)
  const initialPath = useStore((s) => s.newProjectPath)

  // Remounting per open keeps the form state fresh without an explicit reset.
  if (!open) return null
  return <Editor key={editing ?? "__new__"} editing={editing} initialPath={initialPath} />
}

function Editor({ editing, initialPath }: { editing: string | null; initialPath: string }) {
  const closeEditor = useStore((s) => s.closeEditor)
  const existing = useStore((s) => s.projects.find((p) => p.name === editing))
  const running = useStore((s) =>
    s.sessions.some((session) => session.project === editing && session.status === "running"),
  )
  const connections = useStore((s) => s.connections)

  // The form edits the bare name; the scope is put back on save. A new project
  // defaults to this Mac; an existing one stays on the machine that owns it.
  const [connId, setConnId] = useState(editing === null ? LOCAL_CONN_ID : connIdOf(editing))
  const machines = Object.values(connections)
  const machine = connectionOf(connections, connId)
  const config = machine.config
  // The native picker only ever sees the Mac it opens on; every machine's folders
  // are reachable through the server-side browser below, so this is an extra door,
  // not the only one.
  const canPickNatively = window.hangarDesktop !== undefined && connId === LOCAL_CONN_ID
  const [name, setName] = useState(existing === undefined ? "" : displayName(existing.name))
  const [path, setPath] = useState(existing?.path ?? initialPath)
  const [rows, setRows] = useState<Row[]>(() =>
    existing && existing.processes.length > 0
      ? existing.processes.map((p) => ({
          ...emptyRow(),
          name: p.name,
          cmd: p.cmd,
          cwd: p.cwd ?? "",
          shell: p.shell ?? false,
          ...(p.description === undefined ? {} : { description: p.description }),
          ...(p.browser === undefined ? {} : { browser: p.browser }),
        }))
      : [emptyRow()],
  )
  const [browser, setBrowser] = useState<BrowserChoice | "">(existing?.browser ?? "")
  const { info: projectInfo, inspecting } = useProjectInfo(config, path)
  const [browsing, setBrowsing] = useState(false)
  // The welcome screen is the first thing a new project shows; this is how you leave it
  // without having picked anything yet.
  const [showForm, setShowForm] = useState(editing !== null)
  const [pathFocused, setPathFocused] = useState(false)

  const nameEdited = useRef(false)
  const browserRef = useRef<PathBrowserHandle>(null)

  useEffect(() => {
    if (editing !== null || nameEdited.current || projectInfo === null || !projectInfo.exists) return
    const folderName =
      projectInfo.path
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() ?? ""
    const packageName = projectInfo.package?.name?.split("/").pop() ?? ""
    const suggested = (packageName || folderName).trim().replace(/[\s/]+/g, "-")
    if (suggested !== "") setName(suggested)
  }, [editing, projectInfo])

  const problem = useMemo(() => validate(name, path, rows), [name, path, rows])
  const valid = problem === null

  const save = (): void => {
    if (!valid) return
    actions.upsertProject(toProject(scoped(connId, name.trim()), path, rows, existing?.env, browser))
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

  const browse = async (): Promise<void> => {
    const choose = window.hangarDesktop?.chooseDirectory
    if (!choose || !canPickNatively || browsing) return
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
      const blank = current.find((row) => row.name === "" && row.cmd === "" && row.cwd === "" && !row.shell)
      if (blank) {
        return current.map((row) =>
          row.id === blank.id
            ? { ...row, name: script.name, cmd: script.cmd, cwd: script.cwd ?? "", shell: false }
            : row,
        )
      }
      return [...current, { ...emptyRow(), name: script.name, cmd: script.cmd, cwd: script.cwd ?? "" }]
    })
  }

  const machineField = (
    <MachineField editing={editing} connId={connId} machines={machines} machine={machine} onChange={setConnId} />
  )

  if (editing === null && !showForm && path.trim() === "") {
    return (
      <FolderPickerScreen
        machineField={machineField}
        canPickNatively={canPickNatively}
        browsing={browsing}
        machineName={machineLabel(machine)}
        onKeyDown={onKeyDown}
        onBrowse={() => void browse()}
        onTypePath={() => setShowForm(true)}
        onClose={closeEditor}
      />
    )
  }

  return (
    // mousedown (not click) so a drag that ends on the backdrop keeps the dialog up.
    <Overlay onDismiss={closeEditor}>
      <Dialog
        label={editing === null ? "Add project" : `Edit ${displayName(editing)}`}
        className="w-[min(620px,100%)]!"
        onKeyDown={onKeyDown}
      >
        <DialogHeader title={editing === null ? "Add project" : "Edit project"} />

        <DialogBody>
          {machineField}
          {/* One field for both doors. The listing is a typeahead over the field's own
           * value — a trailing "/" lists a folder, anything else filters it — so the
           * path stays editable and browsable at once, on any machine. */}
          <div className={FIELD}>
            <label className={FIELD_LABEL} htmlFor="project-path">
              Project folder
            </label>
            <div className="flex w-full gap-1.5">
              <TextInput
                mono
                id="project-path"
                autoFocus={editing === null}
                value={path}
                spellCheck={false}
                autoComplete="off"
                placeholder="~/code/my-app"
                onChange={(e) => setPath(e.target.value)}
                onFocus={() => setPathFocused(true)}
                onBlur={() => setPathFocused(false)}
                onKeyDown={(event) => {
                  // The listing gets first refusal on the navigation keys; everything
                  // it declines keeps bubbling to the dialog's own handler.
                  if (browserRef.current?.handleKeyDown(event)) event.stopPropagation()
                }}
              />
              {canPickNatively && (
                <Button className="flex-none whitespace-nowrap" disabled={browsing} onClick={() => void browse()}>
                  {browsing ? "Opening…" : "Choose…"}
                </Button>
              )}
            </div>
            {pathFocused && <PathBrowser ref={browserRef} config={config} path={path} onPick={setPath} />}
            <span className={FIELD_HINT}>
              {inspecting ? (
                "Inspecting package.json and workspaces…"
              ) : pathFocused ? (
                <>
                  <kbd>↑↓</kbd> to move, <kbd>↵</kbd> to open a folder, <kbd>⇥</kbd> to complete.
                </>
              ) : (
                <>
                  <code>~</code> expands to the home directory on {machineLabel(machine)}.
                </>
              )}
            </span>
          </div>

          <Field
            label="Name"
            hint={
              editing === null
                ? "Derived from the folder or package.json; no spaces or slashes."
                : "The name identifies the project and can't change."
            }
          >
            <TextInput
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

          {projectInfo?.package && projectInfo.package.scripts.length > 0 && (
            <div className={cx(FIELD, "w-full")}>
              {/* Keyed by folder so the panel's filter resets with the script list. */}
              <DetectedScripts
                key={projectInfo.path}
                pkg={projectInfo.package}
                addedNames={new Set(rows.map((row) => row.name.trim()))}
                onAdd={addPackageScript}
              />
              <span className={FIELD_HINT}>
                {projectInfo.package.workspaceScriptCount
                  ? "Workspace scripts use package/script names and run from that package's folder."
                  : "Add any scripts you want, then edit them or add custom commands below."}
              </span>
            </div>
          )}

          <ProcessesField rows={rows} onChange={setRows} />

          {/* A project-level preference, so it sits with neither the scripts
           * above nor the process list they feed — last, out of that flow. */}
          <Field label="Browser used" hint="Overrides the global setting for every action in this project.">
            <BrowserSelect
              value={browser}
              inheritLabel="Use global setting"
              onChange={(event) => setBrowser(event.target.value as BrowserChoice | "")}
            />
          </Field>
        </DialogBody>

        <DialogFooter>
          {editing !== null && (
            <RemoveProjectButton
              running={running}
              onRemove={() => {
                actions.removeProject(editing)
                closeEditor()
              }}
            />
          )}
          <span className="flex-1" />
          {problem !== null && <span className={cx(ELLIPSIS, "text-sm text-surface-9")}>{problem}</span>}
          <Button onClick={closeEditor}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            title={valid ? "Save (⌘↵)" : (problem ?? undefined)}
            data-shortcut-hint="↵"
            onClick={save}
          >
            Save
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}

function MachineField({
  editing,
  connId,
  machines,
  machine,
  onChange,
}: {
  editing: string | null
  connId: string
  machines: ConnectionState[]
  machine: ConnectionState
  onChange: (connId: string) => void
}) {
  if (machines.length < 2) return null
  return (
    <Field
      label="Machine"
      hint={editing === null ? "The Mac this project is created on." : "A project stays on the Mac that owns it."}
      className="w-full max-w-[260px]"
    >
      {editing === null ? (
        <Select value={connId} onChange={(event) => onChange(event.target.value)}>
          {machines.map((item) => (
            <option key={item.config.id} value={item.config.id}>
              {machineLabel(item)}
            </option>
          ))}
        </Select>
      ) : (
        <TextInput readOnly value={machineLabel(machine)} />
      )}
    </Field>
  )
}

/** The welcome screen of a new project: pick a folder before seeing the form. */
function FolderPickerScreen({
  machineField,
  canPickNatively,
  browsing,
  machineName,
  onKeyDown,
  onBrowse,
  onTypePath,
  onClose,
}: {
  machineField: ReactNode
  canPickNatively: boolean
  browsing: boolean
  machineName: string
  onKeyDown: (event: KeyboardEvent) => void
  onBrowse: () => void
  onTypePath: () => void
  onClose: () => void
}) {
  return (
    <Overlay onDismiss={onClose}>
      <Dialog label="Add project" className="w-[min(620px,100%)]!" onKeyDown={onKeyDown}>
        <DialogHeader title="Add project" />
        <DialogBody className="gap-3 py-5">
          {machineField}
          {/* One screen, two doors: the native picker where there is one, and the
           * server-side browser everywhere else — including a paired Mac, whose
           * folders this Mac's picker could never have shown. */}
          <button
            type="button"
            autoFocus
            className="group flex min-h-[190px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-surface-6 bg-surface-1 px-8 text-center hover:border-accent-8 hover:bg-accent-a2 focus:border-accent-9 focus:shadow-[0_0_0_2px_var(--color-accent-a3)] focus:outline-none"
            disabled={browsing}
            onClick={() => (canPickNatively ? onBrowse() : onTypePath())}
          >
            <span className="grid size-11 place-items-center rounded-full border border-surface-5 bg-surface-a3 text-surface-10 group-hover:text-accent-10">
              <FolderOpen size={21} strokeWidth={1.6} />
            </span>
            <strong className="mt-3 text-md font-semibold text-surface-12">
              {browsing
                ? "Opening folder picker…"
                : canPickNatively
                  ? "Choose a project folder"
                  : `Browse folders on ${machineName}`}
            </strong>
            <span className="mt-1 max-w-[390px] text-base leading-relaxed text-surface-9">
              Hangar will detect package.json scripts, the package manager, and monorepo workspaces.
            </span>
          </button>
          {/* Offered only where the button above opens the native picker: without one
           * it already leads to the browsable field, and two controls doing the same
           * thing is worse than one. */}
          {canPickNatively && (
            <>
              <div className="flex items-center gap-3 text-xs text-surface-8">
                <span className="h-px flex-1 bg-surface-5" />
                or
                <span className="h-px flex-1 bg-surface-5" />
              </div>
              <Button className="self-center" onClick={onTypePath}>
                Type or browse a path
              </Button>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}

/** The editable process list: one grid row each, plus the two add buttons. */
function ProcessesField({ rows, onChange }: { rows: Row[]; onChange: (update: (current: Row[]) => Row[]) => void }) {
  const patchRow = (id: number, patch: Partial<Row>): void =>
    onChange((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  return (
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
            onRemove={() => onChange((current) => current.filter((r) => r.id !== row.id))}
          />
        ))}
      </div>
      <span className={FIELD_HINT}>A cwd is relative to the project path and defaults to its root.</span>
      <button type="button" className={TEXT_BUTTON} onClick={() => onChange((current) => [...current, emptyRow()])}>
        + Add process
      </button>
      <button
        type="button"
        className={TEXT_BUTTON}
        onClick={() =>
          onChange((current) => [...current, { ...emptyRow(), name: uniqueTerminalName(current), shell: true }])
        }
      >
        + Add empty terminal
      </button>
    </div>
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

/** Two-step remove: the first click arms the button, blurring disarms it. */
function RemoveProjectButton({ running, onRemove }: { running: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    // The span carries the tooltip: browsers swallow hover on a disabled button.
    <span
      title={running ? "Stop this project's processes before removing it" : "Remove this project from the registry"}
    >
      <Button
        variant="danger"
        className={cx(confirming && "enabled:bg-danger-10 enabled:text-white")}
        disabled={running}
        onClick={() => (confirming ? onRemove() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? "Really remove?" : "Remove project"}
      </Button>
    </span>
  )
}
