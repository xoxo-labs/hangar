import { useEffect, useState } from "react"
import { type ConnectionStatus, useStore } from "../store"
import { cx } from "../ui/cx"

const LABELS = {
  connecting: "connecting…",
  connected: "connected",
  reconnecting: "reconnecting…",
} as const

/*
 * Port of `.conn-dot` and its status variants. Every ConnectionStatus is covered
 * so the old `.conn-dot` base fill (surface-8) was never actually painted — it is
 * left out on purpose: two competing `bg-*` utilities on one element resolve by
 * stylesheet order, not className order, so the base would be a coin flip.
 */
const DOT_TONE: Record<ConnectionStatus, string> = {
  connected: "bg-success-10",
  connecting: "bg-warning-9 animate-[pulse_1.2s_ease-in-out_infinite]",
  reconnecting: "bg-warning-9 animate-[pulse_1.2s_ease-in-out_infinite]",
}

export function StatusBar() {
  const status = useStore((s) => s.status)
  const port = useStore((s) => s.port)
  const lastError = useStore((s) => s.lastError)
  const notice = useStore((s) => s.notice)
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    if (!detailsOpen) return
    const close = () => setDetailsOpen(false)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [detailsOpen])

  return (
    <footer className="fixed right-1 bottom-0 z-10 flex h-7 select-none items-center gap-[10px] bg-transparent px-1 text-[11px] text-surface-9">
      {lastError !== null && (
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-danger-10">{lastError}</span>
      )}
      {notice !== null && (
        <span className="animate-[status-notice-in_140ms_ease-out] text-success-10">✓ {notice}</span>
      )}
      <span className="flex-1" />
      <div className="relative flex h-full items-center" onPointerDown={(event) => event.stopPropagation()}>
        {/*
         * The `!` here predates the reset's move into `@layer base`; plain
         * utilities now outrank the `button` reset, so it is merely defensive.
         */}
        <button
          className="flex h-5 min-w-[18px] items-center gap-1.5 rounded-[4px] px-1! text-[11px] text-surface-9 hover:bg-surface-a4!"
          type="button"
          title="Hangar server details"
          aria-label={`Hangar server ${LABELS[status]}`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span className={cx("size-1.5 rounded-full", DOT_TONE[status])} aria-hidden="true" />
          {status !== "connected" && <span>{LABELS[status]}</span>}
        </button>
        {detailsOpen && (
          <div className="absolute bottom-[27px] left-0 z-[12] w-[230px] select-text rounded-[7px] border border-surface-6 bg-surface-3 p-2.5 text-surface-10 shadow-[0_10px_30px_#0008]">
            <div className="mb-[9px] flex items-center gap-[7px] text-[11.5px] font-[550] text-surface-12">
              <span className={cx("size-1.5 rounded-full", DOT_TONE[status])} />
              Hangar server
            </div>
            <dl className="m-0 grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[10px]">
              <dt className="text-surface-8">Status</dt>
              <dd className="m-0 overflow-hidden text-ellipsis">{LABELS[status]}</dd>
              <dt className="text-surface-8">Endpoint</dt>
              <dd className="m-0 overflow-hidden text-ellipsis">
                {/* Overrides the `code` element rule from the base layer (11px, surface-a3 bg, 1px 4px padding). */}
                <code className="bg-transparent! p-0! text-[10px]!">127.0.0.1:{port}</code>
              </dd>
              <dt className="text-surface-8">Access</dt>
              <dd className="m-0 overflow-hidden text-ellipsis">Local only</dd>
            </dl>
          </div>
        )}
      </div>
    </footer>
  )
}
