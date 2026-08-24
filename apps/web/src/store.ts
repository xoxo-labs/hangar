import { connIdOf, type ConnectionConfig, type ConnectionStatus, LOCAL_CONN_ID } from "@hangar/client-core"
import {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  sessionId,
  type AppSettings,
  type AuthSessionInfo,
  type HistoryOutputEvent,
  type PortShare,
  type Project,
  type SessionHistoryEntry,
  type SessionId,
  type SessionInfo,
  type SessionMetrics,
  type SessionMetricSample,
  type TailscaleState,
} from "@hangar/contracts"
import { create } from "zustand"
import { disposeTerminal } from "./terminals"

export type { ConnectionStatus }

/** One machine's slice of the world, plus how the socket to it is doing. */
export type ConnectionState = {
  config: ConnectionConfig
  status: ConnectionStatus
  /** Why the connection is blocked or failing; null while it is healthy. */
  error: string | null
  serverName: string | null
  settings: AppSettings
  authSessions: AuthSessionInfo[]
  /** Ports this machine is publishing through Tailscale, with `session` already scoped. */
  shares: PortShare[]
  /** Whether this machine can share a port; null until the server says. */
  tailscale: TailscaleState | null
  /** A `state` has landed at least once, so the next one is a reconnect snapshot. */
  hasState: boolean
  /** Set while a reconnect snapshot is pending: its new sessions must not grab focus. */
  suppressFocus: boolean
}

/**
 * The connection an id belongs to. A scoped id whose machine was just removed
 * falls back to the local connection, which the store always holds.
 */
export function connectionOf(connections: Record<string, ConnectionState>, connId: string): ConnectionState {
  return connections[connId] ?? connections[LOCAL_CONN_ID] ?? FALLBACK_CONNECTION
}

/** What the UI calls a machine: the local one is always "This Mac". */
export function machineLabel(connection: ConnectionState): string {
  if (connection.config.id === LOCAL_CONN_ID) return "This Mac"
  return connection.config.label.trim() || connection.serverName || connection.config.host
}

/** The state of a connection nothing has been received from yet. */
function freshConnection(config: ConnectionConfig): ConnectionState {
  return {
    config,
    status: "connecting",
    error: null,
    serverName: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    authSessions: [],
    shares: [],
    tailscale: null,
    hasState: false,
    suppressFocus: false,
  }
}

export type HistoryReplay = {
  loading: boolean
  events: HistoryOutputEvent[]
  truncated: boolean
}

