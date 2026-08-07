import type { Project, SessionInfo } from "@hangar/contracts"
import { send } from "./ws"

export function start(project: string, process?: string): void {
  send({ type: "start", project, ...(process === undefined ? {} : { process }) })
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
