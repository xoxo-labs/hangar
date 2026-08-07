import type { SessionId } from "@hangar/contracts"
import { useEffect, useRef } from "react"
import { attachTerminal, fitTerminal, focusTerminal } from "../terminals"

/**
 * One pane per live terminal. Inactive panes stay mounted (just hidden) so the
 * xterm instance — and its scrollback — survives tab switches.
 */
export function TerminalPane({ id, active }: { id: SessionId; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachTerminal(id, el)
  }, [id])

  useEffect(() => {
    if (!active) return
    // The pane is display:none until this render commits; wait a frame so the
    // fit measures the real box.
    const frame = requestAnimationFrame(() => {
      fitTerminal(id)
      focusTerminal(id)
    })
    return () => cancelAnimationFrame(frame)
  }, [id, active])

  return <div className="terminal-pane" style={{ display: active ? "block" : "none" }} ref={ref} />
}
