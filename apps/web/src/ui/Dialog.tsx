import { type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef } from "react"
import { cx } from "./cx"

/*
 * Ports of the retired `.overlay` / `.dialog` family from styles.css. The
 * overlay dismisses on a mousedown that lands on the scrim itself, matching
 * the behaviour every dialog hand-rolled before.
 */

export function Overlay({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-surface-1/67 p-6"
      onMouseDown={(event: MouseEvent) => event.target === event.currentTarget && onDismiss()}
    >
      {children}
    </div>
  )
}

type DialogProps = HTMLAttributes<HTMLDivElement> & { label: string }

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"

export function Dialog({ label, className, onKeyDown, ...rest }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    if (!dialog) return

    const explicit = dialog.querySelector<HTMLElement>("[autofocus]:not(:disabled)")
    const primary = dialog.querySelector<HTMLElement>("[data-dialog-primary]:not(:disabled)")
    const actions = dialog.querySelectorAll<HTMLElement>("footer [data-dialog-action]:not(:disabled)")
    ;(explicit ?? primary ?? actions.item(actions.length - 1) ?? dialog).focus()

    return () => previous?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== "Tab") return

    const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={cx(
        "flex max-h-[calc(100vh-48px)] w-[min(560px,100%)] flex-col rounded-[10px] border border-surface-5 bg-surface-3 shadow-[0_18px_48px_#00000070] select-none",
        className,
      )}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  )
}

export function DialogHeader({ title }: { title: string }) {
  return (
    <header className="border-b border-surface-4 px-4 pt-3.5 pb-2.5">
      <h2 className="m-0 text-md font-semibold tracking-label">{title}</h2>
    </header>
  )
}

export function DialogBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 py-3.5", className)} {...rest} />
}

export function DialogFooter({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <footer
      className={cx("flex items-center justify-end gap-2 border-t border-surface-4 px-4 py-[11px]", className)}
      {...rest}
    />
  )
}
