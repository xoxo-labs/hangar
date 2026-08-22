import { LOCAL_CONN_ID, parseScoped } from "@hangar/client-core"
import type { AppSettings, PairingInfo, PortShareKind, Project, SessionId, SessionInfo } from "@hangar/contracts"
import { requestPairingToken, sendTo } from "./connections/manager"
import { useStore } from "./store"
import { send } from "./ws"

/*
 * Every argument below carries a scoped `project.name` / `session.id`, exactly
 * as the store holds it; `send` parses the scope out and routes the message to
 * the machine that owns it. Only connection-wide messages (settings, pairing),
 * which carry no id at all, name their connection explicitly.
 */

export function start(project: string, process?: string): void {
  send({ type: "start", project, ...(process === undefined ? {} : { process }) })
}

/** Adds and starts a uniquely named interactive shell at the project root. */
export function openEmptyTerminal(project: Project): void {
  const names = new Set(project.processes.map((process) => process.name))
  let name = "terminal"
  for (let suffix = 2; names.has(name); suffix += 1) name = `terminal-${suffix}`

  upsertProject({
    ...project,
    processes: [...project.processes, { name, cmd: "", shell: true }],
  })
  // WebSocket messages are ordered, so the registry update is handled before
  // this start request reaches the server.
  start(project.name, name)
}

export function stop(project: string, process?: string): void {
  send({ type: "stop", project, ...(process === undefined ? {} : { process }) })
}

/** Stops running targets and starts them again on exit; idle ones just start. */
export function restart(project: string, process?: string): void {
  send({ type: "restart", project, ...(process === undefined ? {} : { process }) })
}

/** Closing a tab stops a live session and drops an already-dead one. */
export function close(session: SessionInfo): void {
  if (session.status === "running") stop(session.project, session.process)
  else send({ type: "dismiss", id: session.id })
}

/** Creates the project, or replaces the registry entry with the same name. */
export function upsertProject(project: Project): void {
  send({ type: "upsertProject", project })
}

/** The server refuses this while the project still has running sessions. */
export function removeProject(project: string): void {
  send({ type: "removeProject", project })
}

/** Names may span machines; each server is told about its own projects only. */
export function reorderProjects(projects: string[]): void {
  send({ type: "reorderProjects", projects })
}

export function updateSettings(settings: AppSettings, connId: string = LOCAL_CONN_ID): void {
  sendTo(connId, { type: "updateSettings", settings })
}

export function loadHistoryReplay(runId: string): void {
  const existing = useStore.getState().historyReplays[runId]
  if (existing?.loading || existing?.events.length) return
  useStore.getState().beginHistoryReplay(runId)
  send({ type: "getHistoryReplay", runId })
}

/** Mints a one-time pairing code on the given machine, for another Mac to redeem. */
export function createPairingToken(connId: string): Promise<PairingInfo> {
  return requestPairingToken(connId)
}

/** Revokes a paired client's session token on the given machine. */
export function revokeAuthSession(connId: string, id: string): void {
  sendTo(connId, { type: "revokeAuthSession", id })
}

/*
 * Sharing is per-machine, not per-session: Tailscale publishes a port on the
 * host that owns it. So these name their connection the way settings and
 * pairing do, rather than being routed by a scoped id.
 */

/** Publishes a detected port through Tailscale on the machine that owns it. */
export function sharePort(connId: string, port: number, kind: PortShareKind, session?: SessionId): void {
  sendTo(connId, {
    type: "sharePort",
    port,
    kind,
    // The owning server knows only its own bare ids.
    ...(session === undefined ? {} : { session: parseScoped(session).value }),
  })
}

/** Withdraws a share. Serve config Hangar did not create is left alone. */
export function unsharePort(connId: string, port: number): void {
  sendTo(connId, { type: "unsharePort", port })
}
