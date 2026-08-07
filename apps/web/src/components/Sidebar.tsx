import { type Project, type SessionInfo, sessionId } from "@hangar/contracts"
import { type DragEvent, useMemo, useState } from "react"
import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { Dot } from "./Dot"

export function Sidebar() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const openEditor = useStore((s) => s.openEditor)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ name: string; side: "before" | "after" } | null>(null)

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  return (
    <aside className="sidebar">
      <header className="brand">
        <span className="brand-copy">
          <h1>hangar</h1>
          <span className="brand-subtitle">project workspace</span>
        </span>
      </header>

      <nav className="projects">
        <div className="projects-heading">
          <span>Projects</span>
          <span className="projects-count">{projects.length}</span>
        </div>
        {projects.length === 0 ? (
          <p className="empty">
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

        <button type="button" className="new-project" onClick={() => openEditor()}>
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
      className={`project${dragging ? " dragging" : ""}${dropSide ? ` drop-${dropSide}` : ""}`}
      onDragOver={dragOver}
      onDrop={(event) => {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onDrop(event.clientY < rect.top + rect.height / 2 ? "before" : "after")
      }}
    >
      <div
        className="row project-row"
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
          className="row-main"
          onClick={() => toggleCollapsed(project.name)}
          aria-expanded={!collapsed}
        >
          <span className={`chevron${collapsed ? "" : " open"}`} aria-hidden="true">
            ▶
          </span>
          <Dot tone={running ? "running" : "idle"} title={running ? "running" : "idle"} />
          <span className="row-label">
            <span className="row-name">{project.name}</span>
            <span className="row-sub" title={project.path}>
              {project.path}
            </span>
          </span>
        </button>

        <div className="row-actions">
          <button
            type="button"
            className="icon-button"
            title={`Edit ${project.name}`}
            onClick={() => openEditor(project.name)}
          >
            ✎
          </button>
          <button
            type="button"
            className="icon-button"
            title="Start all processes"
            onClick={() => actions.start(project.name)}
          >
            ▶
          </button>
          {running && (
            <button
              type="button"
              className="icon-button"
              title="Restart all processes"
              onClick={() => requestConfirm({ action: "restart", project: project.name })}
            >
              ↻
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            title="Stop all processes"
            disabled={!running}
            onClick={() => requestConfirm({ action: "stop", project: project.name })}
          >
            ■
          </button>
        </div>
      </div>

      {!collapsed && (
        <ul className="processes">
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

  return (
    <li
      className={`row process-row${activeId === id ? " selected" : ""}`}
      onClick={() => {
        if (session) setActive(id)
      }}
    >
      <button
        type="button"
        className="row-main"
        title={cmd}
        onClick={() => (session ? setActive(id) : actions.start(project, name))}
      >
        <Dot tone={toneOf(session)} small title={describe(session)} />
        <span className="row-label">
          <span className="row-name">{name}</span>
          <span className="row-sub" title={cmd}>{cmd}</span>
        </span>
      </button>

      <div className="row-actions">
        {running ? (
          <>
            <button
              type="button"
              className="icon-button"
              title={`Restart ${name}`}
              onClick={() => requestConfirm({ action: "restart", project, process: name })}
            >
              ↻
            </button>
            <button
              type="button"
              className="icon-button"
              title={`Stop ${name}`}
              onClick={() => requestConfirm({ action: "stop", project, process: name })}
            >
              ■
            </button>
          </>
        ) : (
          <button
            type="button"
            className="icon-button"
            title={`Start ${name}`}
            onClick={() => actions.start(project, name)}
          >
            ▶
          </button>
        )}
      </div>
    </li>
  )
}

