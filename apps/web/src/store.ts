import { DEFAULT_PORT, type Project, type SessionId, type SessionInfo } from "@hangar/contracts"
import { create } from "zustand"

export type ConnectionStatus = "connecting" | "connected" | "reconnecting"

/** A destructive action waiting for the user's OK in the confirm dialog. */
export type ConfirmRequest = {
  action: "stop" | "restart"
  project: string
  /** Undefined targets every process of the project. */
  process?: string
}

type Store = {
  /** Registry projects, as last broadcast by the server. */
  projects: Project[]
  /** Live sessions, kept in a stable tab order (existing first, new appended). */
  sessions: SessionInfo[]
  /** Session whose terminal is visible, or null when nothing is open. */
  activeId: SessionId | null
  /** Sessions that already own an xterm instance (panes are rendered for these). */
  terminalIds: SessionId[]
  /** Projects the user collapsed in the sidebar. */
  collapsed: Record<string, boolean>
  status: ConnectionStatus
  port: number
  lastError: string | null
  /** Whether the add/edit project dialog is up. */
  editorOpen: boolean
  /** Project the dialog is editing; null while it is creating a new one. */
  editingProject: string | null
  /** Stop/restart waiting in the confirm dialog; null when it is closed. */
  confirming: ConfirmRequest | null

  applyState: (projects: Project[], sessions: SessionInfo[]) => void
  setStatus: (status: ConnectionStatus) => void
  setActive: (id: SessionId | null) => void
  toggleCollapsed: (project: string) => void
  noteTerminal: (id: SessionId) => void
  dropTerminal: (id: SessionId) => void
  setError: (message: string | null) => void
  /** Opens the dialog: with a name to edit that project, without one to create. */
  openEditor: (project?: string) => void
  closeEditor: () => void
  requestConfirm: (request: ConfirmRequest) => void
  closeConfirm: () => void
}

export const useStore = create<Store>((set) => ({
  projects: [],
  sessions: [],
  activeId: null,
  terminalIds: [],
  collapsed: {},
  status: "connecting",
  port: readPort(),
  lastError: null,
  editorOpen: false,
  editingProject: null,
  confirming: null,

  applyState: (projects, sessions) =>
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

      return { projects, sessions: ordered, activeId }
    }),

  setStatus: (status) => set({ status }),

  setActive: (activeId) => set({ activeId }),

  toggleCollapsed: (project) =>
    set((state) => ({ collapsed: { ...state.collapsed, [project]: !state.collapsed[project] } })),

  noteTerminal: (id) =>
    set((state) =>
      state.terminalIds.includes(id) ? state : { terminalIds: [...state.terminalIds, id] },
    ),

  dropTerminal: (id) =>
    set((state) => ({ terminalIds: state.terminalIds.filter((t) => t !== id) })),

  setError: (lastError) => set({ lastError }),

  openEditor: (project) => set({ editorOpen: true, editingProject: project ?? null }),

  closeEditor: () => set({ editorOpen: false, editingProject: null }),

  requestConfirm: (confirming) => set({ confirming }),

  closeConfirm: () => set({ confirming: null }),
}))

/** `?port=` on the page URL wins over the contract's default port. */
function readPort(): number {
  const raw = new URLSearchParams(window.location.search).get("port")
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT
}
