import { buildSidebarModel, displayName, flatEntries, type SidebarEntry, type SidebarPart } from "@hangar/client-core"
import { type Project, type SessionInfo, sessionId } from "@hangar/contracts"
import { ChevronRight, CircleArrowUp, CircleHelp, History, Play, RotateCw, Settings, Square } from "lucide-react"
import { type DragEvent, type FormEvent, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { retryConnection } from "../connections"
import { useDesktopUpdate } from "../hooks/useDesktopUpdate"
import { CONNECTION_LABEL, connectionTone, describe, hasHighCpu, toneOf } from "../status"
import { type ConfirmRequest, type ConnectionState, machineLabel, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { IconButton } from "../ui/IconButton"
import { MENU_SEPARATOR, Menu, type MenuItem } from "../ui/Menu"
import { Dot } from "./Dot"

/*
 * The `!` on padding/color/border/font utilities below dates from when the
 * `button { … }` reset in styles.css was unlayered and outranked utilities.
 * The reset now lives in `@layer base`, so plain utilities already win; the
 * suffixes are harmless belt-and-braces, not load-bearing. The `!` on the
 * `electron:` padding overrides is different and stays: it guarantees they
 * beat the base `px-`/`py-` utilities regardless of variant sort order.
 */
/* Action buttons overlay the row's right edge instead of sitting in flow, so a
 * label keeps the full row width while they are hidden. The 26px min-height
 * replaces the height the in-flow buttons used to establish; the label alone
 * is shorter. Do not reintroduce the old two-line height math. */
const ROW = "relative flex min-h-[26px] items-center rounded-md pr-1"
const ROW_MAIN = "flex min-w-0 flex-1 items-center gap-[7px] px-1.5! py-1! text-left"
const ROW_ACTIONS =
  "absolute inset-y-0 right-1 flex items-center gap-[3px] opacity-0 transition-opacity duration-[120ms] ease-[ease] group-hover:opacity-100 group-focus-within:opacity-100"
/* Labels fade out over their last 8px instead of hard-clipping. While the
 * row's actions are visible (hover, focus-within, open menu) the fade slides
 * left to end just before the overlaid buttons — 26px wide for one button,
 * 55px for two — so no text shows through them. The offsets bake in the
 * label's 10px inset from the row edge (pr-1 + px-1.5) and the buttons'
 * right-1 anchor. */
const LABEL = "min-w-0 flex-1 overflow-hidden whitespace-nowrap"
const FADE = "mask-r-from-[calc(100%-8px)]"
const FADE_CLEARS_ONE = "mask-r-from-[calc(100%-30px)] mask-r-to-[calc(100%-22px)]"
const FADE_HOVER_ONE =
  "group-hover:mask-r-from-[calc(100%-30px)] group-hover:mask-r-to-[calc(100%-22px)] group-focus-within:mask-r-from-[calc(100%-30px)] group-focus-within:mask-r-to-[calc(100%-22px)]"
const FADE_HOVER_TWO =
  "group-hover:mask-r-from-[calc(100%-59px)] group-hover:mask-r-to-[calc(100%-51px)] group-focus-within:mask-r-from-[calc(100%-59px)] group-focus-within:mask-r-to-[calc(100%-51px)]"

export function Sidebar({
  onResizeStart,
  onResizeBy,
}: {
  onResizeStart: (clientX: number) => void
  onResizeBy: (delta: number) => void
}) {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const connections = useStore((s) => s.connections)
  const openEditor = useStore((s) => s.openEditor)
  const openHistory = useStore((s) => s.openHistory)
  const closeHistory = useStore((s) => s.closeHistory)
  const activeHistory = useStore((s) => s.activeHistory)
  const historyCount = useStore((s) => s.history.length)
  const openSettings = useStore((s) => s.openSettings)
  const openHelp = useStore((s) => s.openHelp)
  const update = useDesktopUpdate()
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ name: string; side: "before" | "after" } | null>(null)
  const [filter, setFilter] = useState("")

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  const query = filter.trim().toLowerCase()
  // One machine is the overwhelming case and must look exactly as it always has:
  // headers only appear once a second machine is paired, and the same repo on
  // two machines only merges into one entry there.
  const machines = Object.values(connections)
  const groups = useMemo(
    () => buildSidebarModel(Object.keys(connections), projects, query),
    [connections, projects, query],
  )
  const visible = useMemo(() => flatEntries(groups), [groups])

  const renderProject = (entry: SidebarEntry) => (
    <ProjectRow
      key={entry.key}
      entry={entry}
      filtering={query !== ""}
      byId={byId}
      dragging={dragging === entry.key}
      dropSide={dropTarget?.name === entry.key ? dropTarget.side : null}
      onDragStart={() => {
        setDragging(entry.key)
        setDropTarget(null)
      }}
      onDragOver={(side) => {
        if (dragging !== null && dragging !== entry.key) {
          setDropTarget({ name: entry.key, side })
        }
      }}
      onDrop={(side) => {
        if (dragging !== null && dragging !== entry.key) {
          const names = projects.map((item) => item.name).filter((item) => item !== dragging)
          const targetIndex = names.indexOf(entry.key)
          names.splice(targetIndex + (side === "after" ? 1 : 0), 0, dragging)
          actions.reorderProjects(names)
        }
        setDragging(null)
        setDropTarget(null)
      }}
      onDragEnd={() => {
        setDragging(null)
        setDropTarget(null)
      }}
    />
  )

  return (
    <aside className="relative row-start-1 col-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-surface-5 bg-surface-2 select-none">
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        tabIndex={0}
        className="absolute top-0 right-[-3px] z-20 h-full w-[7px] cursor-col-resize transition-colors hover:bg-accent-a4 focus:bg-accent-a4 focus:outline-none"
        onPointerDown={(event) => {
          event.preventDefault()
          onResizeStart(event.clientX)
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
          event.preventDefault()
          onResizeBy(event.key === "ArrowLeft" ? -10 : 10)
        }}
      />
      <header
        className={cx(
          "flex min-h-[48px] flex-none items-center gap-[9px] border-b px-3.5 py-[7px] electron:h-[48px] electron:py-0! electron:pr-3.5! electron:pl-[92px]! electron:[-webkit-app-region:drag]",
          import.meta.env.DEV ? "border-success-6 bg-success-3 text-success-12" : "border-surface-5 bg-surface-3",
        )}
      >
        <span className="flex min-w-0 flex-col leading-none">
          <span className="flex items-center gap-1.5">
            <h1 className="m-0 text-md font-strong tracking-label">hangar</h1>
            {import.meta.env.DEV && (
              <span className="rounded-sm border border-success-7 bg-success-3 px-1 py-px text-[8px] font-semibold tracking-caps text-success-11 uppercase">
                dev
              </span>
            )}
          </span>
          <span
            className={cx(
              "mt-0.5 overflow-hidden text-2xs font-book tracking-caps whitespace-nowrap uppercase mask-r-from-[calc(100%-8px)]",
              import.meta.env.DEV ? "text-success-11" : "text-surface-8",
            )}
          >
            {import.meta.env.DEV ? "development workspace" : "project workspace"}
          </span>
        </span>
      </header>

      <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-1 pb-3">
        <div className="flex items-center justify-between px-1.5 pt-[7px] pb-2 text-xs font-semibold tracking-caps text-surface-9 uppercase">
          <span>Projects</span>
          <button
            type="button"
            className="rounded-md px-1.5! py-0.5! text-xs! font-semibold! text-surface-9! hover:bg-surface-a3! hover:text-surface-12!"
            onClick={() => openEditor()}
          >
            + Add
          </button>
        </div>
        {projects.length > 0 && (
          <input
            type="text"
            className="mb-1.5 w-full min-w-0 rounded-md border border-surface-5 bg-surface-1 px-2 py-1 text-base text-surface-12 placeholder:text-surface-8 focus:border-accent-9 focus:shadow-[0_0_0_2px_var(--color-accent-a3)] focus:outline-none"
            placeholder="Filter projects…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              // Escape is swallowed only when it clears something; otherwise it
              // has to keep reaching the window listeners that close dialogs.
              if (event.key !== "Escape" || filter === "") return
              event.stopPropagation()
              setFilter("")
            }}
          />
        )}
        {projects.length === 0 ? (
          <p className="mx-1.5 my-3 text-base leading-relaxed text-surface-10">
            No projects registered yet.
            <br />
            Add one below, or run <code>hangar add</code>.
          </p>
        ) : visible.length === 0 ? (
          <p className="mx-1.5 my-3 text-sm text-surface-9">No matches</p>
        ) : machines.length > 1 ? (
          groups.map((group) => {
            const connection = connections[group.connId]
            // A machine with nothing to show is still worth a header — unless a
            // filter is running, where empty groups are just noise.
            if (group.entries.length === 0 && query !== "") return null
            return (
              <section key={group.connId} className="mb-1">
                {connection && <MachineHeader connection={connection} />}
                {group.entries.length === 0 ? (
                  <p className="mx-1.5 mt-0.5 mb-2 text-sm text-surface-9">No projects</p>
                ) : (
                  group.entries.map(renderProject)
                )}
              </section>
            )
          })
        ) : (
          visible.map(renderProject)
        )}

        {projects.length === 0 && (
          <button
            type="button"
            className="mt-0.5 block w-full rounded-md border! border-dashed! border-surface-5! p-1.5! text-center text-base! text-surface-9! hover:border-surface-8! hover:bg-surface-a3! hover:text-surface-12!"
            onClick={() => openEditor()}
          >
            + New project
          </button>
        )}
      </nav>
      {update !== null && (update.status === "available" || update.status === "downloaded") && (
        <button
          type="button"
          className="mx-2 mb-2 flex flex-none items-center gap-[8px] rounded-md border! border-accent-7! bg-accent-a3 px-[9px]! py-[6px]! text-left text-sm! text-accent-11! hover:bg-accent-a4!"
          title={
            update.status === "downloaded"
              ? `Version ${update.downloadedVersion} downloaded — open Settings to restart and install`
              : `Version ${update.availableVersion} is available — open Settings to download`
          }
          onClick={openSettings}
        >
          <CircleArrowUp className="size-[15px] flex-none" aria-hidden="true" />
          <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap mask-r-from-[calc(100%-8px)]">
            {update.status === "downloaded" ? "Restart to update" : `Update ${update.availableVersion} available`}
          </span>
        </button>
      )}
      <div className="flex flex-none items-center gap-1 border-t border-surface-5 p-2">
        <button
          type="button"
          className={cx(
            "flex h-[30px] min-w-0 flex-1 items-center gap-[8px] rounded-md px-[9px]! text-left text-base! leading-none",
            activeHistory !== null ? "text-surface-12!" : "text-surface-9! hover:bg-surface-a3! hover:text-surface-12!",
          )}
          aria-pressed={activeHistory !== null}
          onClick={activeHistory !== null ? closeHistory : openHistory}
        >
          <History className="size-[18px] flex-none" aria-hidden="true" />
          <span className="flex-1 leading-[20px]">History</span>
          {historyCount > 0 && (
            <span className="rounded-full bg-surface-a4 px-[6px] py-px text-2xs tabular-nums text-surface-9">
              {historyCount}
            </span>
          )}
        </button>
        <IconButton
          className="size-[30px]"
          title="Help & keyboard shortcuts"
          aria-label="Help & keyboard shortcuts"
          onClick={openHelp}
        >
          <CircleHelp className="size-[17px]" aria-hidden="true" />
        </IconButton>
        <IconButton
          className="size-[30px]"
          title="Settings (⌘,)"
          data-shortcut-hint=","
          data-shortcut-placement="top-left"
          aria-label="Settings"
          onClick={openSettings}
        >
          <Settings className="size-[17px]" aria-hidden="true" />
        </IconButton>
      </div>
    </aside>
  )
}

