import type { PortShareKind, SessionId, SessionMetrics, TailscaleState } from "@hangar/contracts"
import { Copy, Globe2, Info, LockKeyhole, Network, QrCode, TriangleAlert, Wifi, type LucideIcon } from "lucide-react"
import { toDataURL } from "qrcode"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { usePortLinks } from "../hooks/usePortLinks"
import { type ActiveShare, useSharesFor } from "../shares"
import { connectionOf, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogFooter, Overlay } from "../ui/Dialog"
import { IconButton } from "../ui/IconButton"

export type QrLink = { kind: "lan" | "tailscale"; host: string; url: string }

export function PortQrButton({
  port,
  connId,
  session,
  metrics,
}: {
  port: number
  connId: string
  session: SessionId
  metrics: SessionMetrics | undefined
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <IconButton
        className="size-[28px]"
        title={`Show QR code for port ${port}`}
        aria-label={`Show QR code for port ${port}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <QrCode className="size-[14px]" aria-hidden="true" />
      </IconButton>
      {open &&
        createPortal(
          <PortShareDialog
            port={port}
            connId={connId}
            session={session}
            metrics={metrics}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  )
}

/** The full port dialog for a detected port, opened outside the inspector. */
export function PortShareDialog({
  connId,
  port,
  session,
  metrics,
  loopbackOnly,
  onClose,
}: {
  connId: string
  port: number
  session?: SessionId
  metrics?: SessionMetrics
  /** Known binding state from the status-bar row; metrics are the fallback. */
  loopbackOnly?: boolean
  onClose: () => void
}) {
  const tailscale = useStore((state) => connectionOf(state.connections, connId).tailscale)
  const tailnetSharingEnabled = useStore(
    (state) => connectionOf(state.connections, connId).settings.links.tailnetSharing,
  )
  const share = useSharesFor(connId).find((item) => item.port === port)
  const { qrLinksForPort, isLoopbackOnly } = usePortLinks(connId, metrics)

  return (
    <PortShareDialogView
      port={port}
      links={qrLinksForPort(port)}
      loopbackOnly={loopbackOnly ?? isLoopbackOnly(port)}
      connId={connId}
      session={session}
      tailscale={tailscale}
      tailnetSharingEnabled={tailnetSharingEnabled}
      initialKey={share === undefined || share.kind === "proxy" ? undefined : `share:${share.kind}`}
      onClose={onClose}
    />
  )
}

function PortShareDialogView({
  port,
  links,
  loopbackOnly,
  connId,
  session,
  tailscale,
  tailnetSharingEnabled,
  initialKey,
  onClose,
}: {
  port: number
  links: QrLink[]
  loopbackOnly: boolean
  connId: string
  session?: SessionId
  tailscale: TailscaleState | null
  tailnetSharingEnabled: boolean
  /** Reach selected when the dialog opens, e.g. an active share from the status bar. */
  initialKey?: string
  onClose: () => void
}) {
  const shares = useSharesFor(connId)
  const showNotice = useStore((state) => state.showNotice)
  // The server keeps one share per port, so whichever reach matches its kind is live.
  const share = shares.find((item) => item.port === port)
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey ?? null)
  const [pendingKind, setPendingKind] = useState<PortShareKind | null>(null)
  const [qr, setQr] = useState<string | null>(null)

  // Public Funnel is always present. Private HTTPS remains opt-in, except that
  // an existing share must stay visible so the user can stop it.
  const shareKinds: PublishedShareKind[] =
    tailnetSharingEnabled || share?.kind === "tailnet" ? ["tailnet", "public"] : ["public"]
  // A newly-opened status-bar dialog can beat the network-info poll. Preserve
  // the active proxy's own address so its stop control and QR never disappear.
  const reachLinks =
    share?.kind === "proxy" && !links.some((link) => link.kind === "tailscale")
      ? [...links, proxyQrLink(share.url)]
      : links
  const reaches: ReachOption[] = [
    ...reachLinks.map(
      (link): AddressReach => ({
        type: "address",
        key: addressReachKey(link),
        title: link.kind === "lan" ? "Local network" : "Tailscale",
        subtitle: link.host,
        link,
      }),
    ),
    ...(tailscale === null
      ? []
      : shareKinds.map(
          (kind): PublishedReach => ({
            type: "published",
            key: `share:${kind}`,
            title: SHARE_TITLE[kind],
            subtitle: SHARE_PROMISE[kind],
            kind,
          }),
        )),
  ]
  const preferredFallback =
    share?.kind === "proxy"
      ? reaches.find((reach) => reach.type === "address" && reach.link.kind === "tailscale")
      : undefined
  const active = reaches.find((reach) => reach.key === selectedKey) ?? preferredFallback ?? reaches[0] ?? null
  const activeKey = active?.key ?? ""
  const url =
    active?.type === "address"
      ? active.link.url
      : active?.type === "published" && share?.kind === active.kind
        ? share.url
        : null

  // Mutations complete through the shared state broadcast. The selected reach
  // is deliberately untouched so an on/off transition never remounts or jumps
  // the rail, even when more than one Tailscale address exists.
  useEffect(() => {
    if (pendingKind === null) return
    if (share?.kind === pendingKind) {
      setPendingKind(null)
      return
    }
    const timer = setTimeout(() => setPendingKind(null), 30_000)
    return () => clearTimeout(timer)
  }, [pendingKind, share])

  const turnOn = (kind: PortShareKind): void => {
    setPendingKind(kind)
    actions.sharePort(connId, port, kind, session)
  }

  const copySelected = (): void => {
    if (url === null) return
    void navigator.clipboard.writeText(url).then(
      () => showNotice("Copied link"),
      () => showNotice("Could not copy link"),
    )
  }

  useEffect(() => {
    if (url === null) {
      setQr(null)
      return
    }
    let live = true
    setQr(null)
    void toDataURL(url, { margin: 1, width: 220 })
      .then((dataUrl) => {
        if (live) setQr(dataUrl)
      })
      .catch(() => {
        if (live) setQr(null)
      })
    return () => {
      live = false
    }
  }, [url])

  return (
    <Overlay onDismiss={onClose}>
      <Dialog
        label={`Share port ${port}`}
        className="h-[min(430px,calc(100vh-48px))] w-[min(740px,100%)]! overflow-hidden"
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <div className="flex min-h-0 flex-1">
          <ReachRail
            port={port}
            reaches={reaches}
            activeKey={activeKey}
            share={share}
            pendingKind={pendingKind}
            tailscale={tailscale}
            loopbackOnly={loopbackOnly}
            onSelect={setSelectedKey}
          />
          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex min-h-[43px] flex-none items-center gap-3 border-b border-surface-4 px-4">
              <h2 className="m-0 min-w-0 flex-1 truncate text-md font-strong tracking-label">
                {active?.title ?? `Share :${port}`}
              </h2>
              {reaches.length > 0 && (
                <select
                  aria-label="Reach"
                  className="hidden min-w-0 max-w-[190px] rounded-md border border-surface-5 bg-surface-2 px-2 py-1 text-sm text-surface-11 max-[560px]:block"
                  value={activeKey}
                  onChange={(event) => setSelectedKey(event.target.value)}
                >
                  {reaches.map((reach) => (
                    <option key={reach.key} value={reach.key}>
                      {reach.title} · {reach.subtitle}
                    </option>
                  ))}
                </select>
              )}
            </header>
            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] gap-4 overflow-y-auto px-4 py-3.5 max-[560px]:grid-cols-1">
              {active === null ? (
                <p className="col-span-full m-0 self-center text-center text-sm text-surface-9">
                  No reachable address was detected for this machine.
                </p>
              ) : (
                <>
                  <div className="flex min-w-0 flex-col gap-2">
                    {url === null ? (
                      <div className="grid size-[220px] place-content-center justify-items-center gap-2 rounded-md border border-dashed border-surface-5 bg-surface-a2 px-6 text-center text-xs leading-normal text-surface-8">
                        <QrCode className="size-8 text-surface-7" aria-hidden="true" />
                        <span>
                          {active.type === "published" && active.kind === "public"
                            ? "Available after publishing"
                            : "Available after turning on"}
                        </span>
                      </div>
                    ) : qr === null ? (
                      <div className="grid size-[220px] place-items-center text-xs text-surface-9">Generating QR…</div>
                    ) : (
                      <img
                        src={qr}
                        alt={`QR code for ${url}`}
                        className="size-[220px] rounded-md bg-white"
                        width={220}
                        height={220}
                      />
                    )}
                    <div className="flex min-h-9 w-full items-center gap-1 rounded-md bg-surface-a2 py-1 pr-1 pl-2.5">
                      <code
                        className={cx(
                          "min-w-0 flex-1 truncate bg-transparent! p-0! text-xs",
                          url === null ? "text-surface-7" : "text-surface-10",
                        )}
                        title={url ?? undefined}
                      >
                        {url ?? `${active.title} link appears after turning on`}
                      </code>
                      <IconButton
                        className="size-7 flex-none"
                        title={url === null ? "Link available after turning on" : `Copy ${url}`}
                        aria-label="Copy QR link"
                        disabled={url === null}
                        onClick={copySelected}
                      >
                        <Copy className="size-[14px]" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>
                  <ReachDetails
                    reach={active}
                    port={port}
                    loopbackOnly={loopbackOnly}
                    proxyLive={share?.kind === "proxy"}
                    tailscale={tailscale}
                  />
                </>
              )}
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
              {active && (
                <ReachAction
                  reach={active}
                  share={share}
                  pendingKind={pendingKind}
                  tailscale={tailscale}
                  loopbackOnly={loopbackOnly}
                  onTurnOn={turnOn}
                  onStop={() => actions.unsharePort(connId, port)}
                />
              )}
            </DialogFooter>
          </main>
        </div>
      </Dialog>
    </Overlay>
  )
}

type PublishedShareKind = Exclude<PortShareKind, "proxy">

type AddressReach = {
  type: "address"
  key: string
  title: string
  subtitle: string
  link: QrLink
}

type PublishedReach = {
  type: "published"
  key: `share:${PublishedShareKind}`
  title: string
  subtitle: string
  kind: PublishedShareKind
}

type ReachOption = AddressReach | PublishedReach

const SHARE_TITLE: Record<PublishedShareKind, string> = { tailnet: "Tailnet HTTPS", public: "Public link" }
const SHARE_PROMISE: Record<PublishedShareKind, string> = {
  tailnet: "HTTPS · tailnet members only",
  public: "Anyone with the link",
}

function addressReachKey(link: QrLink): string {
  return `address:${link.kind}:${link.host}`
}

function proxyQrLink(url: string): QrLink {
  try {
    return { kind: "tailscale", host: new URL(url).hostname, url }
  } catch {
    return { kind: "tailscale", host: "Tailscale", url }
  }
}

function ReachRail({
  port,
  reaches,
  activeKey,
  share,
  pendingKind,
  tailscale,
  loopbackOnly,
  onSelect,
}: {
  port: number
  reaches: ReachOption[]
  activeKey: string
  share: ActiveShare | undefined
  pendingKind: PortShareKind | null
  tailscale: TailscaleState | null
  loopbackOnly: boolean
  onSelect: (key: string) => void
}) {
  const addresses = reaches.filter((reach): reach is AddressReach => reach.type === "address")
  const published = reaches.filter((reach): reach is PublishedReach => reach.type === "published")
  return (
    <aside className="flex w-[190px] flex-none flex-col border-r border-surface-4 bg-surface-2 max-[560px]:hidden">
      <header className="flex min-h-[43px] flex-none items-center border-b border-surface-4 px-3.5">
        <h2 className="m-0 text-xs font-semibold tracking-caps text-surface-9 uppercase">Share :{port}</h2>
      </header>
      <nav aria-label="Port reach" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {addresses.length > 0 && <ReachSectionLabel>Direct addresses</ReachSectionLabel>}
        {addresses.map((reach) => (
          <ReachNavItem
            key={reach.key}
            reach={reach}
            selected={reach.key === activeKey}
            share={share}
            pendingKind={pendingKind}
            tailscale={tailscale}
            loopbackOnly={loopbackOnly}
            onSelect={onSelect}
          />
        ))}
        {published.length > 0 && <ReachSectionLabel>Published links</ReachSectionLabel>}
        {published.map((reach) => (
          <ReachNavItem
            key={reach.key}
            reach={reach}
            selected={reach.key === activeKey}
            share={share}
            pendingKind={pendingKind}
            tailscale={tailscale}
            loopbackOnly={loopbackOnly}
            onSelect={onSelect}
          />
        ))}
      </nav>
    </aside>
  )
}

function ReachSectionLabel({ children }: { children: string }) {
  return <span className="mt-1 px-2 text-2xs font-semibold tracking-caps text-surface-8 uppercase">{children}</span>
}

function ReachNavItem({
  reach,
  selected,
  share,
  pendingKind,
  tailscale,
  loopbackOnly,
  onSelect,
}: {
  reach: ReachOption
  selected: boolean
  share: ActiveShare | undefined
  pendingKind: PortShareKind | null
  tailscale: TailscaleState | null
  loopbackOnly: boolean
  onSelect: (key: string) => void
}) {
  const kind =
    reach.type === "address" && reach.link.kind === "tailscale"
      ? "proxy"
      : reach.type === "published"
        ? reach.kind
        : null
  const Icon = reachIcon(reach)
  const pending = kind !== null && pendingKind === kind
  const live = kind !== null && share?.kind === kind
  const unavailable = kind !== null && tailscale?.running !== true && !live
  /* The Tailscale IP is a direct address, exactly like the LAN one: without a
   * proxy it still answers, as long as the server listens beyond localhost.
   * Saying "Off" here made the optional proxy read as a prerequisite. */
  const status = pending
    ? "Turning on…"
    : live
      ? kind === "proxy"
        ? "Proxy on"
        : "Live"
      : unavailable
        ? "Unavailable"
        : kind === null || kind === "proxy"
          ? loopbackOnly && kind === "proxy"
            ? "Needs proxy"
            : "Direct"
          : "Off"
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      className={cx(
        "w-full min-w-0 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
        "focus-visible:shadow-[0_0_0_2px_var(--color-accent-a5)]",
        selected ? "bg-accent-a4 text-accent-11" : "text-surface-10 hover:bg-surface-a3 hover:text-surface-12",
      )}
      onClick={() => onSelect(reach.key)}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="size-[14px] flex-none" strokeWidth={1.75} aria-hidden="true" />
        <strong className="block min-w-0 flex-1 truncate text-sm font-book">{reach.title}</strong>
        <span
          className={cx(
            "flex-none text-2xs font-semibold",
            live
              ? kind === "public"
                ? "text-warning-10"
                : "text-success-10"
              : status === "Needs proxy"
                ? "text-warning-10"
                : "text-surface-8",
          )}
        >
          {status}
        </span>
      </span>
      <span className="ml-[20px] block truncate font-mono text-2xs text-surface-8" title={reach.subtitle}>
        {reach.subtitle}
      </span>
    </button>
  )
}

function reachIcon(reach: ReachOption): LucideIcon {
  if (reach.type === "address") return reach.link.kind === "lan" ? Wifi : Network
  return reach.kind === "tailnet" ? LockKeyhole : Globe2
}

function ReachDetails({
  reach,
  port,
  loopbackOnly,
  proxyLive,
  tailscale,
}: {
  reach: ReachOption
  port: number
  loopbackOnly: boolean
  proxyLive: boolean
  tailscale: TailscaleState | null
}) {
  if (reach.type === "address" && reach.link.kind === "lan") {
    return (
      <ReachDetailsShell
        description="Open this server from another device on the same Wi-Fi."
        facts={[
          ["Reach", "Same local network"],
          ["Transport", "HTTP"],
          ["Route", `Direct to ${reach.link.host}:${port}`],
        ]}
        notice={
          loopbackOnly ? (
            <WarningNotice>
              This port is bound to localhost only. Use <strong>Tailscale</strong> with <strong>Enable proxy</strong>,
              or turn on <strong>Tailnet HTTPS</strong>.
            </WarningNotice>
          ) : (
            <NeutralNotice>No proxy is involved; requests go straight to the dev server.</NeutralNotice>
          )
        }
      />
    )
  }

  if (reach.type === "address") {
    return (
      <ReachDetailsShell
        description="Open this server from another device on your tailnet."
        facts={[
          ["Reach", "Tailnet members"],
          ["Transport", "HTTP"],
          ["Route", proxyLive ? `Proxy to localhost:${port}` : `Direct to :${port}`],
        ]}
        status={
          proxyLive ? "Proxy on" : tailscale?.running !== true ? "Unavailable" : loopbackOnly ? "Needs proxy" : "Direct"
        }
        statusTone={proxyLive ? "success" : "neutral"}
        notice={
          proxyLive ? (
            <NeutralNotice>
              The proxy bridges this address to <code>localhost:{port}</code>. Disable it once the server listens beyond
              localhost — direct requests are one hop shorter.
            </NeutralNotice>
          ) : loopbackOnly ? (
            <WarningNotice>
              <strong>This port answers on localhost only,</strong> so the direct address gets no reply. Enable the
              proxy to bridge it to <code>localhost:{port}</code>.
            </WarningNotice>
          ) : (
            <NeutralNotice>
              Works as-is — requests go straight to the dev server, and the proxy stays optional (it exists for
              localhost-only ports). For HTTPS or origin allowlisting, use <strong>Tailnet HTTPS</strong>.
            </NeutralNotice>
          )
        }
      />
    )
  }

  // Unavailability trumps the mode's own guidance: a disabled button whose only
  // explanation lives in a hover tooltip reads as broken, not as unavailable.
  const unavailable = tailscale?.running !== true

  if (reach.kind === "tailnet") {
    return (
      <ReachDetailsShell
        description="Private HTTPS for devices allowed by your tailnet policy."
        facts={[
          ["Reach", "Tailnet policy"],
          ["Transport", "HTTPS"],
          ["Route", `Proxy to localhost:${port}`],
        ]}
        status={unavailable ? "Unavailable" : undefined}
        notice={
          unavailable ? (
            <TailscaleUnavailableNotice tailscale={tailscale} />
          ) : (
            <NeutralNotice>
              This mode proxies to <code>localhost:{port}</code>, so no server rebinding is needed. Add its MagicDNS
              hostname to an authentication provider's allowed origins when required.
            </NeutralNotice>
          )
        }
      />
    )
  }

  return (
    <ReachDetailsShell
      description="Public HTTPS for anyone who has the link."
      facts={[
        ["Reach", "Anyone with the link"],
        ["Transport", "HTTPS"],
        ["Route", `Proxy to localhost:${port}`],
      ]}
      status={unavailable ? "Unavailable" : undefined}
      notice={
        unavailable ? (
          <TailscaleUnavailableNotice tailscale={tailscale} />
        ) : (
          <WarningNotice>
            Anyone with the link can reach <code>localhost:{port}</code>. Hangar withdraws it when the process ends or
            the app quits.
          </WarningNotice>
        )
      }
    />
  )
}

/** Why publishing cannot happen right now, in the notice lane rather than a tooltip. */
function TailscaleUnavailableNotice({ tailscale }: { tailscale: TailscaleState | null }) {
  const message =
    tailscale?.message ?? (tailscale?.installed ? "Tailscale is not running." : "Tailscale is not installed.")
  return (
    <WarningNotice>
      <strong>{message.replace(/\.?$/, ".")}</strong>{" "}
      {tailscale?.installed
        ? "Start Tailscale on this machine to publish the port."
        : "Publishing goes through Tailscale; install it on this machine to share the port."}
    </WarningNotice>
  )
}

function ReachDetailsShell({
  description,
  facts,
  status,
  statusTone = "neutral",
  notice,
}: {
  description: string
  facts: [label: string, value: string][]
  status?: string
  statusTone?: "neutral" | "success"
  notice: ReactNode
}) {
  return (
    <section className="flex min-h-[264px] min-w-0 flex-col py-1">
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-base leading-relaxed text-surface-10">{description}</p>
        {status && (
          <span
            className={cx(
              "flex-none rounded-full px-2 py-0.5 text-2xs font-semibold",
              statusTone === "success" ? "bg-success-a3 text-success-11" : "bg-surface-a3 text-surface-9",
            )}
          >
            {status}
          </span>
        )}
      </div>
      <dl className="mt-5 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs font-semibold tracking-caps text-surface-8 uppercase">{label}</dt>
            <dd className="m-0 min-w-0 break-all font-mono text-sm leading-normal text-surface-11">{value}</dd>
          </div>
        ))}
      </dl>
      {/* This fixed lane keeps mode-specific guidance in one place without
          wrapping the whole right side in another card or shifting the QR. */}
      <div className="mt-auto min-h-[96px] pt-3">{notice}</div>
    </section>
  )
}

function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-l-2 border-warning-8 py-1.5 pr-1 pl-2.5 text-xs leading-normal text-surface-10 [&_strong]:text-warning-11">
      <TriangleAlert className="mt-px size-[14px] flex-none text-warning-10" aria-hidden="true" />
      <p className="m-0">{children}</p>
    </div>
  )
}

function NeutralNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-t border-surface-5 pt-2.5 text-xs leading-normal text-surface-9">
      <Info className="mt-px size-[14px] flex-none" aria-hidden="true" />
      <p className="m-0">{children}</p>
    </div>
  )
}

function ReachAction({
  reach,
  share,
  pendingKind,
  tailscale,
  loopbackOnly,
  onTurnOn,
  onStop,
}: {
  reach: ReachOption
  share: ActiveShare | undefined
  pendingKind: PortShareKind | null
  tailscale: TailscaleState | null
  loopbackOnly: boolean
  onTurnOn: (kind: PortShareKind) => void
  onStop: () => void
}) {
  if (reach.type === "address" && reach.link.kind === "lan") return null

  const kind: PortShareKind = reach.type === "address" ? "proxy" : reach.kind
  if (share?.kind === kind) {
    return (
      <Button variant="danger" onClick={onStop}>
        {kind === "proxy" ? "Disable proxy" : "Stop sharing"}
      </Button>
    )
  }

  const pending = pendingKind === kind
  const unavailable = tailscale?.running !== true

  /* The proxy is a repair for localhost-only ports, not a switch the address
   * depends on. Only then does it earn the primary treatment — otherwise the
   * direct link above it already works and the button is a quiet extra. */
  if (kind === "proxy") {
    return (
      <Button
        variant={loopbackOnly ? "primary" : "default"}
        disabled={pending || unavailable}
        title={
          unavailable
            ? (tailscale?.message ?? "Tailscale is unavailable")
            : loopbackOnly
              ? undefined
              : "Optional — this port is already reachable at the address above"
        }
        onClick={() => onTurnOn(kind)}
      >
        {pending ? "Turning on…" : "Enable proxy"}
      </Button>
    )
  }

  if (kind === "public") {
    return (
      <button
        type="button"
        className="rounded-md bg-warning-9 px-[11px] py-[5px] text-base font-book text-black enabled:hover:bg-warning-10 disabled:opacity-40"
        disabled={pending || unavailable}
        title={unavailable ? (tailscale?.message ?? "Tailscale is unavailable") : undefined}
        onClick={() => onTurnOn(kind)}
      >
        {pending ? "Publishing…" : "Publish"}
      </button>
    )
  }

  return (
    <Button
      variant="primary"
      disabled={pending || unavailable}
      title={unavailable ? (tailscale?.message ?? "Tailscale is unavailable") : undefined}
      onClick={() => onTurnOn(kind)}
    >
      {pending ? "Turning on…" : "Turn on"}
    </Button>
  )
}
