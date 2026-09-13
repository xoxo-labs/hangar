import { buildSidebarEntries, connIdOf, displayName, LOCAL_CONN_ID, type SidebarEntry } from "@hangar/client-core"
import { type Project, type SessionInfo, sessionId } from "@hangar/contracts"
import { ChevronRight, CircleHelp, Globe, History, Play, Plus, RotateCw, Server, Settings, Square } from "lucide-react"
import { type DragEvent, type FormEvent, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { retryConnection } from "../connections"
import { useDesktopUpdate } from "../hooks/useDesktopUpdate"
import { type ActiveShare, shareLabel, useShareForSession } from "../shares"
import { CONNECTION_LABEL, connectionTone, describe, hasHighCpu, toneOf } from "../status"
import { type ConfirmRequest, type ConnectionState, machineLabel, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { IconButton } from "../ui/IconButton"
import { MENU_SEPARATOR, Menu, type MenuItem } from "../ui/Menu"
import { AddProcessDialog } from "./AddProcessDialog"
import { Dot } from "./Dot"
import { PortShareDialog } from "./PortShareDialog"
import { SidebarUpdateButton } from "./SidebarUpdateButton"

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
const FADE_CLEARS_TWO = "mask-r-from-[calc(100%-59px)] mask-r-to-[calc(100%-51px)]"
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
  // Projects are the list, whatever machine they live on. The same repo on two
  // machines merges into one entry in its local slot; a project only a paired
  // Mac has follows in that Mac's own order. One machine comes out exactly as
  // it went in.
  const entries = useMemo(
    () => buildSidebarEntries(Object.keys(connections), projects, query),
    [connections, projects, query],
  )
  const localNames = projects.filter((item) => connIdOf(item.name) === LOCAL_CONN_ID).map((item) => item.name)

  const renderProject = (entry: SidebarEntry) => (
    <ProjectRow
      key={entry.key}
      entry={entry}
      filtering={query !== ""}
      byId={byId}
      /* Order is a per-registry thing and only this Mac's registry is dragged
       * here; a paired Mac's projects keep the order that Mac has. */
      reorderable={connIdOf(entry.key) === LOCAL_CONN_ID}
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
          const names = localNames.filter((item) => item !== dragging)
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
        <ConnectionNotices connections={connections} />
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
        {entries.length === 0 && query !== "" ? (
          <p className="mx-1.5 my-3 text-sm text-surface-9">No matches</p>
        ) : projects.length === 0 ? (
          <p className="mx-1.5 my-3 text-base leading-relaxed text-surface-10">
            No projects registered yet.
            <br />
            Add one below, or run <code>hangar add</code>.
          </p>
        ) : (
          entries.map(renderProject)
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
      <div className="flex flex-none flex-col gap-1 border-t border-surface-5 p-2">
        {/* Above the footer row, full width: complaints said the old 30px icon
         * was invisible. Appearing shifts the row below, which is the point. */}
        <SidebarUpdateButton update={update} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cx(
              "flex h-[30px] min-w-0 flex-1 items-center gap-[8px] rounded-md px-[9px]! text-left text-base! leading-none",
              activeHistory !== null
                ? "text-surface-12!"
                : "text-surface-9! hover:bg-surface-a3! hover:text-surface-12!",
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
      </div>
    </aside>
  )
}

/** How long a paired Mac may be quiet before the sidebar says so. */
const CONNECTION_NOTICE_GRACE_MS = 5000

/**
 * The only machine chrome the sidebar carries: one quiet line per paired Mac
 * that is not answering, with the retry the supervisor would otherwise wait
 * for. A brief reconnect stays silent; managing machines is a Settings matter.
 */
function ConnectionNotices({ connections }: { connections: Record<string, ConnectionState> }) {
  const troubled = Object.values(connections).filter(
    (connection) => connection.config.id !== LOCAL_CONN_ID && connection.status !== "connected",
  )
  if (troubled.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5 px-0.5 pt-1.5">
      {troubled.map((connection) => (
        <ConnectionNotice key={connection.config.id} connection={connection} />
      ))}
    </div>
  )
}

function ConnectionNotice({ connection }: { connection: ConnectionState }) {
  const { config, status } = connection
  const blocked = status === "blocked"
  // A blocked pairing is news at once; a reconnect earns a line only once it
  // has outlasted the blip a sleeping Mac or a flapping tailnet produces.
  const [settled, setSettled] = useState(blocked)
  useEffect(() => {
    if (blocked) {
      setSettled(true)
      return
    }
    setSettled(false)
    const timer = window.setTimeout(() => setSettled(true), CONNECTION_NOTICE_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [blocked, status])
  if (!settled) return null
  const label = machineLabel(connection)
  return (
    <div
      className="flex min-h-[24px] items-center gap-[7px] rounded-md px-1.5 text-xs text-surface-9"
      title={`${config.host}:${config.port} — ${connection.error ?? CONNECTION_LABEL[status]}`}
    >
      <Dot tone={connectionTone(status)} small />
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap mask-r-from-[calc(100%-8px)]">
        <span className="font-semibold text-surface-10">{label}</span> {CONNECTION_LABEL[status]}
      </span>
      <button
        type="button"
        className={cx(
          "rounded-md px-1.5! py-0.5! text-2xs! font-semibold! tracking-caps uppercase hover:bg-surface-a3!",
          blocked ? "text-danger-11!" : "text-surface-9! hover:text-surface-12!",
        )}
        title={blocked ? (connection.error ?? "This machine rejected the saved pairing") : "Try again now"}
        onClick={() => retryConnection(config.id)}
      >
        Retry
      </button>
    </div>
  )
}

/** The project-level actions of one machine's project. */
function projectMenuItems(
  project: Project,
  running: boolean,
  openEditor: (project?: string) => void,
  requestConfirm: (request: ConfirmRequest) => void,
  onAddProcess: () => void,
): MenuItem[] {
  return [
    { label: "Start all", onSelect: () => actions.start(project.name) },
    { label: "Add process…", onSelect: onAddProcess },
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
    {
      label: "Delete project…",
      // The server refuses removal while sessions run; disabling says it up front.
      disabled: running,
      danger: true,
      onSelect: (event) =>
        event.shiftKey
          ? actions.removeProject(project.name)
          : requestConfirm({ action: "remove-project", project: project.name }),
    },
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
  reorderable,
}: {
  /** One project — or the same repo on several machines, merged into one entry. */
  entry: SidebarEntry
  filtering: boolean
  byId: Map<string, SessionInfo>
  /** Whether this entry takes part in drag-to-reorder at all. */
  reorderable: boolean
  dragging: boolean
  dropSide: "before" | "after" | null
  onDragStart: () => void
  onDragOver: (side: "before" | "after") => void
  onDrop: (side: "before" | "after") => void
  onDragEnd: () => void
}) {
  // The anchor machine owns the header: its name, its path, and — where the
  // menu acts on one machine — its actions. It is this Mac whenever this Mac
  // has the project.
  const anchor = entry.parts[0]
  const project = anchor.project
  const merged = entry.parts.length > 1
  const connections = useStore((s) => s.connections)
  const remoteParts = entry.parts.filter((part) => part.connId !== LOCAL_CONN_ID)
  const machineName = (connId: string): string => {
    const connection = connections[connId]
    return connection ? machineLabel(connection) : connId
  }
  // Rows say which Mac they run on only where the card does not already: a
  // mixed card marks its remote rows; a card spanning several paired Macs
  // names the Mac as well, since one glyph could mean either.
  const rowIcon = entry.presence === "mixed"
  const rowTag = remoteParts.length > 1
  const collapsed = useStore((s) => s.collapsed[entry.key] ?? false)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const openEditor = useStore((s) => s.openEditor)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [addingProcess, setAddingProcess] = useState(false)

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
  const expanded = !collapsed || filtering

  const dragOver = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const rect = event.currentTarget.getBoundingClientRect()
    onDragOver(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
  }

  const menuItems = merged
    ? mergedMenuItems(entry, byId, machineName, openEditor, () => setAddingProcess(true))
    : projectMenuItems(project, running, openEditor, requestConfirm, () => setAddingProcess(true))

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
      onDragOver={reorderable ? dragOver : undefined}
      onDrop={(event) => {
        if (!reorderable) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onDrop(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
      }}
    >
      <div
        className={cx(ROW, "group hover:bg-surface-a3")}
        /* Reordering a filtered list against the full registry order is
         * ambiguous, so dragging waits until the filter is cleared. */
        draggable={reorderable && !filtering}
        title={reorderable && !filtering ? "Drag to reorder project" : undefined}
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
          {entry.presence === "remote-only" && (
            /* The whole card lives elsewhere, so the card says so once and its
             * rows stay as clean as a local project's. */
            <MachineGlyph title={`On ${entry.parts.map((part) => machineName(part.connId)).join(", ")}`} />
          )}
          <span
            className={cx(
              LABEL,
              "text-md font-semibold text-surface-12",
              menuOpen ? FADE_CLEARS_TWO : FADE,
              FADE_HOVER_TWO,
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
          {/* The menu keeps its Add entry; this is the discoverable door. */}
          <IconButton
            title={`Add process to ${displayName(project.name)}`}
            aria-label={`Add process to ${displayName(project.name)}`}
            onClick={() => setAddingProcess(true)}
          >
            <Plus className="size-[14px]" aria-hidden="true" />
          </IconButton>
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

      {addingProcess && (
        <AddProcessDialog
          projects={[project, ...entry.parts.slice(1).map((part) => part.project)]}
          onClose={() => setAddingProcess(false)}
        />
      )}

      {expanded && (
        /* One flat list whatever the machines: every row keeps its scoped ids,
         * so starting, stopping and focusing all reach the Mac the row belongs to. */
        <ul className="mt-[3px] mr-0 mb-0 ml-2.5 list-none border-l border-surface-5 py-0 pr-0 pl-2">
          {entry.parts.flatMap((part) =>
            part.processes.map((proc) => (
              <ProcessRow
                key={`${part.project.name}/${proc.name}`}
                project={part.project.name}
                name={proc.name}
                cmd={proc.shell ? "Interactive shell" : proc.cmd}
                description={proc.description}
                session={byId.get(sessionId(part.project.name, proc.name))}
                machine={
                  part.connId === LOCAL_CONN_ID
                    ? undefined
                    : { label: machineName(part.connId), icon: rowIcon, tag: rowTag }
                }
              />
            )),
          )}
        </ul>
      )}
    </section>
  )
}

/** The two stacked boxes that mean "runs on another Mac". */
function MachineGlyph({ title }: { title: string }) {
  return (
    <span className="flex-none text-surface-9" title={title}>
      <Server className="size-[11px]" aria-hidden="true" />
    </span>
  )
}

/**
 * The header menu of a merged entry. Start, restart and stop act on one
 * machine's project, so each Mac gets its own; editing opens every machine's
 * copy at once, and deleting happens per machine in there.
 */
function mergedMenuItems(
  entry: SidebarEntry,
  byId: Map<string, SessionInfo>,
  machineName: (connId: string) => string,
  openEditor: (project?: string) => void,
  onAddProcess: () => void,
): MenuItem[] {
  const requestConfirm = useStore.getState().requestConfirm
  const anchor = entry.parts[0]
  return [
    { label: "Add process…", onSelect: onAddProcess },
    { label: "Open empty terminal", onSelect: () => actions.openEmptyTerminal(anchor.project) },
    ...entry.parts.flatMap((part): MenuItem[] => {
      const project = part.project
      const on = machineName(part.connId)
      const running = project.processes.some(
        (process) => byId.get(sessionId(project.name, process.name))?.status === "running",
      )
      return [
        MENU_SEPARATOR,
        { label: `Start all on ${on}`, onSelect: () => actions.start(project.name) },
        {
          label: `Restart all on ${on}`,
          disabled: !running,
          onSelect: () => requestConfirm({ action: "restart", project: project.name }),
        },
        {
          label: `Stop all on ${on}`,
          disabled: !running,
          onSelect: () => requestConfirm({ action: "stop", project: project.name }),
        },
      ]
    }),
    MENU_SEPARATOR,
    { label: "Edit project…", onSelect: () => openEditor(anchor.project.name) },
  ]
}

/**
 * The process menu only navigates into sharing. Reach choices and every on/off
 * action live in the modal, so this menu cannot drift into a second sharing UI.
 */
function shareMenuItems(share: ActiveShare | undefined, ports: number[], open: (port: number) => void): MenuItem[] {
  const available = [...new Set([...(share === undefined ? [] : [share.port]), ...ports])]
  if (available.length === 0) return []
  return [MENU_SEPARATOR, ...available.map((port) => ({ label: `Share :${port}…`, onSelect: () => open(port) }))]
}

function ProcessRow({
  project,
  name,
  cmd,
  description,
  session,
  machine,
}: {
  project: string
  name: string
  cmd: string
  description: string | undefined
  session: SessionInfo | undefined
  /** Set on a row that runs on a paired Mac: which one, and how loudly to say so. */
  machine: { label: string; icon: boolean; tag: boolean } | undefined
}) {
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const openPending = useStore((s) => s.openPending)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [sharingPort, setSharingPort] = useState<number | null>(null)

  const id = sessionId(project, name)
  const running = session?.status === "running"
  const selected = activeId === id
  const share = useShareForSession(id)
  // Ports are detected on a live process. An exited process can still open the
  // modal for a live share so the user always has a route to stop it.
  const shareItems = shareMenuItems(share, running ? (session?.metrics?.ports ?? []) : [], setSharingPort)

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
        {share && (
          /* The row's background is already spoken for by selection and hover,
           * so reach is carried by this icon's tone alone: warning means anyone
           * on the internet can reach it. */
          <span className="flex-none" title={`:${share.port} — ${shareLabel(share.kind)}`}>
            <Globe
              className={cx("size-[11px]", share.kind === "public" ? "text-warning-10" : "text-surface-9")}
              aria-hidden="true"
            />
          </span>
        )}
        {machine?.icon && <MachineGlyph title={`Runs on ${machine.label}`} />}
        <span className={cx(LABEL, "text-base", FADE, running ? FADE_HOVER_TWO : FADE_HOVER_ONE)}>
          {name}
          {machine?.tag && (
            <span className="ml-1.5 text-2xs text-surface-9" title={`Runs on ${machine.label}`}>
              {machine.label}
            </span>
          )}
        </span>
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
          {
            label: "Delete process…",
            disabled: running,
            danger: true,
            onSelect: (event) =>
              event.shiftKey
                ? actions.removeProcess(project, name)
                : requestConfirm({ action: "remove-process", project, process: name }),
          },
          ...shareItems,
        ]}
      />

      {renameOpen && (
        <RenameProcessDialog projectName={project} processName={name} onClose={() => setRenameOpen(false)} />
      )}
      {sharingPort !== null &&
        session &&
        createPortal(
          <PortShareDialog
            connId={connIdOf(id)}
            port={sharingPort}
            session={session.id}
            metrics={session.metrics}
            onClose={() => setSharingPort(null)}
          />,
          document.body,
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