/**
 * Group header for one machine. It carries the only status the sidebar shows for
 * a paired Mac, so a connection that stopped working is visible without opening
 * Settings — and can be retried from here.
 */
function MachineHeader({ connection }: { connection: ConnectionState }) {
  const { config, status } = connection
  const label = machineLabel(connection)
  const blocked = status === "blocked"
  return (
    <div className="flex min-h-[22px] items-center gap-[7px] px-1.5 pt-2 pb-1">
      <Dot
        tone={connectionTone(status)}
        small
        title={`${config.host}:${config.port} — ${connection.error ?? CONNECTION_LABEL[status]}`}
      />
      <span className="min-w-0 flex-1 overflow-hidden text-2xs font-semibold tracking-caps whitespace-nowrap text-surface-9 uppercase mask-r-from-[calc(100%-8px)]">
        {label}
      </span>
      {blocked && (
        <button
          type="button"
          className="rounded-md px-1.5! py-0.5! text-2xs! font-semibold! tracking-caps text-danger-11! uppercase hover:bg-surface-a3!"
          title={connection.error ?? "This machine rejected the saved pairing"}
          onClick={() => retryConnection(config.id)}
        >
          Retry
        </button>
      )}
    </div>
  )
}

/** The project-level actions, shared by an entry's header and its machine sub-headers. */
function projectMenuItems(
  project: Project,
  running: boolean,
  openEditor: (project?: string) => void,
  requestConfirm: (request: ConfirmRequest) => void,
): MenuItem[] {
  return [
    { label: "Start all", onSelect: () => actions.start(project.name) },
    { label: "Open empty terminal", onSelect: () => actions.openEmptyTerminal(project) },
    {
      label: "Restart all",
      disabled: !running,
      onSelect: () => requestConfirm({ action: "restart", project: project.name }),
    },
    {
      label: "Stop all",
      disabled: !running,
      onSelect: () => requestConfirm({ action: "stop", project: project.name }),
    },
    MENU_SEPARATOR,
    { label: "Edit project…", onSelect: () => openEditor(project.name) },
  ]
}

