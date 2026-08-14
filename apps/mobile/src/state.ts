/**
 * The world the phone renders, and the pure reducers that move it. Everything
 * here is keyed by *scoped* ids (`connId::value`), because messages are scoped
 * at the socket seam by `scopeInbound` before they ever reach this file.
 */

import { connIdOf, parseScoped, scoped } from "@hangar/client-core"
import type { Project, SessionId, SessionInfo, SessionMetrics } from "@hangar/contracts"
// Explicit extension: this module is covered by `node --test`, which resolves
// relative specifiers the way the runtime does.
import { appendBuffer, trimBuffer } from "./buffer.ts"

export type MetricPoint = {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
}

/** Metric history a phone keeps: enough for "what has this been doing", no more. */
export const METRIC_WINDOW_MS = 30 * 60_000

export type World = {
  projects: Project[]
  sessions: SessionInfo[]
  /** Raw (still ANSI-carrying) scrollback per session. */
  output: Record<SessionId, string>
  metrics: Record<SessionId, MetricPoint[]>
}

export const EMPTY_WORLD: World = { projects: [], sessions: [], output: {}, metrics: {} }

export type StateMessage = {
  projects: Project[]
  sessions: SessionInfo[]
}

/**
 * Merges one machine's slice: its own items are replaced wholesale, every other
 * machine's are untouched, and known sessions keep their position so the list
 * does not reshuffle on a reconnect snapshot.
 */
export function applyState(world: World, connId: string, incoming: StateMessage): World {
  const mine = (value: string): boolean => connIdOf(value) === connId

  const projects = [...world.projects.filter((project) => !mine(project.name)), ...incoming.projects]

  const fresh = new Map(incoming.sessions.map((session) => [session.id, session]))
  const sessions: SessionInfo[] = []
  for (const known of world.sessions) {
    if (!mine(known.id)) {
      sessions.push(known)
      continue
    }
    const next = fresh.get(known.id)
    if (next) {
      sessions.push(next)
      fresh.delete(known.id)
    }
  }
  sessions.push(...fresh.values())

  // Buffers of sessions this machine no longer has are gone for good.
  const live = new Set(incoming.sessions.map((session) => session.id))
  const keep = (id: string): boolean => !mine(id) || live.has(id)
  return {
    projects,
    sessions,
    output: pick(world.output, keep),
    metrics: pick(world.metrics, keep),
  }
}

export function applyMetrics(world: World, id: SessionId, metrics: SessionMetrics, now: number): World {
  const point: MetricPoint = {
    sampledAt: metrics.sampledAt,
    cpuPercent: metrics.cpuPercent,
    memoryBytes: metrics.memoryBytes,
  }
  const previous = world.metrics[id] ?? []
  const history = [...previous, point].filter((sample) => now - sample.sampledAt <= METRIC_WINDOW_MS)
  return {
    ...world,
    sessions: world.sessions.map((session) => (session.id === id ? { ...session, metrics } : session)),
    metrics: { ...world.metrics, [id]: history },
  }
}

/** A snapshot is the whole scrollback the server holds: it replaces the buffer. */
export function applySnapshot(world: World, id: SessionId, data: string): World {
  return { ...world, output: { ...world.output, [id]: trimBuffer(data) } }
}

export function applyOutput(world: World, id: SessionId, data: string): World {
  return { ...world, output: { ...world.output, [id]: appendBuffer(world.output[id], data) } }
}

export function applyExit(world: World, id: SessionId, exitCode: number | null): World {
  return {
    ...world,
    sessions: world.sessions.map((session) =>
      session.id === id ? { ...session, status: "exited", exitCode, endedAt: Date.now() } : session,
    ),
  }
}

/** Removing a machine takes everything scoped to it with it. */
export function dropScope(world: World, connId: string): World {
  const other = (value: string): boolean => connIdOf(value) !== connId
  return {
    projects: world.projects.filter((project) => other(project.name)),
    sessions: world.sessions.filter((session) => other(session.id)),
    output: pick(world.output, other),
    metrics: pick(world.metrics, other),
  }
}

/** The scoped session id a process would run under, whether or not it exists yet. */
export function sessionIdFor(scopedProject: string, process: string): SessionId {
  const { connId, value } = parseScoped(scopedProject)
  return scoped(connId, `${value}/${process}`)
}

/**
 * The scoped project and the bare process name a session id is made of — what
 * the actions need to address a process, and what the UI calls it.
 */
export function splitSessionId(id: SessionId): { project: string; process: string } {
  const { connId, value } = parseScoped(id)
  const slash = value.indexOf("/")
  return {
    project: scoped(connId, slash === -1 ? value : value.slice(0, slash)),
    process: slash === -1 ? value : value.slice(slash + 1),
  }
}

/**
 * Whether an id still names something. A process that has never run has no
 * session and is still perfectly selectable — its project listing it is enough.
 */
export function knownSession(world: World, id: SessionId): boolean {
  if (world.sessions.some((session) => session.id === id)) return true
  return world.projects.some((project) =>
    project.processes.some((process) => sessionIdFor(project.name, process.name) === id),
  )
}

/**
 * A selection outlives disconnects and restarts — it only goes when its target
 * does: a machine unpaired, or a process gone from the project it was listed in.
 */
export function keepSelection(world: World, selected: SessionId | null): SessionId | null {
  return selected !== null && knownSession(world, selected) ? selected : null
}

export function projectsOf(world: World, connId: string): Project[] {
  return world.projects.filter((project) => connIdOf(project.name) === connId)
}

export function sessionOf(world: World, id: SessionId): SessionInfo | undefined {
  return world.sessions.find((session) => session.id === id)
}

/** How a machine's card reads: running processes over the ones it knows about. */
export function processCounts(world: World, connId: string): { running: number; total: number } {
  const projects = projectsOf(world, connId)
  const total = projects.reduce((sum, project) => sum + project.processes.length, 0)
  const running = world.sessions.filter(
    (session) => connIdOf(session.id) === connId && session.status === "running",
  ).length
  return { running, total }
}

function pick<T>(record: Record<string, T>, keep: (key: string) => boolean): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) if (keep(key)) next[key] = value
  return next
}
