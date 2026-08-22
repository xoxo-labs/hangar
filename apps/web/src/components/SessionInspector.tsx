import { connIdOf, displayName } from "@hangar/client-core"
import type {
  BrowserChoice,
  PortShareKind,
  SessionHistoryEntry,
  SessionId,
  SessionInfo,
  TailscaleState,
} from "@hangar/contracts"
import { Copy, ExternalLink, Info, QrCode } from "lucide-react"
import { toDataURL } from "qrcode"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as actions from "../actions"
import { usePortLinks } from "../hooks/usePortLinks"
import { browserLabel } from "../links"
import { type ActiveShare, shareLabel, useSharesFor } from "../shares"
import { hasHighCpu, toneOf } from "../status"
import { type SessionMetricPoint, connectionOf, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { IconButton } from "../ui/IconButton"
import { Dot } from "./Dot"
import { BrowserSelect } from "./BrowserSelect"
import { ResourceMetrics } from "./ResourceMetrics"

const NO_METRIC_HISTORY: SessionMetricPoint[] = []

/** Ports of `.inspector-summary, .inspector-section` — one padded, hairline-separated block. */
const SECTION = "border-b border-surface-4 p-[14px]"
/** Port of `.inspector-section h3`. */
const SECTION_TITLE = "mt-0 mb-[10px] text-xs font-semibold uppercase tracking-caps text-surface-9"
/** Port of `.port-list, .history-list`. */
const STACK = "flex flex-col gap-[5px]"
/** Port of `.inspector-empty`. */
const EMPTY = "m-0 text-sm leading-normal text-surface-8"

export function SessionStrip({ session, onInspect }: { session: SessionInfo; onInspect: () => void }) {
  const now = useNow(session.status === "running")
  const metrics = session.metrics
  const running = session.status === "running"
  const highCpu = metrics !== undefined && hasHighCpu(session)
  const primaryPort = running ? metrics?.ports[0] : undefined
  const connId = connIdOf(session.id)
  // The machine that runs the session owns the browser preference and the address.
  const browser = useStore((state) => {
    const project = state.projects.find((item) => item.name === session.project)
    return (
      project?.processes.find((item) => item.name === session.process)?.browser ??
      project?.browser ??
      connectionOf(state.connections, connId).settings.links.browser
    )
  })
  const { openPort, urlForPort } = usePortLinks(connId, metrics, browser)
  return (
    <div className="absolute bottom-0 left-[8px] z-[1] flex h-[28px] w-max items-center gap-[8px] whitespace-nowrap pr-[4px] text-left text-sm leading-tight text-surface-9">
      <button
        className="flex items-center gap-[8px] self-center text-inherit hover:text-surface-12 focus:outline-none"
        type="button"
        onClick={onInspect}
        title="Open session inspector"
      >
        {highCpu ? (
          <span
            className="font-semibold tabular-nums text-warning-11"
            title={`High CPU usage: ${formatCpu(metrics.cpuPercent)}`}
            aria-label={`High CPU usage: ${formatCpu(metrics.cpuPercent)}`}
          >
            CPU {formatCpu(metrics.cpuPercent)}
          </span>
        ) : (
          <Dot tone={toneOf(session)} small />
        )}
        <strong className="text-sm font-book text-surface-11">{session.process}</strong>
        {!running && <span className="font-book text-surface-11">{exitedState(session)}</span>}
        <span>{formatDuration((session.endedAt ?? now) - session.startedAt)}</span>
        {running && metrics && (
          <>
            <i className="mx-[1px] h-[12px] w-[1px] bg-surface-5 max-[760px]:hidden" />
            {!highCpu && <span className="max-[760px]:hidden">CPU {formatCpu(metrics.cpuPercent)}</span>}
            <span>{formatBytes(metrics.memoryBytes)}</span>
          </>
        )}
      </button>
      {primaryPort !== undefined && (
        <button
          className="self-center rounded-sm px-[5px] py-[3px] font-sans text-sm leading-[inherit] tabular-nums text-accent-10 hover:text-accent-11 focus:outline-none"
          type="button"
          onClick={() => openPort(primaryPort)}
          title={`Open ${address(urlForPort(primaryPort))} in ${browserLabel(browser)}`}
        >
          :{primaryPort}
        </button>
      )}
    </div>
  )
}

export function PendingSessionInspector({
  project,
  process,
  cmd,
  onClose,
}: {
  project: string
  process: string
  cmd: string
  onClose: () => void
}) {
  return (
    <aside
      className="absolute top-0 right-0 bottom-[28px] z-[8] flex w-[min(360px,calc(100%-32px))] animate-[inspector-in_140ms_ease-out] flex-col border-l border-surface-6 bg-surface-2/82 shadow-[-14px_0_36px_#0006] backdrop-blur-xl"
      aria-label={`${process} session details`}
    >
      <header className="flex min-h-[58px] flex-none items-center justify-between border-b border-surface-5 px-[14px] py-[10px]">
        <div>
          <h2 className="m-0 text-lg font-semibold">{process}</h2>
          <span className="text-xs text-surface-9">{displayName(project)}</span>
        </div>
        <button
          className="grid size-[26px] place-items-center rounded-md text-[20px] leading-none text-surface-9 hover:bg-surface-a4 hover:text-surface-12"
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ×
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className={SECTION}>
          <div className="mb-[12px] flex items-center gap-[7px] text-sm">
            <Dot tone="idle" small />
            <strong className="font-book">not started</strong>
          </div>
          <Button variant="primary" className="mb-[12px]" onClick={() => actions.start(project, process)}>
            Start
          </Button>
          <dl className="m-0 grid grid-cols-[68px_minmax(0,1fr)] gap-x-[10px] gap-y-[7px] text-sm">
            <Detail label="Command" value={cmd} mono />
          </dl>
          <ProcessDescription project={project} process={process} />
        </section>
        <ProcessAdvancedSettings project={project} process={process} />
      </div>
    </aside>
  )
}

export function SessionInspector({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const now = useNow(session.status === "running")
  const allHistory = useStore((state) => state.history)
  const historyEnabled = useStore((state) => state.settings.sessionHistory.enabled)
  const history = useMemo(
    () => allHistory.filter((entry) => entry.id === session.id).slice(0, 8),
    [allHistory, session.id],
  )
  const metrics = session.metrics
  const metricHistory = useStore((state) => state.metricHistory[session.id] ?? NO_METRIC_HISTORY)
  const requestConfirm = useStore((state) => state.requestConfirm)
  const running = session.status === "running"
  const browser = useStore((state) => {
    const project = state.projects.find((item) => item.name === session.project)
    return project?.processes.find((item) => item.name === session.process)?.browser ?? project?.browser
  })
  const connId = connIdOf(session.id)
  // null means the machine's server predates sharing; the QR dialog hides the share tiles then.
  const tailscale = useStore((state) => connectionOf(state.connections, connId).tailscale)
  const tailnetSharingEnabled = useStore(
    (state) => connectionOf(state.connections, connId).settings.links.tailnetSharing,
  )
  const {
    openPort,
    copyPort,
    linkForPort,
    urlForPort,
    qrLinksForPort,
    isLoopbackOnly,
    browser: resolvedBrowser,
  } = usePortLinks(connId, metrics, browser)

  return (
    <aside
      className="absolute top-0 right-0 bottom-[28px] z-[8] flex w-[min(360px,calc(100%-32px))] animate-[inspector-in_140ms_ease-out] flex-col border-l border-surface-6 bg-surface-2/82 shadow-[-14px_0_36px_#0006] backdrop-blur-xl"
      aria-label={`${session.process} session details`}
    >
      <header className="flex min-h-[58px] flex-none items-center justify-between border-b border-surface-5 px-[14px] py-[10px]">
        <div>
          <h2 className="m-0 text-lg font-semibold">{session.process}</h2>
          <span className="text-xs text-surface-9">{displayName(session.project)}</span>
        </div>
        <button
          className="grid size-[26px] place-items-center rounded-md text-[20px] leading-none text-surface-9 hover:bg-surface-a4 hover:text-surface-12"
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ×
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className={SECTION}>
          <div className="mb-[12px] flex items-center gap-[7px] text-sm">
            <Dot tone={toneOf(session)} small />
            <span className="text-surface-9">State</span>
            <strong className="font-book">{inspectorState(session)}</strong>
          </div>
          {session.exitDiagnosis && (
            <p className="mb-[12px] rounded-md bg-danger-a3 px-[8px] py-[7px] text-sm leading-snug text-danger-11">
              {session.exitDiagnosis.message}
            </p>
          )}
          <div className="mb-[12px] flex gap-2">
            <Button
              variant={!running ? "primary" : "default"}
              disabled={running}
              onClick={() => actions.start(session.project, session.process)}
            >
              Start
            </Button>
            <Button
              disabled={!running}
              onClick={() => requestConfirm({ action: "restart", project: session.project, process: session.process })}
            >
              Restart
            </Button>
            <Button
              disabled={!running}
              onClick={() => requestConfirm({ action: "stop", project: session.project, process: session.process })}
            >
              Stop
            </Button>
          </div>
          <dl className="m-0 grid grid-cols-[68px_minmax(0,1fr)] gap-x-[10px] gap-y-[7px] text-sm">
            <Detail label="Uptime" value={formatDuration((session.endedAt ?? now) - session.startedAt)} />
            <Detail label="Started" value={formatDate(session.startedAt)} />
            {session.pid !== undefined && <Detail label="PID" value={String(session.pid)} mono />}
            <Detail label="Command" value={session.cmd} mono />
          </dl>
          <ProcessDescription project={session.project} process={session.process} />
        </section>

        {metrics && (
          <ResourceMetrics
            sessionId={session.id}
            metrics={metrics}
            history={metricHistory}
            running={running}
            endedAt={session.endedAt}
          />
        )}

        {running && metrics && metrics.ports.length > 0 && (
          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Ports</h3>
            <div className={STACK}>
              {metrics.ports.map((port) => {
                const link = linkForPort(port)
                const kind = { local: "Local", lan: "LAN", tailscale: "Tailscale", custom: "Custom", direct: "Direct" }[
                  link.kind
                ]
                return (
                  <div
                    key={port}
                    className="relative flex min-h-[44px] items-center gap-2 rounded-md bg-surface-a2 py-1.5 pr-1.5 pl-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-base font-medium tabular-nums text-surface-12">:{port}</div>
                      <div className="mt-0.5 truncate text-2xs text-surface-8" title={link.url}>
                        {kind} · {address(link.url)}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-0.5">
                      <IconButton
                        className="size-[28px]"
                        title={`Copy ${link.url}`}
                        aria-label={`Copy link for port ${port}`}
                        onClick={() => copyPort(port)}
                      >
                        <Copy className="size-[14px]" aria-hidden="true" />
                      </IconButton>
                      <PortQrButton
                        port={port}
                        links={qrLinksForPort(port)}
                        loopbackOnly={isLoopbackOnly(port)}
                        connId={connId}
                        session={session.id}
                        tailscale={tailscale}
                        tailnetSharingEnabled={tailnetSharingEnabled}
                      />
                      <IconButton
                        className="size-[28px]"
                        title={`Open ${address(urlForPort(port))} in ${browserLabel(resolvedBrowser)}`}
                        aria-label={`Open port ${port} in ${browserLabel(resolvedBrowser)}`}
                        onClick={() => openPort(port)}
                      >
                        <ExternalLink className="size-[14px]" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </div>
                )
              })}
            </div>
            {metrics.ports.some(isLoopbackOnly) && (
              <div className="mt-2.5 flex items-start gap-2 rounded-md bg-warning-a2 px-2.5 py-2 text-xs leading-normal text-warning-11">
                <Info className="mt-px size-[14px] flex-none" aria-hidden="true" />
                <div>
                  <strong className="font-book">Local only.</strong> Bind the dev server to <code>0.0.0.0</code> for
                  phone access. Try <code>vite --host 0.0.0.0</code> or <code>next dev --hostname 0.0.0.0</code>.
                </div>
              </div>
            )}
          </section>
        )}

        <section className={SECTION}>
          <h3 className={SECTION_TITLE}>Previous runs</h3>
          {!historyEnabled && <p className={EMPTY}>Enable session history in Settings to keep local run summaries.</p>}
          {historyEnabled && history.length === 0 && <p className={EMPTY}>No previous runs yet.</p>}
          {history.length > 0 && (
            <div className={STACK}>
              {history.map((entry) => (
                <HistoryRow key={entry.runId} entry={entry} />
              ))}
            </div>
          )}
        </section>
        <ProcessAdvancedSettings project={session.project} process={session.process} />
      </div>
    </aside>
  )
}

export type QrLink = { kind: "lan" | "tailscale"; host: string; url: string }

function PortQrButton({
  port,
  links,
  loopbackOnly,
  connId,
  session,
  tailscale,
  tailnetSharingEnabled,
}: {
  port: number
  links: QrLink[]
  loopbackOnly: boolean
  connId: string
  session: SessionId
  tailscale: TailscaleState | null
  tailnetSharingEnabled: boolean
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
          <PortQrDialog
            port={port}
            links={links}
            loopbackOnly={loopbackOnly}
            connId={connId}
            session={session}
            tailscale={tailscale}
            tailnetSharingEnabled={tailnetSharingEnabled}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  )
}

/** The full port dialog opened from an already-live share outside the inspector. */
export function ActiveShareQrDialog({ share, onClose }: { share: ActiveShare; onClose: () => void }) {
  const session = useStore((state) => state.sessions.find((item) => item.id === share.session))
  const tailscale = useStore((state) => connectionOf(state.connections, share.connId).tailscale)
  const tailnetSharingEnabled = useStore(
    (state) => connectionOf(state.connections, share.connId).settings.links.tailnetSharing,
  )
  const { qrLinksForPort, isLoopbackOnly } = usePortLinks(share.connId, session?.metrics)

  return (
    <PortQrDialog
      port={share.port}
      links={qrLinksForPort(share.port)}
      loopbackOnly={isLoopbackOnly(share.port)}
      connId={share.connId}
      session={share.session}
      tailscale={tailscale}
      tailnetSharingEnabled={tailnetSharingEnabled}
      initialKey={`share:${share.kind}`}
      onClose={onClose}
    />
  )
}

export function PortQrDialog({
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
  /** Reach tile selected when the dialog opens, e.g. an active share from the status bar. */
  initialKey?: string
  onClose: () => void
}) {
  const shares = useSharesFor(connId)
  const showNotice = useStore((state) => state.showNotice)
  // The server keeps one share per port, so whichever tile matches its kind is the live one.
  const share = shares.find((item) => item.port === port)
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey ?? null)
  const [pendingKind, setPendingKind] = useState<PortShareKind | null>(null)
  const [qr, setQr] = useState<string | null>(null)

  // Address tiles and a live share tile are the same thing to the QR: a URL to
  // encode. Keying by a stable id (not the URL) lets a share tile stay selected
  // while its URL goes from absent to real.
  const options = [
    ...links.map((link) => ({ key: link.url, url: link.url })),
    ...(share === undefined ? [] : [{ key: `share:${share.kind}`, url: share.url }]),
  ]
  const fallback = options[0] ?? null
  const activeKey = selectedKey ?? fallback?.key ?? null
  const selected = options.find((option) => option.key === activeKey) ?? null
  const url = selected?.url ?? null
  // Public Funnel links stay available to everyone. The opt-in only reveals
  // private Serve links; an existing tailnet share also remains visible so it
  // can be stopped rather than hidden.
  const shareKinds: PortShareKind[] =
    tailnetSharingEnabled || share?.kind === "tailnet" ? ["tailnet", "public"] : ["public"]

  // sharePort is fire-and-forget: success arrives as the share appearing in
  // store state, failure only as a global error in the status bar. The pending
  // flag bridges that gap, and the timeout (generous, because funnel can mint
  // a cert on first use) keeps a failed share from spinning here forever.
  useEffect(() => {
    if (pendingKind === null) return
    if (share?.kind === pendingKind) {
      setPendingKind(null)
      setSelectedKey(`share:${pendingKind}`)
      return
    }
    const timer = setTimeout(() => setPendingKind(null), 30_000)
    return () => clearTimeout(timer)
  }, [pendingKind, share])

  const selectReach = (key: string): void => setSelectedKey(key)

  const turnOn = (kind: PortShareKind): void => {
    setSelectedKey(kind === "public" ? "share:public" : null)
    setPendingKind(kind)
    actions.sharePort(connId, port, kind, session)
  }

  const requestPublic = (): void => setSelectedKey("share:public")

  const copySelected = (): void => {
    if (selected === null) return
    void navigator.clipboard.writeText(selected.url).then(
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
        label={`QR code for port ${port}`}
        className="w-[min(400px,100%)]"
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <DialogHeader title={`Open :${port} on another device`} />
        <DialogBody className="items-center">
          {links.length === 0 && share === undefined && (tailscale === null || shareKinds.length === 0) ? (
            <p className="m-0 py-8 text-center text-sm leading-normal text-surface-9">
              No LAN or Tailscale address was detected for this machine.
            </p>
          ) : (
            <>
              <div className="grid w-full grid-cols-2 gap-2">
                {links.map((link) => (
                  <button
                    key={link.url}
                    type="button"
                    className={cx(
                      "min-w-0 rounded-md border px-2.5 py-2 text-left",
                      link.url === activeKey
                        ? "border-accent-8 bg-accent-a3 text-surface-12"
                        : "border-surface-5 bg-surface-a2 text-surface-10 hover:bg-surface-a3",
                    )}
                    onClick={() => selectReach(link.url)}
                  >
                    <strong className="block text-xs font-semibold">
                      {link.kind === "lan" ? "Local network" : "Tailscale"}
                    </strong>
                    <span className="block truncate font-mono text-2xs" title={link.host}>
                      {link.host}
                    </span>
                  </button>
                ))}
                {tailscale !== null &&
                  shareKinds.map((kind) => (
                    <ShareTile
                      key={kind}
                      kind={kind}
                      tailscale={tailscale}
                      share={share}
                      pending={pendingKind === kind}
                      selected={activeKey === `share:${kind}`}
                      onSelect={() => selectReach(`share:${kind}`)}
                      onTurnOn={() => turnOn(kind)}
                      onRequestPublic={requestPublic}
                    />
                  ))}
              </div>
              {selected === null ? (
                <div className="grid size-[220px] place-content-center justify-items-center gap-2 rounded-md border border-dashed border-surface-5 bg-surface-a2 px-6 text-center text-xs leading-normal text-surface-8">
                  <QrCode className="size-8 text-surface-7" aria-hidden="true" />
                  <span>
                    {activeKey === "share:public" ? "Available after publishing" : "No reachable address yet"}
                  </span>
                </div>
              ) : qr === null ? (
                <div className="grid size-[220px] place-items-center text-xs text-surface-9">Generating QR…</div>
              ) : (
                <img
                  src={qr}
                  alt={`QR code for ${selected.url}`}
                  className="size-[220px] rounded-md bg-white"
                  width={220}
                  height={220}
                />
              )}
              {activeKey !== null && (
                <div className="flex w-full items-center gap-1.5 rounded-md bg-surface-a2 py-1 pr-1 pl-2.5">
                  <code
                    className={cx(
                      "min-w-0 flex-1 truncate bg-transparent! p-0! text-xs",
                      selected === null ? "text-surface-7" : "text-surface-10",
                    )}
                    title={selected?.url}
                  >
                    {selected?.url ?? "Public HTTPS link appears after publishing"}
                  </code>
                  {share !== undefined && activeKey === `share:${share.kind}` ? (
                    <Button
                      variant="danger"
                      className="flex-none px-2! py-1! text-xs!"
                      onClick={() => actions.unsharePort(connId, port)}
                    >
                      Stop sharing
                    </Button>
                  ) : activeKey === "share:public" ? (
                    <button
                      type="button"
                      className="flex-none rounded-sm bg-warning-9 px-2 py-1 text-xs font-semibold text-black enabled:hover:bg-warning-10 disabled:opacity-40"
                      disabled={pendingKind === "public"}
                      onClick={() => turnOn("public")}
                    >
                      {pendingKind === "public" ? "Publishing…" : "Publish"}
                    </button>
                  ) : null}
                  <IconButton
                    className="size-7 flex-none"
                    title={selected === null ? "Link available after publishing" : `Copy ${selected.url}`}
                    aria-label="Copy QR link"
                    disabled={selected === null}
                    onClick={copySelected}
                  >
                    <Copy className="size-[14px]" aria-hidden="true" />
                  </IconButton>
                </div>
              )}
              {loopbackOnly &&
                (tailscale?.running === true ? (
                  <p className="m-0 rounded-md bg-surface-a2 px-2.5 py-2 text-xs leading-normal text-surface-9">
                    This port is bound to localhost only, so the direct addresses above cannot reach it — but Tailscale
                    publishing proxies in to <code>localhost:{port}</code>, so its HTTPS links work as-is.
                  </p>
                ) : (
                  <p className="m-0 rounded-md bg-warning-a2 px-2.5 py-2 text-xs leading-normal text-warning-11">
                    This port is bound to localhost only. Bind it to <code>0.0.0.0</code> before opening it from another
                    device.
                  </p>
                ))}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button data-dialog-action onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}

const SHARE_TILE_TITLE: Record<PortShareKind, string> = { tailnet: "Tailnet HTTPS", public: "Public link" }
/** What turning the tile on buys — reach, not mechanism, since the mechanism is Tailscale's problem. */
const SHARE_TILE_PROMISE: Record<PortShareKind, string> = {
  tailnet: "HTTPS · tailnet members only",
  public: "Anyone with the link",
}

/**
 * One reach mode backed by `tailscale serve`/`funnel` rather than a plain
 * address. Off it offers "Turn on"; live it is selectable like an address tile.
 * Public sharing is staged like every other reach: select it here, then use the
 * warning-coloured Publish action beside the placeholder link.
 */
function ShareTile({
  kind,
  tailscale,
  share,
  pending,
  selected,
  onSelect,
  onTurnOn,
  onRequestPublic,
}: {
  kind: PortShareKind
  tailscale: TailscaleState
  /** The port's single live share, whichever kind it is. */
  share: ActiveShare | undefined
  pending: boolean
  selected: boolean
  onSelect: () => void
  onTurnOn: () => void
  onRequestPublic: () => void
}) {
  if (share?.kind === kind) {
    return (
      <button
        type="button"
        className={cx(
          "min-w-0 rounded-md border px-2.5 py-2 text-left",
          selected
            ? "border-accent-8 bg-accent-a3 text-surface-12"
            : "border-surface-5 bg-surface-a2 text-surface-10 hover:bg-surface-a3",
        )}
        title={shareLabel(kind)}
        onClick={onSelect}
      >
        <span className="flex items-baseline justify-between gap-1">
          <strong className="text-xs font-semibold">{SHARE_TILE_TITLE[kind]}</strong>
          {/* Amber for public: a live funnel is the state worth noticing at a glance. */}
          <span className={cx("text-2xs font-semibold", kind === "public" ? "text-warning-10" : "text-success-10")}>
            Live
          </span>
        </span>
        <span className="block truncate font-mono text-2xs" title={share.url}>
          {address(share.url)}
        </span>
      </button>
    )
  }

  if (pending) {
    return (
      <div className="min-w-0 animate-pulse rounded-md border border-surface-5 bg-surface-a2 px-2.5 py-2 text-surface-10">
        <strong className="block text-xs font-semibold">{SHARE_TILE_TITLE[kind]}</strong>
        <span className="block truncate text-2xs text-surface-8">Turning on…</span>
      </div>
    )
  }

  if (!tailscale.running) {
    // A dead tile stays a plain div: a button that cannot work would be a lie.
    const reason = tailscale.message ?? (tailscale.installed ? "Tailscale is stopped" : "Tailscale is not installed")
    return (
      <div className="min-w-0 rounded-md border border-dashed border-surface-5 px-2.5 py-2 text-surface-8">
        <strong className="block text-xs font-semibold">{SHARE_TILE_TITLE[kind]}</strong>
        <span className="block truncate text-2xs" title={reason}>
          {reason}
        </span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={cx(
        "min-w-0 rounded-md border px-2.5 py-2 text-left",
        selected
          ? "border-accent-8 bg-accent-a3 text-surface-12"
          : "border-surface-5 bg-surface-a2 text-surface-10 hover:bg-surface-a3",
      )}
      onClick={kind === "public" ? onRequestPublic : onTurnOn}
    >
      <span className="flex items-baseline justify-between gap-1">
        <strong className="text-xs font-semibold">{SHARE_TILE_TITLE[kind]}</strong>
        <span className={cx("text-2xs font-semibold", kind === "public" ? "text-surface-8" : "text-accent-10")}>
          {kind === "public" ? "Off" : "Turn on"}
        </span>
      </span>
      <span className="block truncate text-2xs text-surface-8">{SHARE_TILE_PROMISE[kind]}</span>
    </button>
  )
}

/**
 * Editable note on the registry's process entry, saved on blur via a full
 * project upsert. Uncontrolled with a `key` remount so a broadcast that
 * changes the saved text refreshes the field without fighting live edits.
 */
function ProcessDescription({ project, process }: { project: string; process: string }) {
  const registryProject = useStore((state) => state.projects.find((p) => p.name === project))
  const cancelled = useRef(false)
  const proc = registryProject?.processes.find((p) => p.name === process)
  if (registryProject === undefined || proc === undefined) return null
  const saved = proc.description ?? ""

  const commit = (value: string): void => {
    const next = value.trim()
    if (next === saved) return
    actions.upsertProject({
      ...registryProject,
      processes: registryProject.processes.map((p) => {
        if (p.name !== process) return p
        const { description: _, ...rest } = p
        return next === "" ? rest : { ...rest, description: next }
      }),
    })
  }

  return (
    <label className="mt-[12px] flex flex-col gap-[5px]">
      <span className="text-sm text-surface-8">Description</span>
      <textarea
        key={saved}
        rows={2}
        defaultValue={saved}
        spellCheck={false}
        placeholder="What this runs and where it lives…"
        className="w-full min-w-0 resize-none rounded-md border border-surface-5 bg-surface-1 px-2 py-[6px] font-sans text-sm leading-normal text-surface-11 placeholder:text-surface-7 focus:border-accent-9 focus:shadow-[0_0_0_2px_var(--color-accent-a3)] focus:outline-none"
        onBlur={(event) => {
          if (cancelled.current) cancelled.current = false
          else commit(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Swallowed so the window listener doesn't also close the inspector.
            event.stopPropagation()
            cancelled.current = true
            event.currentTarget.value = saved
            event.currentTarget.blur()
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

function ProcessAdvancedSettings({ project, process }: { project: string; process: string }) {
  const registryProject = useStore((state) => state.projects.find((item) => item.name === project))
  const proc = registryProject?.processes.find((item) => item.name === process)
  if (registryProject === undefined || proc === undefined) return null

  const setBrowser = (browser: BrowserChoice | ""): void => {
    actions.upsertProject({
      ...registryProject,
      processes: registryProject.processes.map((item) => {
        if (item.name !== process) return item
        const { browser: _, ...rest } = item
        return browser === "" ? rest : { ...rest, browser }
      }),
    })
  }

  return (
    <>
      <div className="min-h-4 w-full flex-1" aria-hidden="true" />
      <section className="w-full flex-none border-t border-surface-4 p-[14px]">
        <details>
          <summary className="cursor-pointer text-xs font-semibold tracking-caps text-surface-8 uppercase">
            Advanced
          </summary>
          <label className="mt-2 flex flex-col gap-[5px]">
            <span className="text-sm text-surface-8">Browser used</span>
            <BrowserSelect
              value={proc.browser ?? ""}
              inheritLabel={
                registryProject.browser === undefined ? "Use project/global setting" : "Use project setting"
              }
              onChange={(event) => setBrowser(event.target.value as BrowserChoice | "")}
            />
          </label>
        </details>
      </section>
    </>
  )
}

/** `http://host:port` reads as `host:port` in tooltips and port rows. */
function address(url: string): string {
  return url.replace(/^https?:\/\//, "")
}

function exitedState(session: SessionInfo): string {
  return session.exitCode == null ? "Exited" : `Exited · code ${session.exitCode}`
}

function inspectorState(session: SessionInfo): string {
  if (hasHighCpu(session)) return `Running · high CPU (${formatCpu(session.metrics!.cpuPercent)})`
  if (session.status === "running") return "Running"
  return session.exitCode == null ? "Exited" : `Exited with code ${session.exitCode}`
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-surface-8">{label}</dt>
      <dd
        className={cx(
          "m-0 overflow-hidden text-ellipsis whitespace-nowrap text-surface-11",
          mono && "font-mono text-xs",
        )}
        title={value}
      >
        {value}
      </dd>
    </>
  )
}

/** Ports of `.history-result.completed` / `.failed` / `.stopped`. */
const RESULT_TONE: Record<SessionHistoryEntry["reason"], string> = {
  completed: "text-success-10",
  failed: "text-danger-10",
  stopped: "text-surface-8",
}

function HistoryRow({ entry }: { entry: SessionHistoryEntry }) {
  const openHistoryRun = useStore((state) => state.openHistoryRun)
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[7px] rounded-md px-[4px] py-[6px] text-left hover:bg-surface-a3"
      onClick={() => openHistoryRun(entry.runId)}
      title="Open historical run"
    >
      <span className={cx("text-center text-[13px]", RESULT_TONE[entry.reason])}>
        {entry.reason === "completed" ? "✓" : entry.reason === "failed" ? "×" : "■"}
      </span>
      <span className="flex min-w-0 flex-col">
        <strong className="text-sm font-medium">{formatDate(entry.startedAt)}</strong>
        <small className="text-xs text-surface-8">
          {formatDuration(entry.durationMs)} · {entry.reason}
          {entry.exitCode === null ? "" : ` (${entry.exitCode})`} · {formatBytes(entry.totalOutputBytes)} output
        </small>
      </span>
      <span className="text-xs text-surface-8">
        {formatCpu(entry.peakCpuPercent)} · {formatBytes(entry.peakMemoryBytes)}
      </span>
    </button>
  )
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

function formatCpu(value: number): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return `${sameDay ? "Today" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
}
