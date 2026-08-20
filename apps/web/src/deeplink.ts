import { buildSidebarModel, flatEntries, LOCAL_CONN_ID, scoped } from "@hangar/client-core"
import { sessionId } from "@hangar/contracts"
import { type DeepLinkTarget, parseDeepLink } from "./links"
import { useStore } from "./store"

/**
 * Links from the macOS App Intents surface (Spotlight, Siri, Shortcuts), handed
 * over by the desktop shell. They only ever describe this Mac, so the bare names
 * they carry are local ids and are scoped as such before they meet the store.
 */

/**
 * How long a link that arrived before the registry did keeps waiting. Past that
 * the client has a connection problem to show, not a project to open — and a
 * link resolving minutes late would yank a tab out from under whatever the user
 * moved on to.
 */
const RESOLVE_TIMEOUT_MS = 30_000

/** Ends the wait a queued link is in. Null whenever nothing is waiting. */
let cancelWait: (() => void) | null = null

/** Subscribes to links, and claims the one that launched Hangar, if there was one. */
export function followDeepLinks(): () => void {
  const desktop = window.hangarDesktop
  if (!desktop) return () => {}
  // Deliberately not guarded on the effect still being mounted, unlike a
  // setState: this acts on the store, and StrictMode's second mount would
  // otherwise drop the launch link between the two takes.
  void desktop.takeDeepLink().then((url) => {
    if (url !== null) follow(url)
  })
  return desktop.onDeepLink(follow)
}

function follow(url: string): void {
  const target = parseDeepLink(url)
  if (target === null) return
  cancelWait?.()
  if (select(target)) return
  // A link that launched Hangar lands before the socket does, so an unknown name
  // is usually just a registry that has not arrived yet.
  if (useStore.getState().connections[LOCAL_CONN_ID]?.hasState === true) reportMissing(target)
  else waitForRegistry(target)
}

/** Holds the link until this Mac's first `state` says whether the project exists. */
function waitForRegistry(target: DeepLinkTarget): void {
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.projects === previous.projects) return
    if (select(target)) {
      stop()
    } else if (state.connections[LOCAL_CONN_ID]?.hasState === true) {
      stop()
      reportMissing(target)
    }
  })
  const timer = setTimeout(stop, RESOLVE_TIMEOUT_MS)

  function stop(): void {
    clearTimeout(timer)
    unsubscribe()
    if (cancelWait === stop) cancelWait = null
  }

  cancelWait = stop
}

/** The sidebar row a project appears in, which is what collapse state is keyed by. */
function collapseKey(name: string): string {
  const state = useStore.getState()
  const entries = flatEntries(buildSidebarModel(Object.keys(state.connections), state.projects, ""))
  const entry = entries.find((item) => item.parts.some((part) => part.project.name === name))
  return entry?.key ?? name
}

/**
 * Selects the target the way clicking it in the sidebar would, and starts
 * nothing on the way — parity with the in-app rule that only ▶ starts a process.
 * False means the project is not in the registry (yet).
 */
function select(target: DeepLinkTarget): boolean {
  const state = useStore.getState()
  const name = scoped(LOCAL_CONN_ID, target.project)
  const project = state.projects.find((item) => item.name === name)
  if (project === undefined) return false

  // Collapse state is keyed by the sidebar entry, not by the project: once two
  // machines are paired, one repo on both merges into a single row keyed by its
  // anchor, which may be the remote copy. Toggling the project's own name there
  // would flip a key nothing renders and leave the row shut.
  const key = collapseKey(name)
  if (state.collapsed[key] === true) state.toggleCollapsed(key)

  const named = target.kind === "process" ? project.processes.find((item) => item.name === target.process) : undefined
  const running = (process: string): boolean =>
    state.sessions.some((session) => session.id === sessionId(name, process) && session.status === "running")
  // A project link names no process, and neither does a process link whose
  // process was renamed away: land on what is running, else on the first row —
  // where opening the project in the sidebar lands too.
  const process =
    named?.name ?? project.processes.find((item) => running(item.name))?.name ?? project.processes[0]?.name
  // A project with no processes at all: revealing it is the whole of the answer.
  if (process === undefined) return true

  const id = sessionId(name, process)
  if (state.sessions.some((session) => session.id === id)) state.setActive(id)
  else state.openPending(name, process)
  return true
}

/** The registry has spoken and this project is not in it: renamed, or removed. */
function reportMissing(target: DeepLinkTarget): void {
  useStore.getState().setError(`Hangar has no project named "${target.project}"`)
}
