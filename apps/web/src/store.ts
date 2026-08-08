import {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  sessionId,
  type AppSettings,
  type HistoryOutputEvent,
  type Project,
  type SessionHistoryEntry,
  type SessionId,
  type SessionInfo,
  type SessionMetrics,
} from "@hangar/contracts"
import { create } from "zustand"

export type ConnectionStatus = "connecting" | "connected" | "reconnecting"

export type HistoryReplay = {
  loading: boolean
  events: HistoryOutputEvent[]
  truncated: boolean
}

export type SessionMetricPoint = {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  outputBytesPerSecond: number
}

/**
 * A tab opened for a process that has no session yet. Its id is the one the
 * session will be given, so the tab keeps its slot when the process starts.
 */
export type PendingTab = { id: SessionId; project: string; process: string }

/** A destructive action waiting for the user's OK in the confirm dialog. */
export type ConfirmRequest = {
  /** "stop-close" also closes the session's tab once the exit lands. */
  action: "stop" | "restart" | "stop-close"
  project: string
  /** Undefined targets every process of the project. */
  process?: string
}

/**
 * Sessions whose tab should close as soon as their exit arrives — the server
 * refuses to dismiss a running session, so the client finishes the job.
 */
const closeOnExit = new Set<SessionId>()
let noticeTimer: ReturnType<typeof setTimeout> | null = null

export function markCloseOnExit(id: SessionId): void {
  closeOnExit.add(id)
}

/** True (once) if this exit should be followed by a dismiss. */
export function takeCloseOnExit(id: SessionId): boolean {
  return closeOnExit.delete(id)
}

type Store = {
  /** Registry projects, as last broadcast by the server. */
  projects: Project[]
  /** Live sessions, kept in a stable tab order (existing first, new appended). */
  sessions: SessionInfo[]
  /** Tabs opened for processes that are not running yet. */
  pending: PendingTab[]
  /** Persisted run summaries, newest first. */
  history: SessionHistoryEntry[]
  /** Recent live samples, kept in memory for session sparklines. */
  metricHistory: Record<SessionId, SessionMetricPoint[]>
  /** Live session whose terminal is visible. Null while browsing history. */
  activeId: SessionId | null
  /** History overview or archived run currently visible. */
  activeHistory: "overview" | string | null
  /** Whether the History overview tab is currently open. */
  historyOpen: boolean
  /** Archived runs opened as tabs. */
  historyTabs: string[]
  /** Whether the release notes tab is open and/or selected. */
  releaseNotesOpen: boolean
  releaseNotesActive: boolean
  /** Keys controlling the visual order of every open workspace tab. */
  tabOrder: string[]
  /** Timestamped ANSI output loaded lazily for historical tabs. */
  historyReplays: Record<string, HistoryReplay>
  /** Sessions that already own an xterm instance (panes are rendered for these). */
  terminalIds: SessionId[]
  /** Session whose details drawer is open. */
  inspectingId: SessionId | null
  /** Projects the user collapsed in the sidebar. */
  collapsed: Record<string, boolean>
  status: ConnectionStatus
  port: number
  settings: AppSettings
  settingsOpen: boolean
  /** Whether the ⌘K command palette is up. */
  paletteOpen: boolean
  lastError: string | null
  notice: string | null
  /** Whether the add/edit project dialog is up. */
  editorOpen: boolean
  /** Project the dialog is editing; null while it is creating a new one. */
  editingProject: string | null
  /** Folder selected before opening the new-project dialog. */
  newProjectPath: string
  /** Stop/restart waiting in the confirm dialog; null when it is closed. */
  confirming: ConfirmRequest | null

  applyState: (projects: Project[], sessions: SessionInfo[], history: SessionHistoryEntry[], settings: AppSettings) => void
  updateMetrics: (id: SessionId, runId: string, metrics: SessionMetrics) => void
  setStatus: (status: ConnectionStatus) => void
  setActive: (id: SessionId | null) => void
  /** Opens (and focuses) the tab of a process that has not been started. */
  openPending: (project: string, process: string) => void
  closePending: (id: SessionId) => void
  openHistory: () => void
  closeHistory: () => void
  openHistoryRun: (runId: string) => void
  closeHistoryRun: (runId: string) => void
  openReleaseNotes: () => void
  closeReleaseNotes: () => void
  reorderTab: (source: string, target: string) => void
  beginHistoryReplay: (runId: string) => void
  setHistoryReplay: (runId: string, events: HistoryOutputEvent[], truncated: boolean) => void
  openInspector: (id: SessionId) => void
  toggleInspector: (id: SessionId) => void
  closeInspector: () => void
  toggleCollapsed: (project: string) => void
  noteTerminal: (id: SessionId) => void
  dropTerminal: (id: SessionId) => void
  setError: (message: string | null) => void
  showNotice: (message: string) => void
  /** Opens the dialog: with a name to edit that project, without one to create. */
  openEditor: (project?: string) => void
  closeEditor: () => void
  openSettings: () => void
  closeSettings: () => void
  openPalette: () => void
  closePalette: () => void
  requestConfirm: (request: ConfirmRequest) => void
  closeConfirm: () => void
}

