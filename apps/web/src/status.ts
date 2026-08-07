import type { SessionInfo } from "@hangar/contracts"

export type Tone = "running" | "warning" | "idle" | "done" | "failed"

export const HIGH_CPU_PERCENT = 80

export function hasHighCpu(session: SessionInfo | undefined): boolean {
  return session?.status === "running" &&
    session.metrics !== undefined &&
    session.metrics.cpuPercent >= HIGH_CPU_PERCENT
}

/** No session at all reads as "idle"; a non-zero exit is the only red state. */
export function toneOf(session: SessionInfo | undefined): Tone {
  if (!session) return "idle"
  if (session.status === "running") return hasHighCpu(session) ? "warning" : "running"
  return session.exitCode === 0 || session.exitCode == null ? "done" : "failed"
}

export function describe(session: SessionInfo | undefined): string {
  if (!session) return "not started"
  if (hasHighCpu(session)) return `high CPU (${Math.round(session.metrics!.cpuPercent)}%)`
  if (session.status === "running") return session.pid ? `running (pid ${session.pid})` : "running"
  return session.exitCode == null ? "exited" : `exited with code ${session.exitCode}`
}
