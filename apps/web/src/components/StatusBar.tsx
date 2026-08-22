import { connIdOf, displayName, LOCAL_CONN_ID } from "@hangar/client-core"
import { Globe, Network, QrCode, Unlink2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { unsharePort } from "../actions"
import { retryConnection } from "../connections"
import { buildPortGroups, type PortGroup, type PortRow } from "../portManager.logic"
import { type ActiveShare, shareLabel, useAllShares } from "../shares"
import { CONNECTION_LABEL } from "../status"
import { type ConnectionState, type ConnectionStatus, machineLabel, useStore } from "../store"
import { cx } from "../ui/cx"
import { PortShareDialog } from "./PortShareDialog"

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
  const sessions = useStore((s) => s.sessions)
  const notice = useStore((s) => s.notice)
  const shares = useAllShares()
  const groups = useMemo(
    () =>
      buildPortGroups(
        Object.values(connections).map((connection) => ({
          connId: connection.config.id,
          machine: machineLabel(connection),
          shares: connection.shares,
          sessions: sessions.filter((session) => connIdOf(session.id) === connection.config.id),
        })),
      ),
    [connections, sessions],
  )
  /*
   * One slot rather than a boolean per panel: each trigger sits behind its own
   * `stopPropagation` wrapper, so opening one can never be the outside-click
   * that dismisses the other. Making the state exclusive is what keeps them from
   * overlapping in the same corner.
   */
  const [openPanel, setOpenPanel] = useState<"details" | "ports" | null>(null)
  const detailsOpen = openPanel === "details"

  const paired = Object.values(connections).filter((connection) => connection.config.id !== LOCAL_CONN_ID)
  const offline = paired.filter((connection) => connection.status !== "connected")

  useEffect(() => {
    if (openPanel === null) return
    const close = () => setOpenPanel(null)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [openPanel])

  return (
    <footer className="fixed right-1 bottom-0 z-10 flex h-7 select-none items-center gap-[10px] bg-transparent px-1 text-sm text-surface-9">
      {/* Errors are ErrorAlert's job now: they need room to wrap and a way to
          be dismissed, neither of which a 28px strip can offer. */}
      {notice !== null && <span className="animate-[status-notice-in_140ms_ease-out] text-success-10">✓ {notice}</span>}
      <span className="flex-1" />
      <PortsIndicator
        groups={groups}
        shares={shares}
        open={openPanel === "ports"}
        onToggle={() => setOpenPanel((open) => (open === "ports" ? null : "ports"))}
      />
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
 * both the alarm and the kill switch. The trigger is permanent now — the panel
 * manages every port Hangar has open, not just shares — so mere presence no
 * longer carries the warning. The state does instead: a dimmed Network icon is
 * silence, a plain one is open-but-private, and the warning Globe with a count
 * means someone beyond this machine can get in.
 */
function PortsIndicator({
  groups,
  shares,
  open,
  onToggle,
}: {
  groups: PortGroup[]
  shares: ActiveShare[]
  open: boolean
  onToggle: () => void
}) {
  const rowCount = groups.reduce((total, group) => total + group.rows.length, 0)
  const publicCount = shares.filter((share) => share.kind === "public").length
  const proxyCount = shares.filter((share) => share.kind === "proxy").length
  const tailnetCount = shares.filter((share) => share.kind === "tailnet").length
  const exposed = publicCount > 0
  const activity =
    proxyCount === shares.length
      ? `${proxyCount} proxied`
      : proxyCount === 0
        ? `${shares.length} shared`
        : `${shares.length} active`

  // Spelled out rather than "1 shared" so the reach is legible to a screen
  // reader and on hover, where the count alone says nothing about who can get in.
  const reach: string[] = []
  if (publicCount > 0) reach.push(`${publicCount} port${publicCount === 1 ? " is" : "s are"} public on the internet`)
  if (tailnetCount > 0) reach.push(`${tailnetCount} port${tailnetCount === 1 ? " is" : "s are"} shared on your tailnet`)
  if (proxyCount > 0) reach.push(`${proxyCount} port${proxyCount === 1 ? " is" : "s are"} proxied to localhost`)
  const label =
    shares.length > 0
      ? reach.join(", ")
      : rowCount > 0
        ? `${rowCount} open port${rowCount === 1 ? "" : "s"}, none shared`
        : "No open ports"

  return (
    <div className="relative flex h-full items-center" onPointerDown={(event) => event.stopPropagation()}>
      <button
        className={cx(
          "flex h-5 items-center gap-1.5 rounded-sm px-1! text-sm",
          exposed
            ? "bg-warning-a2 text-warning-11 hover:bg-warning-a4!"
            : rowCount > 0 || shares.length > 0
              ? "text-surface-9 hover:bg-surface-a4!"
              : "text-surface-7 hover:bg-surface-a4! hover:text-surface-9",
        )}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        {shares.length > 0 ? (
          <Globe className="size-3" aria-hidden="true" />
        ) : (
          <Network className="size-3" aria-hidden="true" />
        )}
        {/* The count tracks shares and proxies, not detected ports: dev servers
            restart all day, and a number that flickers with every restart
            teaches the eye to ignore it. Only a change in reach moves this badge. */}
        {shares.length > 0 && <span>{activity}</span>}
      </button>
      {open && (
        <div className="absolute right-0 bottom-[27px] z-[12] w-[340px] select-text rounded-lg border border-surface-6 bg-surface-3 p-2.5 text-surface-10 shadow-[0_10px_30px_#0008]">
          <div
            className={cx(
              "mb-[9px] flex items-center gap-[7px] text-base font-book",
              exposed ? "text-warning-11" : "text-surface-12",
            )}
          >
            <Globe className="size-[14px] flex-none" aria-hidden="true" />
            <span className="min-w-0 flex-1">Open ports</span>
            {/* The per-row kill switch is enough for one exposure; from two up,
                the panic path should not cost a click per port. */}
            {publicCount >= 2 && (
              <button
                type="button"
                className="flex-none rounded-sm px-1! text-xs! text-danger-11! hover:bg-danger-a3!"
                onClick={() => {
                  for (const share of shares) if (share.kind === "public") unsharePort(share.connId, share.port)
                }}
              >
                Stop all public
              </button>
            )}
          </div>
          {rowCount === 0 && (
            <p className="m-0 text-xs text-surface-8">
              Nothing is listening yet. Ports opened by sessions show up here.
            </p>
          )}
          <div className="flex flex-col gap-2.5 border-t border-surface-5 pt-1">
            {groups.map((group) => (
              <MachineGroup key={group.connId} group={group} showMachine={groups.length > 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MachineGroup({ group, showMachine }: { group: PortGroup; showMachine: boolean }) {
  return (
    <div>
      {/* Machine headers only earn their space once ports span machines. */}
      {showMachine && (
        <div className="mb-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-2xs font-semibold tracking-caps text-surface-8 uppercase">
          {group.machine}
        </div>
      )}
      <div className="divide-y divide-surface-5">
        {group.rows.map((row) => (
          <PortRowCard key={`${row.connId}:${row.port}:${row.session ?? "adopted"}`} row={row} />
        ))}
      </div>
    </div>
  )
}

function PortRowCard({ row }: { row: PortRow }) {
  const exposed = row.share?.kind === "public"
  const owner = row.project === undefined ? undefined : `${displayName(row.project)} / ${row.process}`
  const reachText = row.share ? shareLabel(row.share.kind) : row.loopbackOnly ? "Local · loopback only" : "Local"
  const compactReach =
    row.share?.kind === "proxy"
      ? "Proxy → localhost"
      : row.share?.kind === "tailnet"
        ? "Tailnet HTTPS"
        : row.share?.kind === "public"
          ? "Public link"
          : reachText

  return (
    <div className={cx("py-2.5 text-xs", exposed && "border-l-2 border-l-warning-8 pl-2")}>
      <div className="flex items-center gap-1.5">
        <span className="flex-none font-book text-surface-12 tabular-nums">:{row.port}</span>
        <span
          className={cx(
            "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
            owner === undefined && exposed ? "text-warning-11" : "text-surface-9",
          )}
        >
          {owner ?? reachText}
        </span>
        <div className="flex flex-none items-center gap-0.5">
          <PortRowQrButton row={row} />
          {row.share && (
            <button
              type="button"
              className="grid size-6 flex-none place-items-center rounded-sm text-surface-8! hover:bg-danger-a3! hover:text-danger-11!"
              title={`Stop sharing port ${row.port}`}
              aria-label={`Stop sharing port ${row.port}`}
              onClick={() => unsharePort(row.connId, row.port)}
            >
              <Unlink2 className="size-[13px]" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {/* The second line spells out reach: the wording, not the tint, is the
          part a screen reader and a tired reviewer both get. */}
      {row.share ? (
        <div className="mt-1 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap" title={row.share.url}>
          <span className={cx("flex-none text-2xs font-medium", exposed ? "text-warning-11" : "text-surface-9")}>
            {compactReach}
          </span>
          <span className="text-surface-7">·</span>
          <code className="block min-w-0 overflow-hidden text-ellipsis bg-transparent! p-0! text-2xs! text-surface-10">
            {row.share.url}
          </code>
        </div>
      ) : (
        owner !== undefined && <div className="mt-1 text-2xs text-surface-8">{reachText}</div>
      )}
    </div>
  )
}

function PortRowQrButton({ row }: { row: PortRow }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="grid size-6 flex-none place-items-center rounded-sm text-surface-8! hover:bg-surface-a4! hover:text-surface-12!"
        title={row.share === undefined ? `Show QR code for port ${row.port}` : `Show QR code for ${row.share.url}`}
        aria-label={`Show QR code for port ${row.port}`}
        onClick={() => setOpen(true)}
      >
        <QrCode className="size-[13px]" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          // Keep one dialog component mounted while a share starts or stops.
          // Switching between two component types here reset its selected reach.
          <PortShareDialog
            port={row.port}
            connId={row.connId}
            session={row.session}
            loopbackOnly={row.loopbackOnly}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
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