function ProjectRow({
  entry,
  filtering,
  byId,
  dragging,
  dropSide,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  /** One project — or the same repo on several machines, merged into one entry. */
  entry: SidebarEntry
  filtering: boolean
  byId: Map<string, SessionInfo>
  dragging: boolean
  dropSide: "before" | "after" | null
  onDragStart: () => void
  onDragOver: (side: "before" | "after") => void
  onDrop: (side: "before" | "after") => void
  onDragEnd: () => void
}) {
  // The anchor machine owns the header: its name, its path, its actions.
  const anchor = entry.parts[0]
  const project = anchor.project
  const merged = entry.parts.length > 1
  const collapsed = useStore((s) => s.collapsed[entry.key] ?? false)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const openEditor = useStore((s) => s.openEditor)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)

  // Counted over every machine's whole project, not the filtered subset: the
  // header's dot, counter and "all processes" actions speak for the entry.
  const all = entry.parts.flatMap((part) => part.project.processes.map((process) => ({ part, process })))
  const runningCount = all.filter(
    ({ part, process }) => byId.get(sessionId(part.project.name, process.name))?.status === "running",
  ).length
  const running = runningCount > 0
  const warningProcesses = all.filter(({ part, process }) =>
    hasHighCpu(byId.get(sessionId(part.project.name, process.name))),
  )
  // The header's menu acts on the anchor machine alone, so it follows that one.
  const anchorRunning = project.processes.some(
    (process) => byId.get(sessionId(project.name, process.name))?.status === "running",
  )
  const expanded = !collapsed || filtering

  const dragOver = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const rect = event.currentTarget.getBoundingClientRect()
    onDragOver(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
  }

  const menuItems = projectMenuItems(project, anchorRunning, openEditor, requestConfirm)

  return (
    <section
      className={cx(
        "relative mb-1.5",
        dragging && "opacity-[0.45]",
        dropSide === "before" &&
          "before:pointer-events-none before:absolute before:-top-1 before:right-1 before:left-1 before:z-[2] before:h-0.5 before:rounded-xs before:bg-accent-9 before:content-['']",
        dropSide === "after" &&
          "after:pointer-events-none after:absolute after:-bottom-1 after:right-1 after:left-1 after:z-[2] after:h-0.5 after:rounded-xs after:bg-accent-9 after:content-['']",
      )}
      onDragOver={dragOver}
      onDrop={(event) => {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onDrop(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
      }}
    >
      <div
        className={cx(ROW, "group hover:bg-surface-a3")}
        /* Reordering a filtered list against the full registry order is
         * ambiguous, so dragging waits until the filter is cleared. */
        draggable={!filtering}
        title={filtering ? undefined : "Drag to reorder project"}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", entry.key)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenuPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        <button
          type="button"
          className={ROW_MAIN}
          title={project.path}
          onClick={() => toggleCollapsed(entry.key)}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cx(
              "size-[12px] flex-none text-surface-9 transition-transform duration-[120ms] ease-[ease]",
              expanded && "rotate-90",
            )}
            aria-hidden="true"
          />
          {warningProcesses.length > 0 && (
            <Dot
              tone="warning"
              title={`High CPU: ${[...new Set(warningProcesses.map(({ process }) => process.name))].join(", ")}`}
            />
          )}
          <span
            className={cx(
              LABEL,
              "text-md font-semibold text-surface-12",
              menuOpen ? FADE_CLEARS_ONE : FADE,
              FADE_HOVER_ONE,
            )}
          >
            {displayName(project.name)}
          </span>
          {running && (
            /* Sits where the overlaid menu button lands, so it yields whenever
             * the actions come in. */
            <span
              className={cx(
                "flex-none text-2xs tabular-nums text-surface-9 transition-opacity duration-[120ms] ease-[ease] group-hover:opacity-0 group-focus-within:opacity-0",
                menuOpen && "opacity-0",
              )}
            >
              {runningCount}/{all.length}
            </span>
          )}
        </button>

        <div className={cx(ROW_ACTIONS, menuOpen && "opacity-100")}>
          <Menu
            title={`More actions for ${displayName(project.name)}`}
            contextPosition={contextMenuPosition}
            onOpenChange={(open) => {
              setMenuOpen(open)
              if (!open) setContextMenuPosition(null)
            }}
            items={menuItems}
          />
        </div>
      </div>

      {expanded &&
        (merged ? (
          <div className="mt-[3px] mb-0 ml-2.5 border-l border-surface-5 pl-2">
            {entry.parts.map((part) => (
              <MachineSection key={part.connId} part={part} byId={byId} />
            ))}
          </div>
        ) : (
          <ul className="mt-[3px] mr-0 mb-0 ml-2.5 list-none border-l border-surface-5 py-0 pr-0 pl-2">
            {anchor.processes.map((proc) => (
              <ProcessRow
                key={proc.name}
                project={project.name}
                name={proc.name}
                cmd={proc.shell ? "Interactive shell" : proc.cmd}
                description={proc.description}
                session={byId.get(sessionId(project.name, proc.name))}
              />
            ))}
          </ul>
        ))}
    </section>
  )
}