/** Resource timeline of an archived run, loaded on demand like its replay. */
export type HistoryMetrics = {
  loading: boolean
  samples: SessionMetricSample[]
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
export type ConfirmRequest =
  | {
      /** "stop-close" also closes the session's tab once the exit lands. */
      action: "stop" | "restart" | "stop-close"
      project: string
      /** Undefined targets every process of the project. */
      process?: string
    }
  | {
      /**
       * Publishing a port to the open internet. It earns a confirm for a reason
       * the others do not share: every other action here is reversible and stays
       * on this machine, while this one hands an address to strangers.
       */
      action: "share-public"
      connId: string
      port: number
      session: SessionId
    }

/**
 * The scoped id a pending confirm hangs off, so removing a machine can drop the
 * question it was about. Every variant names its target differently; what they
 * share is that the target lives on exactly one connection.
 */
function confirmScope(request: ConfirmRequest): string {
  return request.action === "share-public" ? request.session : request.project
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
  /** Resource timelines loaded lazily for historical tabs. */
  historyMetrics: Record<string, HistoryMetrics>
  /** Sessions that already own an xterm instance (panes are rendered for these). */
  terminalIds: SessionId[]
  /** Session whose details drawer is open. */
  inspectingId: SessionId | null
  /** Projects the user collapsed in the sidebar. */
  collapsed: Record<string, boolean>
  /** Every machine the UI talks to, keyed by connection id; local is always first. */
  connections: Record<string, ConnectionState>
  /** Alias of the local connection's status — the reconnect banner reads this. */
  status: ConnectionStatus
  port: number
  /** Alias of the local connection's settings — theme, terminal and global UI. */
  settings: AppSettings
  settingsOpen: boolean
  /** Whether the keyboard-shortcuts help dialog is up. */
  helpOpen: boolean
  /** Whether the welcome tutorial is up (first run, or replayed from Settings). */
  tutorialOpen: boolean
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

  /** Merges one connection's slice; every other connection's items are left alone. */
  applyState: (
    connId: string,
    state: {
      projects: Project[]
      sessions: SessionInfo[]
      history: SessionHistoryEntry[]
      settings: AppSettings
      serverName?: string
      authSessions?: AuthSessionInfo[]
      shares?: PortShare[]
      tailscale?: TailscaleState
    },
  ) => void
  updateMetrics: (id: SessionId, runId: string, metrics: SessionMetrics) => void
  /** Adds a connection, or replaces its config while keeping what it has received. */
  upsertConnection: (config: ConnectionConfig) => void
  setConnectionStatus: (connId: string, status: ConnectionStatus, error?: string | null) => void
  /** Removes a connection and purges everything scoped to it. */
  dropConnection: (connId: string) => void
  setActive: (id: SessionId | null) => void
  /** Opens (and focuses) the tab of a process that has not been started. */
  openPending: (project: string, process: string) => void
  closePending: (id: SessionId) => void
  openHistory: () => void
  closeHistory: () => void
  openHistoryRun: (runId: string) => void
  closeHistoryRun: (runId: string) => void
  /** Optimistically forgets a deleted run — entry, tab and replay — ahead of the server's broadcast. */
  removeHistoryEntry: (runId: string) => void
  openReleaseNotes: () => void
  closeReleaseNotes: () => void
  reorderTab: (source: string, target: string) => void
  beginHistoryReplay: (runId: string) => void
  setHistoryReplay: (runId: string, events: HistoryOutputEvent[], truncated: boolean) => void
  beginHistoryMetrics: (runId: string) => void
  setHistoryMetrics: (runId: string, samples: SessionMetricSample[]) => void
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
  openHelp: () => void
  closeHelp: () => void
  openTutorial: () => void
  closeTutorial: () => void
  openPalette: () => void
  closePalette: () => void
  requestConfirm: (request: ConfirmRequest) => void
  closeConfirm: () => void
}

export const useStore = create<Store>((set, get) => ({
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
  historyMetrics: {},
  terminalIds: [],
  inspectingId: null,
  collapsed: {},
  connections: {
    [LOCAL_CONN_ID]: freshConnection({
      id: LOCAL_CONN_ID,
      label: "This Mac",
      host: "127.0.0.1",
      port: readPort(),
      secure: false,
    }),
  },
  status: "connecting",
  port: readPort(),
  settings: structuredClone(DEFAULT_SETTINGS),
  settingsOpen: false,
  helpOpen: false,
  tutorialOpen: false,
  paletteOpen: false,
  lastError: null,
  notice: null,
  editorOpen: false,
  editingProject: null,
  newProjectPath: "",
  confirming: null,

  applyState: (connId, incoming) =>
    set((state) => {
      const { projects, sessions, history, settings } = incoming
      const mine = (value: string): boolean => connIdOf(value) === connId
      const connection = state.connections[connId] ?? freshConnection(unknownConfig(connId))

      // Projects stay grouped by machine, in connection order.
      const byConn = new Map<string, Project[]>([[connId, projects]])
      for (const project of state.projects) {
        const owner = connIdOf(project.name)
        if (owner === connId) continue
        const known = byConn.get(owner)
        if (known) known.push(project)
        else byConn.set(owner, [project])
      }
      const connOrder = Object.keys(state.connections)
      const nextProjects = (connOrder.includes(connId) ? connOrder : [...connOrder, connId]).flatMap(
        (id) => byConn.get(id) ?? [],
      )

      const next = new Map(sessions.map((s) => [s.id, s]))
      const ordered: SessionInfo[] = []
      // Preserve the order of sessions we already knew about…
      for (const known of state.sessions) {
        if (!mine(known.id)) {
          ordered.push(known)
          continue
        }
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
          !mine(tab.id) ||
          (!live.has(tab.id) &&
            projects.some(
              (project) => project.name === tab.project && project.processes.some((p) => p.name === tab.process),
            )),
      )

      // A session that just started grabs focus; on this connection's very first
      // state (the page just loaded into a server with running sessions) take the
      // first. A reconnect snapshot never steals focus.
      const knownBefore = state.sessions.filter((session) => mine(session.id))
      const focus = connection.suppressFocus ? undefined : knownBefore.length === 0 ? added[0] : added.at(-1)
      const stillOpen =
        state.activeId !== null &&
        (ordered.some((s) => s.id === state.activeId) || pending.some((tab) => tab.id === state.activeId))
      const activeId = focus?.id ?? (stillOpen ? state.activeId : (ordered.at(-1)?.id ?? null))

      const previousById = new Map(state.sessions.map((session) => [session.id, session]))
      const orderedById = new Map(ordered.map((session) => [session.id, session]))
      const metricHistory = Object.fromEntries(
        Object.entries(state.metricHistory).filter(([id]) => {
          if (!mine(id)) return true
          const previous = previousById.get(id)
          const fresh = orderedById.get(id)
          // A restart keeps the same session id and terminal scrollback, but its
          // resource timeline belongs to the new run and must begin at zero.
          return previous !== undefined && fresh !== undefined && previous.runId === fresh.runId
        }),
      )
      // Newest first across machines, matching the order each server sends.
      const nextHistory = [...state.history.filter((entry) => !mine(entry.runId)), ...history].sort(
        (a, b) => b.startedAt - a.startedAt,
      )
      const validRuns = new Set(history.map((entry) => entry.runId))
      const staleRun = (runId: string): boolean => mine(runId) && !validRuns.has(runId)
      const historyTabs = state.historyTabs.filter((runId) => !staleRun(runId))
      const historyReplays = Object.fromEntries(
        Object.entries(state.historyReplays).filter(([runId]) => !staleRun(runId)),
      )
      const historyMetrics = Object.fromEntries(
        Object.entries(state.historyMetrics).filter(([runId]) => !staleRun(runId)),
      )
      const activeHistory = focus
        ? null
        : state.activeHistory !== null && state.activeHistory !== "overview" && staleRun(state.activeHistory)
          ? state.historyOpen
            ? "overview"
            : null
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
      return {
        projects: nextProjects,
        sessions: ordered,
        pending,
        history: nextHistory,
        historyTabs,
        historyReplays,
        historyMetrics,
        metricHistory,
        activeId: nextActiveId,
        activeHistory,
        releaseNotesActive,
        tabOrder,
        connections: {
          ...state.connections,
          [connId]: {
            ...connection,
            settings,
            serverName: incoming.serverName ?? connection.serverName,
            authSessions: incoming.authSessions ?? [],
            shares: incoming.shares ?? [],
            // An older server sends nothing here; keeping the last answer would
            // claim a sharing capability this machine never reported.
            tailscale: incoming.tailscale ?? null,
            hasState: true,
            suppressFocus: false,
          },
        },
        // The top-level aliases follow the local machine only.
        ...(connId === LOCAL_CONN_ID ? { settings } : {}),
      }
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
        sessions: state.sessions.map((session) => (session.id === id ? { ...session, metrics } : session)),
        // Keep up to six hours at the server's two-second sampling interval.
        // Shift-then-append instead of append-then-slice: at the cap the latter
        // copies the 10 800-point array twice per tick, per session.
        metricHistory: {
          ...state.metricHistory,
          [id]: previous.length >= 10_800 ? [...previous.slice(1), point] : [...previous, point],
        },
      }
    }),

  upsertConnection: (config) =>
    set((state) => {
      const existing = state.connections[config.id]
      return {
        connections: {
          ...state.connections,
          [config.id]: existing ? { ...existing, config } : freshConnection(config),
        },
      }
    }),

  setConnectionStatus: (connId, status, error = null) =>
    set((state) => {
      const connection = state.connections[connId]
      if (!connection) return state
      return {
        connections: {
          ...state.connections,
          [connId]: {
            ...connection,
            status,
            error,
            // Leaving "connected" arms the focus guard: whatever state arrives
            // next is a reconnect snapshot, not live news.
            suppressFocus: status === "connected" ? connection.suppressFocus : connection.hasState,
          },
        },
        ...(connId === LOCAL_CONN_ID ? { status } : {}),
        ...(connId === LOCAL_CONN_ID && status === "connected" ? { lastError: null } : {}),
      }
    }),

  dropConnection: (connId) => {
    if (connId === LOCAL_CONN_ID) return
    const mine = (value: string): boolean => connIdOf(value) === connId
    // Terminals are disposed first: each disposal writes `terminalIds` itself.
    for (const id of get().terminalIds.filter(mine)) disposeTerminal(id)
    // A session on a removed machine will never report its exit here.
    for (const id of [...closeOnExit].filter(mine)) closeOnExit.delete(id)
    set((state) => {
      const sessions = state.sessions.filter((session) => !mine(session.id))
      const pending = state.pending.filter((tab) => !mine(tab.id))
      const historyTabs = state.historyTabs.filter((runId) => !mine(runId))
      const { [connId]: _dropped, ...connections } = state.connections
      const dropsActiveHistory =
        state.activeHistory !== null && state.activeHistory !== "overview" && mine(state.activeHistory)
      return {
        connections,
        projects: state.projects.filter((project) => !mine(project.name)),
        sessions,
        pending,
        history: state.history.filter((entry) => !mine(entry.runId)),
        historyTabs,
        historyReplays: Object.fromEntries(Object.entries(state.historyReplays).filter(([runId]) => !mine(runId))),
        historyMetrics: Object.fromEntries(Object.entries(state.historyMetrics).filter(([runId]) => !mine(runId))),
        metricHistory: Object.fromEntries(Object.entries(state.metricHistory).filter(([id]) => !mine(id))),
        terminalIds: state.terminalIds.filter((id) => !mine(id)),
        collapsed: Object.fromEntries(Object.entries(state.collapsed).filter(([project]) => !mine(project))),
        tabOrder: state.tabOrder.filter((key) => {
          const at = key.indexOf(":")
          return at === -1 || !mine(key.slice(at + 1))
        }),
        activeId: state.activeId !== null && mine(state.activeId) ? (sessions.at(-1)?.id ?? null) : state.activeId,
        activeHistory: dropsActiveHistory ? (state.historyOpen ? "overview" : null) : state.activeHistory,
        inspectingId: state.inspectingId !== null && mine(state.inspectingId) ? null : state.inspectingId,
        confirming: state.confirming !== null && mine(confirmScope(state.confirming)) ? null : state.confirming,
      }
    })
  },

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

  openHistory: () =>
    set((state) => ({
      activeId: null,
      activeHistory: "overview",
      historyOpen: true,
      releaseNotesActive: false,
      tabOrder: state.tabOrder.includes("history") ? state.tabOrder : [...state.tabOrder, "history"],
    })),

  closeHistory: () =>
    set((state) => ({
      historyOpen: false,
      tabOrder: state.tabOrder.filter((key) => key !== "history"),
      ...(state.activeHistory === "overview"
        ? {
            activeHistory: null,
            activeId: state.sessions.at(-1)?.id ?? null,
          }
        : {}),
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
      // The replay cache dies with the tab: a single replay can be 10 MB, and
      // reopening the run just re-requests it. The timeline follows suit.
      historyReplays: Object.fromEntries(Object.entries(state.historyReplays).filter(([id]) => id !== runId)),
      historyMetrics: Object.fromEntries(Object.entries(state.historyMetrics).filter(([id]) => id !== runId)),
      ...(state.activeHistory === runId
        ? {
            activeHistory: state.historyOpen ? ("overview" as const) : null,
            activeId: state.historyOpen ? null : (state.sessions.at(-1)?.id ?? null),
          }
        : {}),
    })),

  removeHistoryEntry: (runId) =>
    set((state) => ({
      history: state.history.filter((entry) => entry.runId !== runId),
      historyTabs: state.historyTabs.filter((id) => id !== runId),
      tabOrder: state.tabOrder.filter((key) => key !== `history:${runId}`),
      historyReplays: Object.fromEntries(Object.entries(state.historyReplays).filter(([id]) => id !== runId)),
      historyMetrics: Object.fromEntries(Object.entries(state.historyMetrics).filter(([id]) => id !== runId)),
      ...(state.activeHistory === runId
        ? {
            activeHistory: state.historyOpen ? ("overview" as const) : null,
            activeId: state.historyOpen ? null : (state.sessions.at(-1)?.id ?? null),
          }
        : {}),
    })),

  openReleaseNotes: () => {
    if (window.hangarDesktop) {
      void window.hangarDesktop.openReleaseNotes()
      return
    }
    set((state) => ({
      activeId: null,
      activeHistory: null,
      releaseNotesOpen: true,
      releaseNotesActive: true,
      tabOrder: state.tabOrder.includes("release-notes") ? state.tabOrder : [...state.tabOrder, "release-notes"],
    }))
  },

  closeReleaseNotes: () =>
    set((state) => ({
      releaseNotesOpen: false,
      releaseNotesActive: false,
      tabOrder: state.tabOrder.filter((key) => key !== "release-notes"),
      activeId: state.releaseNotesActive ? (state.sessions.at(-1)?.id ?? null) : state.activeId,
    })),

  reorderTab: (source, target) =>
    set((state) => {
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

  beginHistoryMetrics: (runId) =>
    set((state) => ({
      historyMetrics: {
        ...state.historyMetrics,
        [runId]: { loading: true, samples: [] },
      },
    })),

  setHistoryMetrics: (runId, samples) =>
    set((state) => ({
      historyMetrics: {
        ...state.historyMetrics,
        [runId]: { loading: false, samples },
      },
    })),

  openInspector: (inspectingId) => set({ inspectingId }),

  toggleInspector: (id) => set((state) => ({ inspectingId: state.inspectingId === id ? null : id })),

  closeInspector: () => set({ inspectingId: null }),

  toggleCollapsed: (project) =>
    set((state) => ({ collapsed: { ...state.collapsed, [project]: !state.collapsed[project] } })),

  noteTerminal: (id) =>
    set((state) => (state.terminalIds.includes(id) ? state : { terminalIds: [...state.terminalIds, id] })),

  dropTerminal: (id) => set((state) => ({ terminalIds: state.terminalIds.filter((t) => t !== id) })),

  setError: (lastError) => set({ lastError }),

  showNotice: (notice) => {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    set({ notice })
    noticeTimer = setTimeout(() => {
      noticeTimer = null
      set({ notice: null })
    }, 1800)
  },

  // Open first; folder selection lives in the dialog so cancelling the native
  // picker does not make the whole add flow disappear without feedback.
  openEditor: (project) => set({ editorOpen: true, editingProject: project ?? null, newProjectPath: "" }),

  closeEditor: () => set({ editorOpen: false, editingProject: null, newProjectPath: "" }),

  openSettings: () => set({ settingsOpen: true }),

  closeSettings: () => set({ settingsOpen: false }),

  openHelp: () => {
    if (window.hangarDesktop) {
      void window.hangarDesktop.openShortcuts()
      return
    }
    set({ helpOpen: true })
  },

  closeHelp: () => set({ helpOpen: false }),

  openTutorial: () => set({ tutorialOpen: true }),

  closeTutorial: () => set({ tutorialOpen: false }),

  // Purely additive: the palette floats over whatever tab is open, so it must
  // not touch activeId / activeHistory on the way in or out.
  openPalette: () => set({ paletteOpen: true }),

  closePalette: () => set({ paletteOpen: false }),

  requestConfirm: (confirming) => set({ confirming }),

  closeConfirm: () => set({ confirming: null }),
}))

/** Placeholder for a connection that sent state before its config was registered. */
function unknownConfig(connId: string): ConnectionConfig {
  return { id: connId, label: connId, host: "", port: 0, secure: false }
}

/** Stable stand-in so `connectionOf` never manufactures a fresh object per render. */
const FALLBACK_CONNECTION = freshConnection(unknownConfig(LOCAL_CONN_ID))

/** `?port=` wins, followed by the Vite dev port and the packaged default. */
function readPort(): number {
  const queryPort = new URLSearchParams(window.location.search).get("port")
  const raw = queryPort ?? import.meta.env.VITE_HANGAR_PORT
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}
