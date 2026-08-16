import { connIdOf, displayName } from "@hangar/client-core"
import type { BrowserChoice, SessionHistoryEntry, SessionInfo } from "@hangar/contracts"
import { Copy, ExternalLink, Info } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import * as actions from "../actions"
import { usePortLinks } from "../hooks/usePortLinks"
import { browserLabel } from "../links"
import { hasHighCpu, toneOf } from "../status"
import { type SessionMetricPoint, connectionOf, useStore } from "../store"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
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
  const {
    openPort,
    copyPort,
    linkForPort,
    urlForPort,
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
                    className="flex min-h-[44px] items-center gap-2 rounded-md bg-surface-a2 py-1.5 pr-1.5 pl-2.5"
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
