/** The desktop app's status vocabulary, unchanged: same tones, same sentences. */

import type { ConnectionStatus } from "@hangar/client-core"
import type { SessionInfo } from "@hangar/contracts"

export type Tone = "running" | "warning" | "idle" | "done" | "failed"

export const HIGH_CPU_PERCENT = 80

export function connectionTone(status: ConnectionStatus): Tone {
  if (status === "connected") return "running"
  if (status === "blocked") return "failed"
  return "warning"
}

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "connecting…",
  connected: "connected",
  reconnecting: "reconnecting…",
  blocked: "not paired",
}

export function hasHighCpu(session: SessionInfo | undefined): boolean {
  return (
    session?.status === "running" && session.metrics !== undefined && session.metrics.cpuPercent >= HIGH_CPU_PERCENT
  )
}

/** No session at all reads as "idle"; a non-zero exit is the only red state. */
export function toneOf(session: SessionInfo | undefined): Tone {
  if (!session) return "idle"
  if (session.status === "running") return hasHighCpu(session) ? "warning" : "running"
  return session.exitCode === 0 || session.exitCode == null ? "done" : "failed"
}

export function describe(session: SessionInfo | undefined): string {
  if (!session) return "not started"
  if (session.status === "running") return session.pid ? `running (pid ${session.pid})` : "running"
  return session.exitCode == null ? "exited" : `exited with code ${session.exitCode}`
}

export function formatMemory(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function formatCpu(percent: number): string {
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`
}