/**
 * One machine's half of a merged entry: which Mac these processes run on, and
 * that Mac's own project actions. Every row underneath keeps its scoped ids, so
 * starting, stopping and focusing all reach the machine the row belongs to.
 */
function MachineSection({ part, byId }: { part: SidebarPart; byId: Map<string, SessionInfo> }) {
  const connection = useStore((s) => s.connections[part.connId])
  const openEditor = useStore((s) => s.openEditor)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const project = part.project
  const running = project.processes.some(
    (process) => byId.get(sessionId(project.name, process.name))?.status === "running",
  )
  const label = connection ? machineLabel(connection) : part.connId

  return (
    <section className="mb-0.5">
      <div
        className={cx(ROW, "group")}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenuPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        <div className={cx(ROW_MAIN, "min-h-[22px]")} title={project.path}>
          <Dot
            tone={connection ? connectionTone(connection.status) : "idle"}
            small
            title={
              connection
                ? `${connection.config.host}:${connection.config.port} — ${connection.error ?? CONNECTION_LABEL[connection.status]}`
                : label
            }
          />
          <span
            className={cx(
              LABEL,
              "text-2xs font-semibold tracking-caps text-surface-9 uppercase",
              menuOpen ? FADE_CLEARS_ONE : FADE,
              FADE_HOVER_ONE,
            )}
          >
            {label}
          </span>
        </div>

        <div className={cx(ROW_ACTIONS, menuOpen && "opacity-100")}>
          <Menu
            title={`More actions for ${displayName(project.name)} on ${label}`}
            contextPosition={contextMenuPosition}
            onOpenChange={(open) => {
              setMenuOpen(open)
              if (!open) setContextMenuPosition(null)
            }}
            items={projectMenuItems(project, running, openEditor, requestConfirm)}
          />
        </div>
      </div>

      <ul className="m-0 list-none p-0">
        {part.processes.map((proc) => (
          <ProcessRow
            key={proc.name}
            project={project.name}
            name={proc.name}
            cmd={proc.shell ? "Interactive shell" : proc.cmd}
            description={proc.description}
            session={byId.get(sessionId(project.name, proc.name))}
          />
        ))}
      </ul>
    </section>
  )
}

