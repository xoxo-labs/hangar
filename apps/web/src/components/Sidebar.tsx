import { type Project, type SessionInfo, sessionId } from "@hangar/contracts"
import { type DragEvent, useMemo, useState } from "react"
import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { cx } from "../ui/cx"
import { IconButton } from "../ui/IconButton"
import { Dot } from "./Dot"

/*
 * The `!` on padding/color/border/font utilities below dates from when the
 * `button { … }` reset in styles.css was unlayered and outranked utilities.
 * The reset now lives in `@layer base`, so plain utilities already win; the
 * suffixes are harmless belt-and-braces, not load-bearing. The `!` on the
 * `electron:` padding overrides is different and stays: it guarantees they
 * beat the base `px-`/`py-` utilities regardless of variant sort order.
 */
const ROW = "flex items-center gap-1 rounded-md pr-1"
const ROW_MAIN = "flex min-w-0 flex-1 items-center gap-[7px] px-1.5! py-[5px]! text-left"
const ROW_LABEL = "flex min-w-0 flex-col"
const ROW_ACTIONS =
  "flex flex-none justify-end gap-[3px] opacity-[0.45] transition-opacity duration-[120ms] ease-[ease] group-hover:opacity-100 group-focus-within:opacity-100"

export function Sidebar() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const openEditor = useStore((s) => s.openEditor)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ name: string; side: "before" | "after" } | null>(null)

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  return (
    <aside className="row-start-1 col-start-1 flex min-h-0 flex-col border-r border-surface-5 bg-surface-2 select-none">
      <header className="flex min-h-[48px] flex-none items-center gap-[9px] border-b border-surface-5 bg-surface-3 px-3.5 py-[7px] electron:h-[48px] electron:py-0! electron:pr-3.5! electron:pl-[92px]! electron:[-webkit-app-region:drag]">
        <span className="flex min-w-0 flex-col leading-[1.1]">
          <h1 className="m-0 text-[13.5px] font-[650] tracking-[0.015em]">hangar</h1>
          <span className="mt-0.5 text-[8.5px] font-[550] tracking-[0.075em] whitespace-nowrap text-surface-8 uppercase">
            project workspace
          </span>
        </span>
      </header>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3">
        <div className="flex items-center justify-between px-1.5 pt-[7px] pb-2 text-[9.5px] font-semibold tracking-[0.09em] text-surface-9 uppercase">
          <span>Projects</span>
          <span className="min-w-[17px] rounded-lg bg-surface-a3 px-[5px] py-px text-center text-[9px] tracking-[0]">
            {projects.length}
          </span>
        </div>
        {projects.length === 0 ? (
          <p className="mx-1.5 my-3 text-[12px] leading-[1.6] text-surface-10">
            No projects registered yet.
            <br />
            Add one below, or run <code>hangar add</code>.
          </p>
        ) : (
          projects.map((project) => (
            <ProjectRow
              key={project.name}
              project={project}
              byId={byId}
              dragging={dragging === project.name}
              dropSide={dropTarget?.name === project.name ? dropTarget.side : null}
              onDragStart={() => {
                setDragging(project.name)
                setDropTarget(null)
              }}
              onDragOver={(side) => {
                if (dragging !== null && dragging !== project.name) {
                  setDropTarget({ name: project.name, side })
                }
              }}
              onDrop={(side) => {
                if (dragging !== null && dragging !== project.name) {
                  const names = projects.map((item) => item.name).filter((item) => item !== dragging)
                  const targetIndex = names.indexOf(project.name)
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
          ))
        )}

        <button
          type="button"
          className="mt-0.5 block w-full rounded-md border! border-dashed! border-surface-5! p-1.5! text-center text-[11.5px]! text-surface-9! hover:border-surface-8! hover:bg-surface-a3! hover:text-surface-12!"
          onClick={() => openEditor()}
        >
          + New project
        </button>
      </nav>
    </aside>
  )
}

function ProjectRow({
  project,
  byId,
  dragging,
  dropSide,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  project: Project
  byId: Map<string, SessionInfo>
  dragging: boolean
  dropSide: "before" | "after" | null
  onDragStart: () => void
  onDragOver: (side: "before" | "after") => void
  onDrop: (side: "before" | "after") => void
  onDragEnd: () => void
}) {
  const collapsed = useStore((s) => s.collapsed[project.name] ?? false)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const openEditor = useStore((s) => s.openEditor)
  const requestConfirm = useStore((s) => s.requestConfirm)

  const running = project.processes.some(
    (p) => byId.get(sessionId(project.name, p.name))?.status === "running",
  )

  const dragOver = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const rect = event.currentTarget.getBoundingClientRect()
    onDragOver(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
  }

  return (
    <section
      className={cx(
        "relative mb-1.5",
        dragging && "opacity-[0.45]",
        dropSide === "before" &&
          "before:pointer-events-none before:absolute before:-top-1 before:right-1 before:left-1 before:z-[2] before:h-0.5 before:rounded-[2px] before:bg-accent-9 before:content-['']",
        dropSide === "after" &&
          "after:pointer-events-none after:absolute after:-bottom-1 after:right-1 after:left-1 after:z-[2] after:h-0.5 after:rounded-[2px] after:bg-accent-9 after:content-['']",
      )}
      onDragOver={dragOver}
      onDrop={(event) => {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onDrop(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
      }}
    >
      <div
        className={cx(ROW, "group cursor-grab bg-surface-a2 hover:bg-surface-a3 active:cursor-grabbing")}
        draggable
        title="Drag to reorder project"
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", project.name)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
      >
        <button
          type="button"
          className={ROW_MAIN}
          onClick={() => toggleCollapsed(project.name)}
          aria-expanded={!collapsed}
        >
          <span
            className={cx(
              "w-2 text-[8px] text-surface-9 transition-transform duration-[120ms] ease-[ease]",
              !collapsed && "rotate-90",
            )}
            aria-hidden="true"
          >
            ▶
          </span>
          <Dot tone={running ? "running" : "idle"} title={running ? "running" : "idle"} />
          <span className={ROW_LABEL}>
            <span className="truncate text-[12.5px] font-semibold text-surface-12">{project.name}</span>
            <span className="truncate text-[10.5px] text-surface-9" title={project.path}>
              {project.path}
            </span>
          </span>
        </button>

        {/* 4 × 26px button + 3 × 3px gap */}
        <div className={cx(ROW_ACTIONS, "min-w-[113px]")}>
          <IconButton title={`Edit ${project.name}`} onClick={() => openEditor(project.name)}>
            ✎
          </IconButton>
          <IconButton title="Start all processes" onClick={() => actions.start(project.name)}>
            ▶
          </IconButton>
          {running && (
            <IconButton
              title="Restart all processes"
              onClick={() => requestConfirm({ action: "restart", project: project.name })}
            >
              ↻
            </IconButton>
          )}
          <IconButton
            title="Stop all processes"
            disabled={!running}
            onClick={() => requestConfirm({ action: "stop", project: project.name })}
          >
            ■
          </IconButton>
        </div>
      </div>

      {!collapsed && (
        <ul className="mt-[3px] mr-0 mb-0 ml-2.5 list-none border-l border-surface-5 py-0 pr-0 pl-2">
          {project.processes.map((proc) => (
            <ProcessRow
              key={proc.name}
              project={project.name}
              name={proc.name}
              cmd={proc.shell ? "Interactive shell" : proc.cmd}
              session={byId.get(sessionId(project.name, proc.name))}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ProcessRow({
  project,
  name,
  cmd,
  session,
}: {
  project: string
  name: string
  cmd: string
  session: SessionInfo | undefined
}) {
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const requestConfirm = useStore((s) => s.requestConfirm)

  const id = sessionId(project, name)
  const running = session?.status === "running"
  const selected = activeId === id

  return (
    <li
      // `.row.selected` sat after `.row:hover` in styles.css, so a selected row
      // kept surface-a4 while hovered — hence the either/or here.
      className={cx(ROW, "group", selected ? "bg-surface-a4" : "hover:bg-surface-a3")}
      onClick={() => {
        if (session) setActive(id)
      }}
    >
      <button
        type="button"
        className={cx(ROW_MAIN, selected ? "text-surface-12!" : "text-surface-10! group-hover:text-surface-12!")}
        title={cmd}
        onClick={() => (session ? setActive(id) : actions.start(project, name))}
      >
        <Dot tone={toneOf(session)} small title={describe(session)} />
        <span className={ROW_LABEL}>
          <span className="truncate text-[11.5px]">{name}</span>
          <span className="max-w-[150px] truncate font-mono text-[9.5px] text-surface-9" title={cmd}>
            {cmd}
          </span>
        </span>
      </button>

      {/* 2 × 26px button + 1 × 3px gap */}
      <div className={cx(ROW_ACTIONS, "min-w-[55px]")}>
        {running ? (
          <>
            <IconButton
              title={`Restart ${name}`}
              onClick={() => requestConfirm({ action: "restart", project, process: name })}
            >
              ↻
            </IconButton>
            <IconButton
              title={`Stop ${name}`}
              onClick={() => requestConfirm({ action: "stop", project, process: name })}
            >
              ■
            </IconButton>
          </>
        ) : (
          <IconButton title={`Start ${name}`} onClick={() => actions.start(project, name)}>
            ▶
          </IconButton>
        )}
      </div>
    </li>
  )
}
