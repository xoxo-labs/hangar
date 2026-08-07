import * as actions from "../actions"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { Dot } from "./Dot"

export function TabBar() {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const requestConfirm = useStore((s) => s.requestConfirm)

  if (sessions.length === 0) return <div className="tabbar empty-tabbar" />

  return (
    <div className="tabbar" role="tablist">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`tab${session.id === activeId ? " active" : ""}`}
          role="tab"
          aria-selected={session.id === activeId}
        >
          <button
            type="button"
            className="tab-main"
            title={session.cmd}
            onClick={() => setActive(session.id)}
          >
            <Dot tone={toneOf(session)} small title={describe(session)} />
            <span className="tab-label">{session.id}</span>
          </button>
          <button
            type="button"
            className="tab-close"
            title={session.status === "running" ? `Stop ${session.process}` : "Close session"}
            onClick={() =>
              session.status === "running"
                ? requestConfirm({
                    action: "stop-close",
                    project: session.project,
                    process: session.process,
                  })
                : actions.close(session)
            }
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
