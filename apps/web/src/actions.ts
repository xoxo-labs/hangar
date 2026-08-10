import type { AppSettings, Project, SessionInfo } from "@hangar/contracts"
import { useStore } from "./store"
import { send } from "./ws"

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

export function reorderProjects(projects: string[]): void {
  send({ type: "reorderProjects", projects })
}

export function updateSettings(settings: AppSettings): void {
  send({ type: "updateSettings", settings })
}

export function loadHistoryReplay(runId: string): void {
  const existing = useStore.getState().historyReplays[runId]
  if (existing?.loading || existing?.events.length) return
  useStore.getState().beginHistoryReplay(runId)
  send({ type: "getHistoryReplay", runId })
}
