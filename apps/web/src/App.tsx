import { useEffect, useMemo } from "react"
import { ConfirmDialog } from "./components/ConfirmDialog"
import { HistoryWorkspace } from "./components/HistoryWorkspace"
import { ProjectDialog } from "./components/ProjectDialog"
import { ReleaseNotesWorkspace } from "./components/ReleaseNotesWorkspace"
import { SettingsDialog } from "./components/SettingsDialog"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { TabBar } from "./components/TabBar"
import { TerminalPane } from "./components/TerminalPane"
import { useStore } from "./store"

export function App() {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const activeHistory = useStore((s) => s.activeHistory)
  const releaseNotesActive = useStore((s) => s.releaseNotesActive)
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
    <div className="grid h-full grid-cols-[280px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <Sidebar />
      <main className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-surface-1">
        <TabBar />
        <div className="relative min-h-0 flex-1">
          {paneIds.map((id) => (
            <TerminalPane key={id} id={id} active={id === activeId} />
          ))}
          {releaseNotesActive
            ? <ReleaseNotesWorkspace />
            : activeHistory !== null
              ? <HistoryWorkspace runId={activeHistory === "overview" ? null : activeHistory} />
              : activeId === null && <Placeholder />}
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-surface-9">
      <span
        className="mb-2.5 size-[34px] rounded-[10px] bg-[linear-gradient(150deg,var(--color-accent-9),var(--color-brand-10))] opacity-[0.28]"
        aria-hidden="true"
      />
      <p className="m-0 text-base">No session open</p>
      <p className="m-0 text-base text-surface-7">Pick a process in the sidebar to start it.</p>
    </div>
  )
}
