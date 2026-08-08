import { useEffect, useMemo, useState } from "react"
import * as actions from "./actions"
import { CommandPalette } from "./components/CommandPalette"
import { ConfirmDialog } from "./components/ConfirmDialog"
import { HistoryWorkspace } from "./components/HistoryWorkspace"
import { ProjectDialog } from "./components/ProjectDialog"
import { ReleaseNotesWorkspace } from "./components/ReleaseNotesWorkspace"
import { SettingsDialog } from "./components/SettingsDialog"
import { PendingSessionInspector } from "./components/SessionInspector"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { TabBar } from "./components/TabBar"
import { TerminalPane } from "./components/TerminalPane"
import { useStore } from "./store"
import { Button } from "./ui/Button"

export function App() {
  const [shortcutHintsVisible, setShortcutHintsVisible] = useState(false)
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const waiting = useStore((s) => s.pending.find((tab) => tab.id === s.activeId))
  const activeHistory = useStore((s) => s.activeHistory)
  const releaseNotesActive = useStore((s) => s.releaseNotesActive)
  const terminalIds = useStore((s) => s.terminalIds)
  const projects = useStore((s) => s.projects)
  const shortcutHintsEnabled = useStore((s) => s.settings.appearance.shortcutHints)
  const inspectingId = useStore((s) => s.inspectingId)
  const closeInspector = useStore((s) => s.closeInspector)
  const openSettings = useStore((s) => s.openSettings)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const openPalette = useStore((s) => s.openPalette)
  const closePalette = useStore((s) => s.closePalette)
  const confirming = useStore((s) => s.confirming)
  const toggleInspector = useStore((s) => s.toggleInspector)

  useEffect(() => window.hangarDesktop?.onOpenSettings(openSettings), [openSettings])

  // Holding the platform shortcut modifier reveals the remaining keys directly
  // on controls that have a shortcut. Capture makes this work over xterm too.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) setShortcutHintsVisible(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) setShortcutHintsVisible(false)
    }
    const hide = () => setShortcutHintsVisible(false)
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", hide)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", hide)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === ",") {
        event.preventDefault()
        openSettings()
        return
      }
      if (!event.shiftKey && event.key.toLowerCase() === "i" && activeId !== null && activeHistory === null && !releaseNotesActive) {
        event.preventDefault()
        toggleInspector(activeId)
        return
      }
      // ⌘⇧K stays with the active terminal (clear scrollback), which claims it
      // on the capture phase; the shift split is what keeps the two apart.
      if (event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault()
        if (paletteOpen) closePalette()
        // A destructive confirm owns the keyboard until it is answered.
        else if (confirming === null) openPalette()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openSettings, openPalette, closePalette, paletteOpen, confirming, activeId, activeHistory, releaseNotesActive, toggleInspector])

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
    <div className={`grid h-full grid-cols-[280px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]${shortcutHintsEnabled && shortcutHintsVisible ? " shortcut-hints" : ""}`}>
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
              : waiting
                ? <NotStarted project={waiting.project} process={waiting.process} />
                : activeId === null && <Placeholder />}
          {waiting && inspectingId === waiting.id && (
            <PendingSessionInspector
              project={waiting.project}
              process={waiting.process}
              cmd={projects.find((project) => project.name === waiting.project)?.processes.find((process) => process.name === waiting.process)?.cmd ?? ""}
              onClose={closeInspector}
            />
          )}
        </div>
      </main>
      <StatusBar />
      <ProjectDialog />
      <SettingsDialog />
      <ConfirmDialog />
      {/* Mounted only while open: unmounting is what resets the query. */}
      {paletteOpen && <CommandPalette />}
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
      <p className="m-0 text-base text-surface-7">Pick a process in the sidebar to open it.</p>
    </div>
  )
}

/** The pane behind a pending tab: the process exists, nothing is running yet. */
function NotStarted({ project, process }: { project: string; process: string }) {
  // Read from the registry rather than the pending entry: the command can be
  // edited while the tab sits here.
  const cmd = useStore((s) => {
    const spec = s.projects.find((p) => p.name === project)?.processes.find((p) => p.name === process)
    return spec === undefined ? null : spec.shell ? "Interactive shell" : spec.cmd
  })

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-surface-9">
      <p className="m-0 text-base">
        <code>{process}</code> isn't running yet
      </p>
      {cmd !== null && (
        <p className="m-0 max-w-[70%] truncate font-mono text-xs text-surface-9" title={cmd}>
          {cmd}
        </p>
      )}
      <p className="m-0 text-base text-surface-7">Its output will appear here once it starts.</p>
      <Button variant="primary" className="mt-2.5" onClick={() => actions.start(project, process)}>
        ▶ Start {process}
      </Button>
    </div>
  )
}
