import type { SessionId } from "@hangar/contracts"
import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { SessionInspector, SessionStrip } from "./SessionInspector"
import {
  attachTerminal,
  clearTerminal,
  copyTerminalOutput,
  copyTerminalSelection,
  fitTerminal,
  focusTerminal,
  hasTerminalSelection,
} from "../terminals"

/** A mounted xterm pane plus its small, terminal-local action menu. */
export function TerminalPane({ id, active }: { id: SessionId; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const showNotice = useStore((s) => s.showNotice)
  const session = useStore((s) => s.sessions.find((item) => item.id === id))
  const inspectorOpen = useStore((s) => s.inspectingId === id)
  const openInspector = useStore((s) => s.openInspector)
  const toggleInspector = useStore((s) => s.toggleInspector)
  const closeInspector = useStore((s) => s.closeInspector)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachTerminal(id, el)
  }, [id])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => {
      fitTerminal(id)
      focusTerminal(id)
    })
    return () => cancelAnimationFrame(frame)
  }, [id, active])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        clearTerminal(id)
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [active, id])

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [menuOpen])

  const copied = async (operation: () => Promise<number>) => {
    try {
      const lines = await operation()
      showNotice(lines > 0 ? `Copied ${lines} line${lines === 1 ? "" : "s"}` : "Nothing to copy")
    } catch {
      showNotice("Clipboard access failed")
    }
    setMenuOpen(false)
  }

  return (
    <div
      className="terminal-pane"
      style={{ display: active ? "block" : "none" }}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <div className="terminal-host" ref={ref} />
      {session && <SessionStrip session={session} onInspect={() => toggleInspector(id)} />}
      <button className="terminal-menu-trigger" type="button" title="Terminal actions" onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value) }}>•••</button>
      {menuOpen && (
        <div className="terminal-menu" onPointerDown={(event) => event.stopPropagation()}>
          <button disabled={!hasTerminalSelection(id)} onClick={() => void copied(() => copyTerminalSelection(id))}>Copy selection <kbd>⌘C</kbd></button>
          <button onClick={() => void copied(() => copyTerminalOutput(id, 50))}>Select &amp; copy last 50 lines</button>
          <button onClick={() => void copied(() => copyTerminalOutput(id, 100))}>Select &amp; copy last 100 lines</button>
          <button onClick={() => void copied(() => copyTerminalOutput(id))}>Copy all output</button>
          <span className="terminal-menu-separator" />
          {session && <button onClick={() => { openInspector(id); setMenuOpen(false) }}>Session details</button>}
          {session?.logPath && window.hangarDesktop && <button onClick={() => { void window.hangarDesktop?.revealPath(session.logPath!); setMenuOpen(false) }}>Reveal current log in Finder</button>}
          {session?.logPath && <button onClick={() => void copied(async () => { await navigator.clipboard.writeText(session.logPath!); return 1 })}>Copy log path</button>}
          <button onClick={() => { clearTerminal(id); setMenuOpen(false); focusTerminal(id) }}>Clear terminal <kbd>⌘K</kbd></button>
        </div>
      )}
      {session && inspectorOpen && <SessionInspector session={session} onClose={closeInspector} />}
    </div>
  )
}
