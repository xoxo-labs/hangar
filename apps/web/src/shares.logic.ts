import type { PortShare, SessionId } from "@hangar/contracts"

/**
 * A share plus the machine publishing it. Sharing is per-machine, so anything
 * that shows shares from more than one connection at once — the status bar —
 * needs the label to say *whose* port is exposed.
 */
export type ActiveShare = PortShare & { connId: string; machine: string }

/** One machine's contribution, shaped so this module needs nothing from the store. */
export type ShareSource = { connId: string; machine: string; shares: PortShare[] }

/**
 * Every share across every machine, public ones first: the status bar is an
 * alarm, and the internet-facing share is the thing it is warning about.
 */
export function flattenShares(sources: ShareSource[]): ActiveShare[] {
  const all = sources.flatMap((source) =>
    source.shares.map((share) => ({ ...share, connId: source.connId, machine: source.machine })),
  )
  const rank = (share: PortShare): number => (share.kind === "public" ? 0 : share.kind === "tailnet" ? 1 : 2)
  return all.sort((a, b) => {
    if (a.kind !== b.kind) return rank(a) - rank(b)
    if (a.machine !== b.machine) return a.machine.localeCompare(b.machine)
    return a.port - b.port
  })
}

/** The share started from a given session, for the row that should carry the badge. */
export function shareForSession(shares: ActiveShare[], id: SessionId | undefined): ActiveShare | undefined {
  // An adopted share carries no session; `undefined === undefined` would match
  // every one of them against a row that has no session either.
  if (id === undefined) return undefined
  return shares.find((share) => share.session === id)
}

/** Copy for one share, kept in one place so every surface says the same thing. */
export function shareLabel(kind: PortShare["kind"]): string {
  if (kind === "public") return "Public on the internet"
  return kind === "proxy" ? "Proxied to localhost on your tailnet" : "Shared on your tailnet"
}

/** Whether anything is reachable from outside the tailnet — the alarm condition. */
export function hasPublicShare(shares: ActiveShare[]): boolean {
  return shares.some((share) => share.kind === "public")
}
