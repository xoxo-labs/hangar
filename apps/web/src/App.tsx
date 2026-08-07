import { useMemo } from "react"
import { ProjectDialog } from "./components/ProjectDialog"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { TabBar } from "./components/TabBar"
import { TerminalPane } from "./components/TerminalPane"
import { useStore } from "./store"

export function App() {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const terminalIds = useStore((s) => s.terminalIds)

  // A pane exists for every session that already has a terminal, plus the
  // active one — mounting it is what creates its terminal on first open.
  const paneIds = useMemo(
    () =>
      sessions
        .filter((s) => s.id === activeId || terminalIds.includes(s.id))
        .map((s) => s.id),
    [sessions, activeId, terminalIds],
  )

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TabBar />
        <div className="stage">
          {paneIds.map((id) => (
            <TerminalPane key={id} id={id} active={id === activeId} />
          ))}
          {activeId === null && <Placeholder />}
        </div>
      </main>
      <StatusBar />
      <ProjectDialog />
    </div>
  )
}

function Placeholder() {
  return (
    <div className="placeholder">
      <span className="placeholder-mark" aria-hidden="true" />
      <p>No session open</p>
      <p className="placeholder-hint">Pick a process in the sidebar to start it.</p>
    </div>
  )
}
