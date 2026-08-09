import type { DesktopUpdateState } from "@hangar/contracts"
import { useEffect, useState } from "react"

/**
 * Live desktop update state: an initial snapshot on mount, then every change
 * pushed from the main process. Null in the browser (no desktop shell).
 */
export function useDesktopUpdate(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null)

  useEffect(() => {
    const desktop = window.hangarDesktop
    if (!desktop) return
    let alive = true
    void desktop.updateState().then((snapshot) => {
      if (alive) setState((current) => current ?? snapshot)
    })
    const unsubscribe = desktop.onUpdateState(setState)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return state
}
