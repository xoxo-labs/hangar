import type { SessionInfo } from "@hangar/contracts"
import { send } from "./ws"

export function start(project: string, process?: string): void {
  send({ type: "start", project, ...(process === undefined ? {} : { process }) })
}

export function stop(project: string, process?: string): void {
  send({ type: "stop", project, ...(process === undefined ? {} : { process }) })
}

/** Closing a tab stops a live session and drops an already-dead one. */
export function close(session: SessionInfo): void {
  if (session.status === "running") stop(session.project, session.process)
  else send({ type: "dismiss", id: session.id })
}