export const useStore = create<Store>((set) => ({
  projects: [],
  sessions: [],
  pending: [],
  history: [],
  metricHistory: {},
  activeId: null,
  activeHistory: null,
  historyOpen: false,
  historyTabs: [],
  releaseNotesOpen: false,
  releaseNotesActive: false,
  tabOrder: [],
  historyReplays: {},
  terminalIds: [],
  inspectingId: null,
  collapsed: {},
  status: "connecting",
  port: readPort(),
  settings: structuredClone(DEFAULT_SETTINGS),
  settingsOpen: false,
  paletteOpen: false,
  lastError: null,
  notice: null,
  editorOpen: false,
  editingProject: null,
  newProjectPath: "",
  confirming: null,

  applyState: (projects, sessions, history, settings) =>
    set((state) => {
      const next = new Map(sessions.map((s) => [s.id, s]))
      const ordered: SessionInfo[] = []
      // Preserve the order of sessions we already knew about…
      for (const known of state.sessions) {
        const fresh = next.get(known.id)
        if (fresh) {
          ordered.push(fresh)
          next.delete(known.id)
        }
      }
      // …then append the ones that just appeared.
      const added = [...next.values()]
      ordered.push(...added)

      // A pending tab is done once its session exists, or once the registry
      // stops offering that process at all.
      const live = new Set(sessions.map((session) => session.id))
      const pending = state.pending.filter(
        (tab) =>
          !live.has(tab.id) &&
          projects.some(
            (project) =>
              project.name === tab.project && project.processes.some((p) => p.name === tab.process),
          ),
      )

      // A session that just started grabs focus; on the very first state (the
      // page just loaded into a server with running sessions) take the first.
      const focus = state.sessions.length === 0 ? added[0] : added.at(-1)
      const stillOpen =
        state.activeId !== null &&
        (ordered.some((s) => s.id === state.activeId) || pending.some((tab) => tab.id === state.activeId))
      const activeId =
        focus?.id ?? (stillOpen ? state.activeId : (ordered.at(-1)?.id ?? null))

      const metricHistory = Object.fromEntries(
        Object.entries(state.metricHistory).filter(([id]) => ordered.some((session) => session.id === id)),
      )
      const validRuns = new Set(history.map((entry) => entry.runId))
      const historyTabs = state.historyTabs.filter((runId) => validRuns.has(runId))
      const historyReplays = Object.fromEntries(
        Object.entries(state.historyReplays).filter(([runId]) => validRuns.has(runId)),
      )
      const activeHistory = focus
        ? null
        : state.activeHistory !== null && state.activeHistory !== "overview" && !validRuns.has(state.activeHistory)
          ? (state.historyOpen ? "overview" : null)
          : state.activeHistory
      const validTabKeys = new Set([
        ...ordered.map((session) => `session:${session.id}`),
        ...pending.map((tab) => `session:${tab.id}`),
        ...(state.historyOpen ? ["history"] : []),
        ...historyTabs.map((runId) => `history:${runId}`),
        ...(state.releaseNotesOpen ? ["release-notes"] : []),
      ])
      const tabOrder = state.tabOrder.filter((key) => validTabKeys.delete(key))
      tabOrder.push(...validTabKeys)
      const releaseNotesActive = focus ? false : state.releaseNotesActive
      const nextActiveId = activeHistory === null && !releaseNotesActive ? activeId : null
      return { projects, sessions: ordered, pending, history, historyTabs, historyReplays, metricHistory, activeId: nextActiveId, activeHistory, releaseNotesActive, tabOrder, settings }
    }),

  updateMetrics: (id, runId, metrics) =>
    set((state) => {
      const current = state.sessions.find((session) => session.id === id)
      if (!current || current.runId !== runId) return state
      const previous = state.metricHistory[id] ?? []
      const point: SessionMetricPoint = {
        sampledAt: metrics.sampledAt,
        cpuPercent: metrics.cpuPercent,
        memoryBytes: metrics.memoryBytes,
        processCount: metrics.processCount,
        outputBytesPerSecond: metrics.outputBytesPerSecond,
      }
      return {
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, metrics } : session,
        ),
        metricHistory: { ...state.metricHistory, [id]: [...previous, point].slice(-450) },
      }
    }),

  setStatus: (status) => set({ status }),

  setActive: (activeId) => set({ activeId, activeHistory: null, releaseNotesActive: false }),

  openPending: (project, process) =>
    set((state) => {
      const id = sessionId(project, process)
      const key = `session:${id}`
      return {
        activeId: id,
        activeHistory: null,
        releaseNotesActive: false,
        pending: state.pending.some((tab) => tab.id === id)
          ? state.pending
          : [...state.pending, { id, project, process }],
        tabOrder: state.tabOrder.includes(key) ? state.tabOrder : [...state.tabOrder, key],
      }
    }),

  closePending: (id) =>
    set((state) => ({
      pending: state.pending.filter((tab) => tab.id !== id),
      tabOrder: state.tabOrder.filter((key) => key !== `session:${id}`),
      ...(state.activeId === id ? { activeId: state.sessions.at(-1)?.id ?? null } : {}),
    })),

  openHistory: () => set((state) => ({
    activeId: null,
    activeHistory: "overview",
    historyOpen: true,
    releaseNotesActive: false,
    tabOrder: state.tabOrder.includes("history") ? state.tabOrder : [...state.tabOrder, "history"],
  })),

  closeHistory: () => set((state) => ({
    historyOpen: false,
    tabOrder: state.tabOrder.filter((key) => key !== "history"),
    ...(state.activeHistory === "overview" ? {
      activeHistory: null,
      activeId: state.sessions.at(-1)?.id ?? null,
    } : {}),
  })),

  openHistoryRun: (runId) =>
    set((state) => ({
      activeId: null,
      activeHistory: runId,
      releaseNotesActive: false,
      historyTabs: state.historyTabs.includes(runId) ? state.historyTabs : [...state.historyTabs, runId],
      tabOrder: state.tabOrder.includes(`history:${runId}`) ? state.tabOrder : [...state.tabOrder, `history:${runId}`],
    })),

  closeHistoryRun: (runId) =>
    set((state) => ({
      historyTabs: state.historyTabs.filter((id) => id !== runId),
      tabOrder: state.tabOrder.filter((key) => key !== `history:${runId}`),
      ...(state.activeHistory === runId ? {
        activeHistory: state.historyOpen ? "overview" as const : null,
        activeId: state.historyOpen ? null : (state.sessions.at(-1)?.id ?? null),
      } : {}),
    })),

  openReleaseNotes: () => set((state) => ({
    activeId: null,
    activeHistory: null,
    releaseNotesOpen: true,
    releaseNotesActive: true,
    tabOrder: state.tabOrder.includes("release-notes") ? state.tabOrder : [...state.tabOrder, "release-notes"],
  })),

  closeReleaseNotes: () => set((state) => ({
    releaseNotesOpen: false,
    releaseNotesActive: false,
    tabOrder: state.tabOrder.filter((key) => key !== "release-notes"),
    activeId: state.releaseNotesActive ? (state.sessions.at(-1)?.id ?? null) : state.activeId,
  })),

  reorderTab: (source, target) => set((state) => {
    if (source === target || !state.tabOrder.includes(source) || !state.tabOrder.includes(target)) return state
    const tabOrder = state.tabOrder.filter((key) => key !== source)
    tabOrder.splice(tabOrder.indexOf(target), 0, source)
    return { tabOrder }
  }),

  beginHistoryReplay: (runId) =>
    set((state) => ({
      historyReplays: {
        ...state.historyReplays,
        [runId]: { loading: true, events: [], truncated: false },
      },
    })),

  setHistoryReplay: (runId, events, truncated) =>
    set((state) => ({
      historyReplays: {
        ...state.historyReplays,
        [runId]: { loading: false, events, truncated },
      },
    })),

  openInspector: (inspectingId) => set({ inspectingId }),

  toggleInspector: (id) => set((state) => ({ inspectingId: state.inspectingId === id ? null : id })),

  closeInspector: () => set({ inspectingId: null }),

  toggleCollapsed: (project) =>
    set((state) => ({ collapsed: { ...state.collapsed, [project]: !state.collapsed[project] } })),

  noteTerminal: (id) =>
    set((state) =>
      state.terminalIds.includes(id) ? state : { terminalIds: [...state.terminalIds, id] },
    ),

  dropTerminal: (id) =>
    set((state) => ({ terminalIds: state.terminalIds.filter((t) => t !== id) })),

  setError: (lastError) => set({ lastError }),

  showNotice: (notice) => {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    set({ notice })
    noticeTimer = setTimeout(() => {
      noticeTimer = null
      set({ notice: null })
    }, 1800)
  },

  openEditor: (project) => {
    if (project !== undefined) {
      set({ editorOpen: true, editingProject: project, newProjectPath: "" })
      return
    }

    const choose = window.hangarDesktop?.chooseDirectory
    if (!choose) {
      set({ editorOpen: true, editingProject: null, newProjectPath: "" })
      return
    }

    void choose("Choose a project folder").then((path) => {
      if (path !== null) set({ editorOpen: true, editingProject: null, newProjectPath: path })
    })
  },

  closeEditor: () => set({ editorOpen: false, editingProject: null, newProjectPath: "" }),

  openSettings: () => set({ settingsOpen: true }),

  closeSettings: () => set({ settingsOpen: false }),

  // Purely additive: the palette floats over whatever tab is open, so it must
  // not touch activeId / activeHistory on the way in or out.
  openPalette: () => set({ paletteOpen: true }),

  closePalette: () => set({ paletteOpen: false }),

  requestConfirm: (confirming) => set({ confirming }),

  closeConfirm: () => set({ confirming: null }),
}))

/** `?port=` wins, followed by the Vite dev port and the packaged default. */
function readPort(): number {
  const queryPort = new URLSearchParams(window.location.search).get("port")
  const raw = queryPort ?? import.meta.env.VITE_HANGAR_PORT
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}
