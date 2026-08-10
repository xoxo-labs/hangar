import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { IconButton } from "./IconButton"

/** Drops a divider between two groups of items. */
export const MENU_SEPARATOR = "separator"

export type MenuItem = typeof MENU_SEPARATOR | { label: string; disabled?: boolean; onSelect: () => void }

const ITEM =
  "w-full rounded-sm px-2 py-1 text-left text-base text-surface-11 enabled:hover:bg-surface-a3 enabled:hover:text-surface-12 disabled:cursor-default disabled:opacity-30"

/** Breathing room between popup and trigger, and between popup and viewport. */
const GAP = 4

/**
 * A dropdown hung off an IconButton. The popup is `fixed` rather than absolute
 * because its callers live inside scroll containers (the sidebar nav), which
 * would clip an in-flow popup.
 */
export function Menu({
  title,
  items,
  onOpenChange,
  contextPosition,
  showTrigger = true,
  children = "⋯",
}: {
  title: string
  items: MenuItem[]
  onOpenChange?: (open: boolean) => void
  /** When supplied, opens the same menu at a right-click position. */
  contextPosition?: { x: number; y: number } | null
  showTrigger?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const anchor = useRef<"right-edge" | "point">("right-edge")
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popup = useRef<HTMLDivElement>(null)

  const dismiss = () => {
    setOpen(false)
    onOpenChange?.(false)
  }

  useEffect(() => {
    if (contextPosition === null || contextPosition === undefined) return
    anchor.current = "point"
    setPosition({ top: contextPosition.y, left: contextPosition.x })
    setOpen(true)
    onOpenChange?.(true)
  }, [contextPosition, onOpenChange])

  useEffect(() => {
    if (!open) return
    const close = () => dismiss()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      dismiss()
      trigger.current?.focus()
    }
    // A fixed popup cannot follow the scrolling nav, so scrolling dismisses it;
    // the listener captures because a scroll event does not bubble to window.
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", close)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [open, onOpenChange])

  useLayoutEffect(() => {
    if (!open || popup.current === null) return
    // Fixed popups get no collision handling from the browser. Align dropdowns
    // to their trigger's right edge, then clamp both kinds of menu to the
    // viewport (the same basic behavior as Radix/shadcn menus).
    const rect = popup.current.getBoundingClientRect()
    const anchoredLeft = anchor.current === "right-edge" ? position.left - rect.width : position.left
    setPosition({
      left: Math.max(GAP, Math.min(anchoredLeft, window.innerWidth - rect.width - GAP)),
      top: Math.max(GAP, Math.min(position.top, window.innerHeight - rect.height - GAP)),
    })
  }, [open, contextPosition])

  return (
    <>
      {showTrigger && (
        <IconButton
          title={title}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (open) return dismiss()
            // IconButton takes no ref, so the click supplies both the anchor rect
            // and the element Escape hands focus back to.
            trigger.current = event.currentTarget
            const rect = event.currentTarget.getBoundingClientRect()
            anchor.current = "right-edge"
            setPosition({ top: rect.bottom + GAP, left: rect.right })
            setOpen(true)
            onOpenChange?.(true)
          }}
        >
          {children}
        </IconButton>
      )}

      {open && (
        <div
          ref={popup}
          role="menu"
          aria-label={title}
          className="fixed z-20 flex min-w-[160px] flex-col rounded-md border border-surface-5 bg-surface-3 p-1 shadow-[0_10px_30px_#0008]"
          style={{ top: position.top, left: position.left }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item, index) =>
            item === MENU_SEPARATOR ? (
              <span key={index} role="separator" className="my-1 h-px bg-surface-5" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={ITEM}
                disabled={item.disabled}
                onClick={() => {
                  dismiss()
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  )
}
