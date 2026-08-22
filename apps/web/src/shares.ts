import type { SessionId } from "@hangar/contracts"
import { useMemo } from "react"
import { type ActiveShare, flattenShares, shareForSession, type ShareSource } from "./shares.logic"
import { machineLabel, useStore } from "./store"

export type { ActiveShare }
export { hasPublicShare, shareLabel } from "./shares.logic"

export function useAllShares(): ActiveShare[] {
  // Selecting the record keeps the reference stable; deriving inside the
  // selector would hand zustand a new array every render and spin the store.
  const connections = useStore((state) => state.connections)
  return useMemo(() => {
    const sources: ShareSource[] = Object.values(connections).map((connection) => ({
      connId: connection.config.id,
      machine: machineLabel(connection),
      shares: connection.shares,
    }))
    return flattenShares(sources)
  }, [connections])
}

export function useSharesFor(connId: string): ActiveShare[] {
  const all = useAllShares()
  return useMemo(() => all.filter((share) => share.connId === connId), [all, connId])
}

/** The share a sidebar row should mark, if any. */
export function useShareForSession(id: SessionId | undefined): ActiveShare | undefined {
  const all = useAllShares()
  return useMemo(() => shareForSession(all, id), [all, id])
}