function ProcessRow({
  project,
  name,
  cmd,
  description,
  session,
}: {
  project: string
  name: string
  cmd: string
  description: string | undefined
  session: SessionInfo | undefined
}) {
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const openPending = useStore((s) => s.openPending)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)

  const id = sessionId(project, name)
  const running = session?.status === "running"
  const selected = activeId === id

  return (
    <li
      // `.row.selected` sat after `.row:hover` in styles.css, so a selected row
      // kept surface-a4 while hovered — hence the either/or here.
      className={cx(ROW, "group", selected ? "bg-surface-a4" : "hover:bg-surface-a3")}
      // Opening a row never launches anything: a process with no session gets a
      // pending tab whose pane offers the start. Only ▶ below starts outright.
      onClick={() => (session ? setActive(id) : openPending(project, name))}
      onContextMenu={(event) => {
        event.preventDefault()
        setContextMenuPosition({ x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        className={cx(ROW_MAIN, selected ? "text-surface-12!" : "text-surface-10! group-hover:text-surface-12!")}
        title={description === undefined ? cmd : `${description}\n${cmd}`}
        onClick={() => (session ? setActive(id) : openPending(project, name))}
      >
        <Dot tone={toneOf(session)} small title={describe(session)} />
        <span className={cx(LABEL, "text-base", FADE, running ? FADE_HOVER_TWO : FADE_HOVER_ONE)}>{name}</span>
      </button>

      <Menu
        title={`Actions for ${name}`}
        showTrigger={false}
        contextPosition={contextMenuPosition}
        onOpenChange={(open) => {
          if (!open) setContextMenuPosition(null)
        }}
        items={[
          running
            ? {
                label: "Restart",
                onSelect: () => requestConfirm({ action: "restart", project, process: name }),
              }
            : { label: "Start", onSelect: () => actions.start(project, name) },
          ...(running
            ? [{ label: "Stop", onSelect: () => requestConfirm({ action: "stop", project, process: name }) }]
            : []),
          MENU_SEPARATOR,
          { label: "Rename…", disabled: running, onSelect: () => setRenameOpen(true) },
        ]}
      />

      {renameOpen && (
        <RenameProcessDialog projectName={project} processName={name} onClose={() => setRenameOpen(false)} />
      )}

      <div className={ROW_ACTIONS}>
        {running ? (
          <>
            <IconButton
              title={`Restart ${name} (Shift-click to skip confirmation)`}
              onClick={(event) =>
                event.shiftKey
                  ? actions.restart(project, name)
                  : requestConfirm({ action: "restart", project, process: name })
              }
            >
              <RotateCw className="size-[14px]" aria-hidden="true" />
            </IconButton>
            <IconButton
              title={`Stop ${name} (Shift-click to skip confirmation)`}
              onClick={(event) =>
                event.shiftKey
                  ? actions.stop(project, name)
                  : requestConfirm({ action: "stop", project, process: name })
              }
            >
              <Square className="size-[12px] fill-current" aria-hidden="true" />
            </IconButton>
          </>
        ) : (
          <IconButton title={`Start ${name}`} onClick={() => actions.start(project, name)}>
            <Play className="size-[14px] fill-current" aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </li>
  )
}

function RenameProcessDialog({
  projectName,
  processName,
  onClose,
}: {
  projectName: string
  processName: string
  onClose: () => void
}) {
  const project = useStore((state) => state.projects.find((item) => item.name === projectName))
  const [name, setName] = useState(processName)
  const trimmed = name.trim()
  const duplicate =
    project?.processes.some((process) => process.name === trimmed && process.name !== processName) ?? false
  const valid = trimmed !== "" && !duplicate

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!project || !valid || trimmed === processName) return
    actions.upsertProject({
      ...project,
      processes: project.processes.map((process) =>
        process.name === processName ? { ...process, name: trimmed } : process,
      ),
    })
    onClose()
  }

  return createPortal(
    <Overlay onDismiss={onClose}>
      <Dialog
        label={`Rename ${processName}`}
        className="max-w-[360px]"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader title="Rename action" />
          <DialogBody>
            <label className="flex flex-col gap-1.5 text-sm text-surface-10">
              Name
              <input
                autoFocus
                className="w-full rounded-md border border-surface-5 bg-surface-1 px-2.5 py-1.5 text-md text-surface-12 focus:border-accent-9 focus:outline-none"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            {duplicate && <p className="m-0 text-sm text-danger-11">An action with this name already exists.</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || trimmed === processName}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </Overlay>,
    document.body,
  )
}
