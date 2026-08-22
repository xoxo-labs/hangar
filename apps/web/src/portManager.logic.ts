import type { PortShare, SessionId, SessionInfo } from "@hangar/contracts"

/**
 * One row of the status bar's port manager: a port somebody opened, merged
 * with the share publishing it, if any. `share` doubles as the reach signal —
 * absent means only this machine (or its LAN) can dial the port.
 */
export type PortRow = {
  connId: string
  port: number
  /** Scoped id of the session that opened the port, when one is known. */
  session?: SessionId
  /** Scoped project name of the owning session — render with displayName(). */
  project?: string
  process?: string
  /** The live share for this port, if the machine is publishing it. */
  share?: PortShare
  /** Every reported binding is loopback, so no other device can reach it. */
  loopbackOnly: boolean
}

export type PortGroup = { connId: string; machine: string; rows: PortRow[] }

/**
 * One machine's contribution, shaped so this module needs nothing from the
 * store — and no runtime workspace imports, so `node --test` can load it. The
 * caller filters `sessions` down to the ones this connection owns.
 */
export type PortSource = {
  connId: string
  machine: string
  shares: PortShare[]
  sessions: SessionInfo[]
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"])

/** True only when bindings are known and all loopback — unknown never warns. */
export function loopbackOnly(bindings: string[]): boolean {
  return bindings.length > 0 && bindings.every((host) => LOOPBACK_HOSTS.has(host))
}

function reachRank(row: PortRow): number {
  if (row.share?.kind === "public") return 0
  if (row.share?.kind === "tailnet") return 1
  if (row.share?.kind === "proxy") return 2
  return 3
}

/**
 * Every open port across every machine, grouped for the port manager panel.
 * Detected ports come from running sessions only: an exited session keeps its
 * last metrics, and listing its dead ports would be a lie. Shares with no
 * detected port (adopted, or owned by a process the sampler missed) still get
 * a row — reachable-but-invisible is the one state this panel must not allow.
 * Public rows sort first within a machine and exposed machines head the list,
 * for the same reason flattenShares orders that way: this UI is an alarm.
 */
export function buildPortGroups(sources: PortSource[]): PortGroup[] {
  const groups = sources
    .map((source) => {
      const rows: PortRow[] = []
      for (const session of source.sessions) {
        if (session.status !== "running" || !session.metrics) continue
        for (const port of session.metrics.ports) {
          rows.push({
            connId: source.connId,
            port,
            session: session.id,
            project: session.project,
            process: session.process,
            share: source.shares.find((share) => share.port === port),
            loopbackOnly: loopbackOnly(session.metrics.portBindings?.[port] ?? []),
          })
        }
      }
      for (const share of source.shares) {
        if (rows.some((row) => row.port === share.port)) continue
        const owner = source.sessions.find((session) => session.id === share.session)
        rows.push({
          connId: source.connId,
          port: share.port,
          session: share.session,
          project: owner?.project,
          process: owner?.process,
          share,
          loopbackOnly: false,
        })
      }
      rows.sort((a, b) => reachRank(a) - reachRank(b) || a.port - b.port)
      return { connId: source.connId, machine: source.machine, rows }
    })
    .filter((group) => group.rows.length > 0)
  return groups.sort(
    (a, b) =>
      Number(b.rows.some((row) => row.share?.kind === "public")) -
      Number(a.rows.some((row) => row.share?.kind === "public")),
  )
}
