/** Shared types for the hangar registry and the client<->server WebSocket protocol. */

export type ProjectProcess = {
  /** Short label shown in prefixes and used to target a single process, e.g. "web" */
  name: string
  /** Shell command run in the process's cwd, e.g. "pnpm dev" */
  cmd: string
  /** Working directory relative to the project path; defaults to the project root */
  cwd?: string
}

export type Project = {
  name: string
  /** Absolute path; "~" is expanded on use */
  path: string
  processes: ProjectProcess[]
  /** Extra environment variables applied to every process of this project */
  env?: Record<string, string>
}

export type Registry = {
  version: 1
  projects: Project[]
}

/** The hangar server listens on this port unless HANGAR_PORT overrides it. */
export const DEFAULT_PORT = 4780

/** Session id is `${projectName}/${processName}`. */
export type SessionId = string

export type SessionStatus = "running" | "exited"

export type SessionInfo = {
  id: SessionId
  project: string
  process: string
  status: SessionStatus
  pid?: number
  exitCode?: number | null
  /** The command the session is running */
  cmd: string
}

/** Messages the UI sends to the server. */
export type ClientMsg =
  | { type: "start"; project: string; process?: string }
  | { type: "stop"; project: string; process?: string }
  | { type: "write"; id: SessionId; data: string }
  | { type: "resize"; id: SessionId; cols: number; rows: number }
  /** Stop then start again all (or one) of a project's processes. Not-running targets just start. */
  | { type: "restart"; project: string; process?: string }
  /** Remove an exited session (clears its buffer and drops it from state). */
  | { type: "dismiss"; id: SessionId }
  /** Create a project, or replace the one with the same name. */
  | { type: "upsertProject"; project: Project }
  /** Remove a project from the registry. Refused while it has running sessions. */
  | { type: "removeProject"; project: string }

/** Messages the server broadcasts to every connected UI. */
export type ServerMsg =
  /** Full picture: registry projects + all sessions. Sent on connect and after any change. */
  | { type: "state"; projects: Project[]; sessions: SessionInfo[] }
  /** Full scrollback of one session. Sent to a client right after connect, before live output. */
  | { type: "snapshot"; id: SessionId; data: string }
  | { type: "output"; id: SessionId; data: string }
  | { type: "exit"; id: SessionId; exitCode: number | null }
  | { type: "error"; message: string }

export function sessionId(project: string, process: string): SessionId {
  return `${project}/${process}`
}
