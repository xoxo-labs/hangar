/**
 * Turning a failed exit into the sentence the user would otherwise dig for.
 *
 * A dev server that cannot take its port prints why and exits 1; Hangar sees
 * that output and already watches who listens on what. These helpers do the
 * text half — the probing half lives in SessionManager, which owns the process
 * table it needs to tell its own sessions from strangers.
 */
import { stripVTControlCharacters } from "node:util"
import type { ExitDiagnosis, SessionId } from "@hangar/contracts"

/** How much of the scrollback tail is searched for a failure signature. */
export const DIAGNOSIS_TAIL_CHARS = 4096
/** Probing more than a handful of candidates would just be guessing. */
const MAX_CANDIDATES = 4

/**
 * Phrasings that mean "this port was taken", across the runtimes people point
 * Hangar at. Matched per line, so a port on the same line is the process's own
 * account of what it wanted.
 */
const PORT_CONFLICT =
  /address already in use|address in use|EADDRINUSE|port is (?:already )?in use|port \d+ is (?:already )?in use|that port is already in use|already allocated/i

/** `port 3201`, `port=3201` — the port is named outright. */
const NAMED_PORT = /\bports?[\s=:]+(\d{1,5})\b/gi
/**
 * `:::3201`, `0.0.0.0:3201` — a suffix, so also how a clock reads. Two-digit
 * matches are dropped below: no dev server binds :22, but 10:22:33 is a time.
 */
const SUFFIX_PORT = /:(\d{1,5})\b/g
const MIN_SUFFIX_PORT = 100

function validPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535
}

/**
 * Ports the process itself named while complaining that one was taken. Empty
 * when the tail carries no conflict signature at all — a plain crash must not
 * be explained away by whoever happens to hold a port.
 */
export function conflictPorts(tail: string): number[] {
  const text = stripVTControlCharacters(tail).slice(-DIAGNOSIS_TAIL_CHARS)
  const ports = new Set<number>()
  let sawConflict = false
  for (const line of text.split(/\r?\n/)) {
    if (!PORT_CONFLICT.test(line)) continue
    sawConflict = true
    for (const match of line.matchAll(NAMED_PORT)) {
      const port = Number(match[1])
      if (validPort(port)) ports.add(port)
    }
    for (const match of line.matchAll(SUFFIX_PORT)) {
      const port = Number(match[1])
      if (validPort(port) && port >= MIN_SUFFIX_PORT) ports.add(port)
    }
  }
  return sawConflict ? [...ports].slice(0, MAX_CANDIDATES) : []
}

/** Whether the tail complains about a port at all, with or without naming one. */
export function mentionsPortConflict(tail: string): boolean {
  return PORT_CONFLICT.test(stripVTControlCharacters(tail).slice(-DIAGNOSIS_TAIL_CHARS))
}

export type PortHolder = { pid: number; command: string }

/** Reads `lsof -F pc` output: one `p<pid>`/`c<command>` pair per process. */
export function parsePortHolder(output: string): PortHolder | null {
  let pid: number | undefined
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const value = Number(line.slice(1))
      if (Number.isInteger(value) && value > 0) pid = value
    } else if (line.startsWith("c") && pid !== undefined) {
      return { pid, command: line.slice(1) }
    }
  }
  return pid === undefined ? null : { pid, command: "unknown" }
}

/** The whole point: one sentence that names the port and who is sitting on it. */
export function describeConflict(port: number, holder?: PortHolder & { session?: SessionId }): string {
  if (!holder) return `port ${port} was in use at startup; nothing holds it now`
  if (holder.session) return `port ${port} is held by ${holder.session} (pid ${holder.pid}), started by hangar`
  return `port ${port} is held by pid ${holder.pid} (${holder.command}), which hangar does not manage`
}

export function portConflict(port: number, holder?: PortHolder & { session?: SessionId }): ExitDiagnosis {
  return {
    kind: "port_conflict",
    port,
    message: describeConflict(port, holder),
    ...(holder ? { holder } : {}),
  }
}
