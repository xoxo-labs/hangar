import type { SessionId } from "@hangar/contracts"
import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { cx } from "../ui/cx"
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

/* Port of `.terminal-menu button` (+ :hover / :disabled). `enabled:` guards the
 * hover pair because the old rules leaned on source order to let :disabled win. */
const MENU_ITEM =
  "flex justify-between rounded-[4px] px-[8px] py-[6px] text-left text-[11.5px] text-surface-11 enabled:hover:bg-surface-a4 enabled:hover:text-surface-12 disabled:cursor-default disabled:opacity-35"

/** Port of `.terminal-menu kbd` — `font: inherit` resolves to the body sans stack. */
const MENU_KBD = "font-sans text-[10px] text-surface-8"

/*
 * The literal `terminal-pane` class is kept on purpose: it is the anchor for the
 * xterm-internals rules that cannot move into JSX (`.xterm`, `.xterm-viewport`,
 * the custom `.xterm-scrollable-element` scrollbar), since that DOM is built by
 * xterm, not by this component. Everything else here is a utility port.
 */
const PANE =
  "terminal-pane group absolute inset-0 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[28px] after:border-t after:border-surface-4 after:bg-surface-2 after:content-['']"

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
      className={PANE}
      style={{ display: active ? "block" : "none" }}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <div className="absolute top-[6px] right-[4px] bottom-[28px] left-[8px] min-h-0 overflow-hidden" ref={ref} />
      {session && <SessionStrip session={session} onInspect={() => toggleInspector(id)} />}
      <button className={cx("absolute top-[8px] right-[16px] z-[4] rounded-[5px] border border-surface-5 bg-surface-3/88 px-[6px] pt-[2px] pb-[4px] text-[11px] tracking-[1px] text-surface-9 transition-opacity duration-[120ms] ease-[ease] group-hover:opacity-100 focus:opacity-100", menuOpen ? "opacity-100" : "opacity-0")} type="button" title="Terminal actions" onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value) }}>•••</button>
      {menuOpen && (
        <div className="absolute top-[34px] right-[16px] z-[5] flex w-[238px] flex-col rounded-[7px] border border-surface-6 bg-surface-3 p-[5px] shadow-[0_10px_30px_#0008]" onPointerDown={(event) => event.stopPropagation()}>
          <button className={MENU_ITEM} disabled={!hasTerminalSelection(id)} onClick={() => void copied(() => copyTerminalSelection(id))}>Copy selection <kbd className={MENU_KBD}>⌘C</kbd></button>
          <button className={MENU_ITEM} onClick={() => void copied(() => copyTerminalOutput(id, 50))}>Select &amp; copy last 50 lines</button>
          <button className={MENU_ITEM} onClick={() => void copied(() => copyTerminalOutput(id, 100))}>Select &amp; copy last 100 lines</button>
          <button className={MENU_ITEM} onClick={() => void copied(() => copyTerminalOutput(id))}>Copy all output</button>
          <span className="mx-[3px] my-[4px] h-px bg-surface-5" />
          {session && <button className={MENU_ITEM} onClick={() => { openInspector(id); setMenuOpen(false) }}>Session details</button>}
          {session?.logPath && window.hangarDesktop && <button className={MENU_ITEM} onClick={() => { void window.hangarDesktop?.revealPath(session.logPath!); setMenuOpen(false) }}>Reveal current log in Finder</button>}
          {session?.logPath && <button className={MENU_ITEM} onClick={() => void copied(async () => { await navigator.clipboard.writeText(session.logPath!); return 1 })}>Copy log path</button>}
          <button className={MENU_ITEM} onClick={() => { clearTerminal(id); setMenuOpen(false); focusTerminal(id) }}>Clear terminal <kbd className={MENU_KBD}>⌘K</kbd></button>
        </div>
      )}
      {session && inspectorOpen && <SessionInspector session={session} onClose={closeInspector} />}
    </div>
  )
}
