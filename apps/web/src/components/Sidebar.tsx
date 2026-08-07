import { type Project, type SessionInfo, sessionId } from "@hangar/contracts"
import { useMemo } from "react"
import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { ArmedButton } from "./ArmedButton"
import { Dot } from "./Dot"

export function Sidebar() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const openEditor = useStore((s) => s.openEditor)

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  return (
    <aside className="sidebar">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <h1>hangar</h1>
      </header>

      <nav className="projects">
        {projects.length === 0 ? (
          <p className="empty">
            No projects registered yet.
            <br />
            Add one below, or run <code>hangar add</code>.
          </p>
        ) : (
          projects.map((project) => (
            <ProjectRow key={project.name} project={project} byId={byId} />
          ))
        )}

        <button type="button" className="new-project" onClick={() => openEditor()}>
          + New project
        </button>
      </nav>
    </aside>
  )
}

function ProjectRow({ project, byId }: { project: Project; byId: Map<string, SessionInfo> }) {
  const collapsed = useStore((s) => s.collapsed[project.name] ?? false)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const openEditor = useStore((s) => s.openEditor)
  const disarm = useStore((s) => s.disarm)

  const running = project.processes.some(
    (p) => byId.get(sessionId(project.name, p.name))?.status === "running",
  )

  return (
    <section className="project">
      {/* Leaving the row cancels a confirmation the pointer left half-done. */}
      <div className="row project-row" onMouseLeave={() => disarm()}>
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
            <ArmedButton
              armKey={`restart:${project.name}`}
              title="Restart all processes"
              armedTitle="Click again to restart all"
              glyph="↻"
              onConfirm={() => actions.restart(project.name)}
            />
          )}
          <ArmedButton
            armKey={`stop:${project.name}`}
            title="Stop all processes"
            armedTitle="Click again to stop all"
            glyph="■"
            disabled={!running}
            onConfirm={() => actions.stop(project.name)}
          />
        </div>
      </div>

      {!collapsed && (
        <ul className="processes">
          {project.processes.map((proc) => (
            <ProcessRow
              key={proc.name}
              project={project.name}
              name={proc.name}
              cmd={proc.cmd}
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
  const disarm = useStore((s) => s.disarm)

  const id = sessionId(project, name)
  const running = session?.status === "running"

  return (
    <li
      className={`row process-row${activeId === id ? " selected" : ""}`}
      onMouseLeave={() => disarm()}
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
        </span>
      </button>

      <div className="row-actions">
        {running ? (
          <>
            <ArmedButton
              armKey={`restart:${id}`}
              title={`Restart ${name}`}
              armedTitle={`Click again to restart ${name}`}
              glyph="↻"
              onConfirm={() => actions.restart(project, name)}
            />
            <ArmedButton
              armKey={`stop:${id}`}
              title={`Stop ${name}`}
              armedTitle={`Click again to stop ${name}`}
              glyph="■"
              onConfirm={() => actions.stop(project, name)}
            />
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

