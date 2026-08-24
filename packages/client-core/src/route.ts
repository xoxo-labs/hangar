import type { ClientMsg, ServerMsg } from "@hangar/contracts"
// Explicit extension: this module is covered by `node --test`, which resolves
// relative specifiers the way the runtime does.
import { LOCAL_CONN_ID, parseScoped, scoped } from "./scope.ts"

/** Rewrites every server-owned id of an inbound message into its scoped form. */
export function scopeInbound(connId: string, msg: ServerMsg): ServerMsg {
  const mark = (value: string): string => scoped(connId, value)
  switch (msg.type) {
    case "state":
      return {
        ...msg,
        projects: msg.projects.map((project) => ({ ...project, name: mark(project.name) })),
        // `process` stays bare: it is a name inside a project, not an id.
        sessions: msg.sessions.map((session) => ({
          ...session,
          id: mark(session.id),
          project: mark(session.project),
          runId: mark(session.runId),
        })),
        history: msg.history.map((entry) => ({
          ...entry,
          runId: mark(entry.runId),
          id: mark(entry.id),
          project: mark(entry.project),
        })),
        // A share names the session it came from so the UI can mark that row;
        // an adopted share names none, and marking `undefined` would invent one.
        ...(msg.shares
          ? { shares: msg.shares.map((share) => (share.session ? { ...share, session: mark(share.session) } : share)) }
          : {}),
      }
    case "metrics":
      return { ...msg, id: mark(msg.id), runId: mark(msg.runId) }
    case "snapshot":
      return { ...msg, id: mark(msg.id) }
    case "output":
      return { ...msg, id: mark(msg.id) }
    case "exit":
      return { ...msg, id: mark(msg.id) }
    case "historyReplay":
    case "historyMetrics":
      return { ...msg, runId: mark(msg.runId) }
    default:
      return msg
  }
}

export type Outbound = { connId: string; msg: ClientMsg }

/**
 * Strips the scope off an outgoing message and names the connection that owns
 * it, so component call sites keep passing scoped `project.name` / `session.id`.
 */
export function routeOutbound(msg: ClientMsg): Outbound[] {
  switch (msg.type) {
    case "start":
    case "stop":
    case "restart": {
      const { connId, value } = parseScoped(msg.project)
      return [{ connId, msg: { ...msg, project: value } }]
    }
    case "removeProject": {
      const { connId, value } = parseScoped(msg.project)
      return [{ connId, msg: { ...msg, project: value } }]
    }
    case "write":
    case "resize": {
      const { connId, value } = parseScoped(msg.id)
      return [{ connId, msg: { ...msg, id: value } }]
    }
    case "dismiss": {
      const { connId, value } = parseScoped(msg.id)
      return [{ connId, msg: { ...msg, id: value } }]
    }
    case "upsertProject": {
      const { connId, value } = parseScoped(msg.project.name)
      return [{ connId, msg: { ...msg, project: { ...msg.project, name: value } } }]
    }
    case "reorderProjects": {
      // One list per machine: a server can only order the projects it owns.
      const byConn = new Map<string, string[]>()
      for (const name of msg.projects) {
        const { connId, value } = parseScoped(name)
        const known = byConn.get(connId)
        if (known) known.push(value)
        else byConn.set(connId, [value])
      }
      return [...byConn].map(([connId, projects]) => ({ connId, msg: { type: "reorderProjects", projects } }))
    }
    case "getHistoryReplay":
    case "getHistoryMetrics":
    case "deleteHistoryRun": {
      const { connId, value } = parseScoped(msg.runId)
      return [{ connId, msg: { ...msg, runId: value } }]
    }
    default:
      // Connection-wide messages (settings, pairing) carry no scoped id and are
      // normally sent through `sendTo`; unrouted, they mean the local machine.
      return [{ connId: LOCAL_CONN_ID, msg }]
  }
}
