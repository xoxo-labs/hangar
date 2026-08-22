import { LOCAL_CONN_ID } from "@hangar/client-core"
import { Globe, QrCode, Unlink2 } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { unsharePort } from "../actions"
import { retryConnection } from "../connections"
import { type ActiveShare, shareLabel, useAllShares } from "../shares"
import { CONNECTION_LABEL } from "../status"
import { type ConnectionState, type ConnectionStatus, machineLabel, useStore } from "../store"
import { cx } from "../ui/cx"
import { ActiveShareQrDialog } from "./SessionInspector"

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
  const notice = useStore((s) => s.notice)
  const shares = useAllShares()
  /*
   * One slot rather than a boolean per panel: each trigger sits behind its own
   * `stopPropagation` wrapper, so opening one can never be the outside-click
   * that dismisses the other. Making the state exclusive is what keeps them from
   * overlapping in the same corner.
   */
  const [openPanel, setOpenPanel] = useState<"details" | "shares" | null>(null)
  const detailsOpen = openPanel === "details"

  const paired = Object.values(connections).filter((connection) => connection.config.id !== LOCAL_CONN_ID)
  const offline = paired.filter((connection) => connection.status !== "connected")

  useEffect(() => {
    if (openPanel === null) return
    const close = () => setOpenPanel(null)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [openPanel])

  // A share can also end from the machine that published it. Disarm the panel so
  // it does not spring open on its own the next time someone shares a port.
  useEffect(() => {
    if (shares.length === 0) setOpenPanel((open) => (open === "shares" ? null : open))
  }, [shares.length])

  return (
    <footer className="fixed right-1 bottom-0 z-10 flex h-7 select-none items-center gap-[10px] bg-transparent px-1 text-sm text-surface-9">
      {/* Errors are ErrorAlert's job now: they need room to wrap and a way to
          be dismissed, neither of which a 28px strip can offer. */}
      {notice !== null && <span className="animate-[status-notice-in_140ms_ease-out] text-success-10">✓ {notice}</span>}
      <span className="flex-1" />
      {shares.length > 0 && (
        <SharesIndicator
          shares={shares}
          open={openPanel === "shares"}
          onToggle={() => setOpenPanel((open) => (open === "shares" ? null : "shares"))}
        />
      )}
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
          onClick={() => setOpenPanel((open) => (open === "details" ? null : "details"))}
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

/*
 * A public share is the only thing in Hangar a stranger can reach, so this is
 * both the alarm and the kill switch: the warning tone is the signal, not
 * decoration, and every row can end its own share without leaving the footer.
 */
function SharesIndicator({ shares, open, onToggle }: { shares: ActiveShare[]; open: boolean; onToggle: () => void }) {
  const publicCount = shares.filter((share) => share.kind === "public").length
  const tailnetCount = shares.length - publicCount
  const exposed = publicCount > 0

  // Spelled out rather than "1 shared" so the reach is legible to a screen
  // reader and on hover, where the count alone says nothing about who can get in.
  const reach: string[] = []
  if (publicCount > 0) reach.push(`${publicCount} port${publicCount === 1 ? " is" : "s are"} public on the internet`)
  if (tailnetCount > 0) reach.push(`${tailnetCount} port${tailnetCount === 1 ? " is" : "s are"} shared on your tailnet`)
  const label = reach.join(", ")

  // Machine headers only earn their space once shares actually span machines.
  const groups: { connId: string; machine: string; shares: ActiveShare[] }[] = []
  for (const share of shares) {
    // `shares` arrives public-first, so the exposed machine heads the list too.
    const group = groups.find((candidate) => candidate.connId === share.connId)
    if (group) group.shares.push(share)
    else groups.push({ connId: share.connId, machine: share.machine, shares: [share] })
  }

  return (
    <div className="relative flex h-full items-center" onPointerDown={(event) => event.stopPropagation()}>
      <button
        className={cx(
          "flex h-5 items-center gap-1.5 rounded-sm px-1! text-sm",
          exposed ? "bg-warning-a2 text-warning-11 hover:bg-warning-a4!" : "text-surface-9 hover:bg-surface-a4!",
        )}
        type="button"
        title={label}
        aria-label={label}
        onClick={onToggle}
      >
        <Globe className="size-3" aria-hidden="true" />
        <span>{shares.length} shared</span>
      </button>
      {open && (
        <div className="absolute right-0 bottom-[27px] z-[12] w-[290px] select-text rounded-lg border border-surface-6 bg-surface-3 p-2.5 text-surface-10 shadow-[0_10px_30px_#0008]">
          <div
            className={cx(
              "mb-[9px] flex items-center gap-[7px] text-base font-book",
              exposed ? "text-warning-11" : "text-surface-12",
            )}
          >
            <Globe className="size-[14px] flex-none" aria-hidden="true" />
            Shared ports
          </div>
          <div className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <div key={group.connId}>
                {groups.length > 1 && (
                  <div className="mb-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-2xs font-semibold tracking-caps text-surface-8 uppercase">
                    {group.machine}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {group.shares.map((share) => (
                    <ShareRow key={`${share.connId}:${share.port}`} share={share} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ShareRow({ share }: { share: ActiveShare }) {
  const exposed = share.kind === "public"
  return (
    <div
      className={cx(
        "rounded-md border px-2 py-1.5 text-xs",
        exposed ? "border-warning-6 bg-warning-a2" : "border-surface-5 bg-surface-a2",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex-none font-book text-surface-12 tabular-nums">:{share.port}</span>
        <span
          className={cx(
            "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
            exposed ? "text-warning-11" : "text-surface-8",
          )}
        >
          {shareLabel(share.kind)}
        </span>
        <div className="flex flex-none items-center gap-px rounded-md border border-surface-5 bg-surface-a2 p-0.5">
          <ShareQrButton share={share} />
          <button
            type="button"
            className="grid size-6 flex-none place-items-center rounded-sm text-surface-8! hover:bg-danger-a3! hover:text-danger-11!"
            title={`Stop sharing port ${share.port}`}
            aria-label={`Stop sharing port ${share.port}`}
            onClick={() => unsharePort(share.connId, share.port)}
          >
            <Unlink2 className="size-[13px]" aria-hidden="true" />
          </button>
        </div>
      </div>
      <code className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap bg-transparent! p-0! text-2xs! text-surface-9">
        {share.url}
      </code>
    </div>
  )
}

function ShareQrButton({ share }: { share: ActiveShare }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="grid size-6 flex-none place-items-center rounded-sm text-surface-8! hover:bg-surface-a4! hover:text-surface-12!"
        title={`Show QR code for ${share.url}`}
        aria-label={`Show QR code for shared port ${share.port}`}
        onClick={() => setOpen(true)}
      >
        <QrCode className="size-[13px]" aria-hidden="true" />
      </button>
      {open && createPortal(<ActiveShareQrDialog share={share} onClose={() => setOpen(false)} />, document.body)}
    </>
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
