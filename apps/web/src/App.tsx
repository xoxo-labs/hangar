import { useEffect, useMemo } from "react"
import { ConfirmDialog } from "./components/ConfirmDialog"
import { ProjectDialog } from "./components/ProjectDialog"
import { SettingsDialog } from "./components/SettingsDialog"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { TabBar } from "./components/TabBar"
import { TerminalPane } from "./components/TerminalPane"
import { useStore } from "./store"

export function App() {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const terminalIds = useStore((s) => s.terminalIds)
  const openSettings = useStore((s) => s.openSettings)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault()
        openSettings()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openSettings])

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
      <SettingsDialog />
      <ConfirmDialog />
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
