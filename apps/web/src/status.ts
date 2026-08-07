import type { SessionInfo } from "@hangar/contracts"

export type Tone = "running" | "idle" | "done" | "failed"

/** No session at all reads as "idle"; a non-zero exit is the only red state. */
export function toneOf(session: SessionInfo | undefined): Tone {
  if (!session) return "idle"
  if (session.status === "running") return "running"
  return session.exitCode === 0 || session.exitCode == null ? "done" : "failed"
}

export function describe(session: SessionInfo | undefined): string {
  if (!session) return "not started"
  if (session.status === "running") return session.pid ? `running (pid ${session.pid})` : "running"
  return session.exitCode == null ? "exited" : `exited with code ${session.exitCode}`
}
