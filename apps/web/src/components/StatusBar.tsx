import { useEffect, useState } from "react"
import { retryConnection } from "../connections"
import { LOCAL_CONN_ID } from "../connections/scope"
import { CONNECTION_LABEL } from "../status"
import { type ConnectionState, type ConnectionStatus, machineLabel, useStore } from "../store"
import { cx } from "../ui/cx"

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
  blocked: "bg-danger-10",
}

export function StatusBar() {
  const status = useStore((s) => s.status)
  const port = useStore((s) => s.port)
  const acceptRemote = useStore((s) => s.settings.connections?.acceptRemote === true)
  const connections = useStore((s) => s.connections)
  const lastError = useStore((s) => s.lastError)
  const notice = useStore((s) => s.notice)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const paired = Object.values(connections).filter((connection) => connection.config.id !== LOCAL_CONN_ID)
  const offline = paired.filter((connection) => connection.status !== "connected")

  useEffect(() => {
    if (!detailsOpen) return
    const close = () => setDetailsOpen(false)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [detailsOpen])

  return (
    <footer className="fixed right-1 bottom-0 z-10 flex h-7 select-none items-center gap-[10px] bg-transparent px-1 text-sm text-surface-9">
      {lastError !== null && (
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-danger-10">{lastError}</span>
      )}
      {notice !== null && <span className="animate-[status-notice-in_140ms_ease-out] text-success-10">✓ {notice}</span>}
      <span className="flex-1" />
      <div className="relative flex h-full items-center" onPointerDown={(event) => event.stopPropagation()}>
        {/*
         * The `!` here predates the reset's move into `@layer base`; plain
         * utilities now outrank the `button` reset, so it is merely defensive.
         */}
        <button
          className="flex h-5 min-w-[18px] items-center gap-1.5 rounded-sm px-1! text-sm text-surface-9 hover:bg-surface-a4!"
          type="button"
          title="Hangar server details"
          aria-label={`Hangar server ${CONNECTION_LABEL[status]}`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span className={cx("size-1.5 rounded-full", DOT_TONE[status])} aria-hidden="true" />
          {status !== "connected" && <span>{CONNECTION_LABEL[status]}</span>}
          {/* One machine that cannot be reached is worth a word down here too. */}
          {status === "connected" && offline.length > 0 && (
            <span>
              {offline.length} machine{offline.length === 1 ? "" : "s"} offline
            </span>
          )}
        </button>
        {/* The panel is right-anchored: the footer itself sits at the window's right edge. */}
        {detailsOpen && (
          <div className="absolute right-0 bottom-[27px] z-[12] w-[230px] select-text rounded-lg border border-surface-6 bg-surface-3 p-2.5 text-surface-10 shadow-[0_10px_30px_#0008]">
            <div className="mb-[9px] flex items-center gap-[7px] text-base font-book text-surface-12">
              <span className={cx("size-1.5 rounded-full", DOT_TONE[status])} />
              Hangar server
            </div>
            <dl className="m-0 grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
              <dt className="text-surface-8">Status</dt>
              <dd className="m-0 overflow-hidden text-ellipsis">{CONNECTION_LABEL[status]}</dd>
              <dt className="text-surface-8">Endpoint</dt>
              <dd className="m-0 overflow-hidden text-ellipsis">
                {/* Overrides the `code` element rule from the base layer (11px, surface-a3 bg, 1px 4px padding). */}
                <code className="bg-transparent! p-0! text-xs!">127.0.0.1:{port}</code>
              </dd>
              <dt className="text-surface-8">Access</dt>
              <dd className="m-0 overflow-hidden text-ellipsis">
                {acceptRemote ? "Accepting connections" : "Local only"}
              </dd>
            </dl>
            {paired.length > 0 && (
              <div className="mt-2.5 border-t border-surface-5 pt-2">
                <div className="mb-1.5 text-2xs font-semibold tracking-caps text-surface-8 uppercase">
                  Paired machines
                </div>
                <div className="flex flex-col gap-1.5">
                  {paired.map((connection) => (
                    <PairedRow key={connection.config.id} connection={connection} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </footer>
  )
}

function PairedRow({ connection }: { connection: ConnectionState }) {
  const { config, status } = connection
  return (
    <div className="flex items-center gap-[7px] text-xs">
      <span className={cx("size-1.5 flex-none rounded-full", DOT_TONE[status])} aria-hidden="true" />
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-surface-11">
        {machineLabel(connection)}
        <span className="text-surface-8"> · {CONNECTION_LABEL[status]}</span>
      </span>
      {status === "blocked" ? (
        <button
          type="button"
          className="flex-none rounded-sm px-1! text-xs! text-accent-10! hover:bg-surface-a4!"
          onClick={() => retryConnection(config.id)}
        >
          Retry
        </button>
      ) : (
        <code className="flex-none bg-transparent! p-0! text-2xs! text-surface-8">
          {config.host}:{config.port}
        </code>
      )}
    </div>
  )
}
