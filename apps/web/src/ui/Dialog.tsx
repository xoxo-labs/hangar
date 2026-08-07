import type { HTMLAttributes, MouseEvent, ReactNode } from "react"
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

export function Dialog({ label, className, ...rest }: DialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={cx(
        "flex max-h-[calc(100vh-48px)] w-[min(560px,100%)] flex-col rounded-[10px] border border-surface-5 bg-surface-3 shadow-[0_18px_48px_#00000070] select-none",
        className,
      )}
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
  return <footer className={cx("flex items-center gap-2 border-t border-surface-4 px-4 py-[11px]", className)} {...rest} />
}
