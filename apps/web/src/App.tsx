import { useEffect, useMemo, useState } from "react"
import * as actions from "./actions"
import { CommandPalette } from "./components/CommandPalette"
import { ConfirmDialog } from "./components/ConfirmDialog"
import { HelpDialog } from "./components/HelpDialog"
import { HistoryWorkspace } from "./components/HistoryWorkspace"
import { ProjectDialog } from "./components/ProjectDialog"
import { ReleaseNotesWorkspace } from "./components/ReleaseNotesWorkspace"
import { SettingsDialog } from "./components/SettingsDialog"
import { PendingSessionInspector } from "./components/SessionInspector"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { TabBar } from "./components/TabBar"
import { TerminalPane } from "./components/TerminalPane"
import { TutorialDialog } from "./components/TutorialDialog"
import { markCloseOnExit, useStore } from "./store"
import { Button } from "./ui/Button"

const MIN_SIDEBAR_WIDTH = 180
const DEFAULT_SIDEBAR_WIDTH = 280

export function App() {
  const [shortcutHintsVisible, setShortcutHintsVisible] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("hangar.sidebarWidth"))
    return Number.isFinite(saved) && saved >= MIN_SIDEBAR_WIDTH ? saved : DEFAULT_SIDEBAR_WIDTH
  })

  const resizeSidebar = (width: number) => {
    const next = Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, window.innerWidth - 320)))
    setSidebarWidth(next)
    window.localStorage.setItem("hangar.sidebarWidth", String(next))
  }

  const startSidebarResize = (_clientX: number) => {
    const onMove = (event: PointerEvent) => resizeSidebar(event.clientX)
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
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
  const openHelp = useStore((s) => s.openHelp)
  const paletteOpen = useStore((s) => s.paletteOpen)

  useEffect(() => window.hangarDesktop?.onOpenSettings(openSettings), [openSettings])
  useEffect(() => window.hangarDesktop?.onOpenHelp(openHelp), [openHelp])

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
      // This is an imperative window listener, so read the current Zustand
      // snapshot on each keypress instead of resubscribing for every state change.
      const state = useStore.getState()
      const modalOpen =
        state.confirming !== null ||
        state.tutorialOpen ||
        state.editorOpen ||
        state.settingsOpen ||
        state.helpOpen ||
        state.paletteOpen

      if (event.key === ",") {
        event.preventDefault()
        state.openSettings()
        return
      }
      if (!event.altKey && event.key.toLowerCase() === "w") {
        // Own ⌘W so Electron/the browser never closes the whole window. An open
        // modal keeps its tab in place; Shift bypasses the running-session confirm.
        event.preventDefault()
        if (modalOpen) return
        if (state.releaseNotesActive) {
          state.closeReleaseNotes()
          return
        }
        if (state.activeHistory === "overview") {
          state.closeHistory()
          return
        }
        if (state.activeHistory !== null) {
          state.closeHistoryRun(state.activeHistory)
          return
        }
        const session = state.sessions.find((item) => item.id === state.activeId)
        if (session) {
          if (session.status === "running" && event.shiftKey) {
            markCloseOnExit(session.id)
            actions.stop(session.project, session.process)
          } else if (session.status === "running") {
            state.requestConfirm({ action: "stop-close", project: session.project, process: session.process })
          } else actions.close(session)
          return
        }
        const pending = state.pending.find((tab) => tab.id === state.activeId)
        if (pending) state.closePending(pending.id)
        return
      }
      if (!event.altKey && event.key.toLowerCase() === "r") {
        // Replace browser/Electron reload with restart for the active process.
        // Running processes ask first unless Shift is held.
        event.preventDefault()
        if (modalOpen || state.activeHistory !== null || state.releaseNotesActive) return
        const session = state.sessions.find((item) => item.id === state.activeId)
        if (session) {
          if (session.status === "running" && !event.shiftKey) {
            state.requestConfirm({ action: "restart", project: session.project, process: session.process })
          } else actions.restart(session.project, session.process)
          return
        }
        const pending = state.pending.find((tab) => tab.id === state.activeId)
        if (pending) actions.start(pending.project, pending.process)
        return
      }
      if (
        !event.shiftKey &&
        event.key.toLowerCase() === "i" &&
        state.activeId !== null &&
        state.activeHistory === null &&
        !state.releaseNotesActive
      ) {
        event.preventDefault()
        state.toggleInspector(state.activeId)
        return
      }
      // ⌘⇧K stays with the active terminal (clear scrollback), which claims it
      // on the capture phase; the shift split is what keeps the two apart.
      if (event.key.toLowerCase() === "k" && !event.shiftKey) {
        event.preventDefault()
        if (state.paletteOpen) state.closePalette()
        // A destructive confirm (or the tour) owns the keyboard until it is answered.
        else if (state.confirming === null && !state.tutorialOpen) state.openPalette()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // A pane exists for every session that already has a terminal, plus the
  // active one — mounting it is what creates its terminal on first open.
  const paneIds = useMemo(
    () => sessions.filter((s) => s.id === activeId || terminalIds.includes(s.id)).map((s) => s.id),
    [sessions, activeId, terminalIds],
  )

  return (
    <div
      className={`grid h-full grid-rows-[minmax(0,1fr)]${shortcutHintsEnabled && shortcutHintsVisible ? " shortcut-hints" : ""}`}
      style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
    >
      <Sidebar onResizeStart={startSidebarResize} onResizeBy={(delta) => resizeSidebar(sidebarWidth + delta)} />
      <main className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-surface-1">
        <TabBar />
        <div className="relative min-h-0 flex-1">
          {paneIds.map((id) => (
            <TerminalPane key={id} id={id} active={id === activeId} />
          ))}
          {releaseNotesActive ? (
            <ReleaseNotesWorkspace />
          ) : activeHistory !== null ? (
            <HistoryWorkspace runId={activeHistory === "overview" ? null : activeHistory} />
          ) : waiting ? (
            <NotStarted project={waiting.project} process={waiting.process} />
          ) : (
            activeId === null && <Placeholder />
          )}
          {waiting && inspectingId === waiting.id && (
            <PendingSessionInspector
              project={waiting.project}
              process={waiting.process}
              cmd={
                projects
                  .find((project) => project.name === waiting.project)
                  ?.processes.find((process) => process.name === waiting.process)?.cmd ?? ""
              }
              onClose={closeInspector}
            />
          )}
        </div>
      </main>
      <StatusBar />
      <ProjectDialog />
      <SettingsDialog />
      <HelpDialog />
      <TutorialDialog />
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
