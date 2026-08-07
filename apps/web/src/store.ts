import {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Project,
  type SessionHistoryEntry,
  type SessionId,
  type SessionInfo,
  type SessionMetrics,
} from "@hangar/contracts"
import { create } from "zustand"

export type ConnectionStatus = "connecting" | "connected" | "reconnecting"

export type SessionMetricPoint = {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  outputBytesPerSecond: number
}

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
  /** Persisted run summaries, newest first. */
  history: SessionHistoryEntry[]
  /** Recent live samples, kept in memory for session sparklines. */
  metricHistory: Record<SessionId, SessionMetricPoint[]>
  /** Live session whose terminal is visible. Null while browsing history. */
  activeId: SessionId | null
  /** History overview or archived run currently visible. */
  activeHistory: "overview" | string | null
  /** Archived runs opened as tabs, in tab order. */
  historyTabs: string[]
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
  lastError: string | null
  notice: string | null
  /** Whether the add/edit project dialog is up. */
  editorOpen: boolean
  /** Project the dialog is editing; null while it is creating a new one. */
  editingProject: string | null
  /** Stop/restart waiting in the confirm dialog; null when it is closed. */
  confirming: ConfirmRequest | null

  applyState: (projects: Project[], sessions: SessionInfo[], history: SessionHistoryEntry[], settings: AppSettings) => void
  updateMetrics: (id: SessionId, runId: string, metrics: SessionMetrics) => void
  setStatus: (status: ConnectionStatus) => void
  setActive: (id: SessionId | null) => void
  openHistory: () => void
  openHistoryRun: (runId: string) => void
  closeHistoryRun: (runId: string) => void
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
  requestConfirm: (request: ConfirmRequest) => void
  closeConfirm: () => void
}

export const useStore = create<Store>((set) => ({
  projects: [],
  sessions: [],
  history: [],
  metricHistory: {},
  activeId: null,
  activeHistory: null,
  historyTabs: [],
  terminalIds: [],
  inspectingId: null,
  collapsed: {},
  status: "connecting",
  port: readPort(),
  settings: structuredClone(DEFAULT_SETTINGS),
  settingsOpen: false,
  lastError: null,
  notice: null,
  editorOpen: false,
  editingProject: null,
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

      // A session that just started grabs focus; on the very first state (the
      // page just loaded into a server with running sessions) take the first.
      const focus = state.sessions.length === 0 ? added[0] : added.at(-1)
      const stillOpen = state.activeId !== null && ordered.some((s) => s.id === state.activeId)
      const activeId =
        focus?.id ?? (stillOpen ? state.activeId : (ordered.at(-1)?.id ?? null))

      const metricHistory = Object.fromEntries(
        Object.entries(state.metricHistory).filter(([id]) => ordered.some((session) => session.id === id)),
      )
      const validRuns = new Set(history.map((entry) => entry.runId))
      const historyTabs = state.historyTabs.filter((runId) => validRuns.has(runId))
      const activeHistory = focus
        ? null
        : state.activeHistory !== null && state.activeHistory !== "overview" && !validRuns.has(state.activeHistory)
          ? "overview"
          : state.activeHistory
      const nextActiveId = activeHistory === null ? activeId : null
      return { projects, sessions: ordered, history, historyTabs, metricHistory, activeId: nextActiveId, activeHistory, settings }
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

  setActive: (activeId) => set({ activeId, activeHistory: null }),

  openHistory: () => set({ activeId: null, activeHistory: "overview" }),

  openHistoryRun: (runId) =>
    set((state) => ({
      activeId: null,
      activeHistory: runId,
      historyTabs: state.historyTabs.includes(runId) ? state.historyTabs : [...state.historyTabs, runId],
    })),

  closeHistoryRun: (runId) =>
    set((state) => ({
      historyTabs: state.historyTabs.filter((id) => id !== runId),
      ...(state.activeHistory === runId ? { activeHistory: "overview" as const } : {}),
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

  openEditor: (project) => set({ editorOpen: true, editingProject: project ?? null }),

  closeEditor: () => set({ editorOpen: false, editingProject: null }),

  openSettings: () => set({ settingsOpen: true }),

  closeSettings: () => set({ settingsOpen: false }),

  requestConfirm: (confirming) => set({ confirming }),

  closeConfirm: () => set({ confirming: null }),
}))

/** `?port=` on the page URL wins over the contract's default port. */
function readPort(): number {
  const raw = new URLSearchParams(window.location.search).get("port")
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}
