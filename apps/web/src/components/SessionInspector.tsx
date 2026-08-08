import type { SessionHistoryEntry, SessionInfo, SessionMetrics } from "@hangar/contracts"
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react"
import * as actions from "../actions"
import { openLocalPort } from "../links"
import { hasHighCpu, toneOf } from "../status"
import { type SessionMetricPoint, useStore } from "../store"
import { scrollToMetricPosition, subscribeToMetricSelection } from "../terminals"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { IconButton } from "../ui/IconButton"
import { Dot } from "./Dot"

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
  const highCpu = metrics !== undefined && hasHighCpu(session)
  const primaryPort = metrics?.ports[0]
  const browser = useStore((state) => state.settings.links.browser)
  const showNotice = useStore((state) => state.showNotice)
  const openPort = (port: number) => {
    void openLocalPort(port, browser).catch(() => showNotice(`Could not open port ${port}`))
  }
  return (
    <div className="absolute bottom-0 left-[8px] z-[1] flex h-[28px] w-max items-center gap-[8px] whitespace-nowrap pr-[4px] text-left text-sm leading-tight text-surface-9">
      <button
        className="flex items-center gap-[8px] self-center text-inherit hover:text-surface-12 focus:outline-none"
        type="button"
        onClick={onInspect}
        title="Open session inspector"
      >
        {highCpu
          ? <span
              className="font-semibold tabular-nums text-warning-11"
              title={`High CPU usage: ${formatCpu(metrics.cpuPercent)}`}
              aria-label={`High CPU usage: ${formatCpu(metrics.cpuPercent)}`}
            >
              CPU {formatCpu(metrics.cpuPercent)}
            </span>
          : <Dot tone={toneOf(session)} small />}
        <strong className="text-sm font-book text-surface-11">{session.process}</strong>
        <span>{formatDuration((session.endedAt ?? now) - session.startedAt)}</span>
        {metrics && <>
          <i className="mx-[1px] h-[12px] w-[1px] bg-surface-5 max-[760px]:hidden" />
          {!highCpu && <span className="max-[760px]:hidden">CPU {formatCpu(metrics.cpuPercent)}</span>}
          <span>{formatBytes(metrics.memoryBytes)}</span>
        </>}
      </button>
      {primaryPort !== undefined && <button
        className="self-center rounded-sm px-[5px] py-[3px] font-sans text-sm leading-[inherit] tabular-nums text-accent-10 hover:text-accent-11 focus:outline-none"
        type="button"
        onClick={() => openPort(primaryPort)}
        title={`Open localhost:${primaryPort}`}
      >
        :{primaryPort}
      </button>}
    </div>
  )
}

export function PendingSessionInspector({ project, process, cmd, onClose }: { project: string; process: string; cmd: string; onClose: () => void }) {
  return (
    <aside
      className="absolute top-0 right-0 bottom-[28px] z-[8] flex w-[min(360px,calc(100%-32px))] animate-[inspector-in_140ms_ease-out] flex-col border-l border-surface-6 bg-surface-2/82 shadow-[-14px_0_36px_#0006] backdrop-blur-xl"
      aria-label={`${process} session details`}
    >
      <header className="flex min-h-[58px] flex-none items-center justify-between border-b border-surface-5 px-[14px] py-[10px]">
        <div>
          <h2 className="m-0 text-lg font-semibold">{process}</h2>
          <span className="text-xs text-surface-9">{project}</span>
        </div>
        <button className="grid size-[26px] place-items-center rounded-md text-[20px] leading-none text-surface-9 hover:bg-surface-a4 hover:text-surface-12" type="button" onClick={onClose} aria-label="Close inspector">×</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className={SECTION}>
          <div className="mb-[12px] flex items-center gap-[7px] text-sm">
            <Dot tone="idle" small />
            <strong className="font-book">not started</strong>
          </div>
          <Button variant="primary" className="mb-[12px]" onClick={() => actions.start(project, process)}>Start</Button>
          <dl className="m-0 grid grid-cols-[68px_minmax(0,1fr)] gap-x-[10px] gap-y-[7px] text-sm">
            <Detail label="Command" value={cmd} mono />
          </dl>
        </section>
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
  const browser = useStore((state) => state.settings.links.browser)
  const showNotice = useStore((state) => state.showNotice)
  const requestConfirm = useStore((state) => state.requestConfirm)
  const running = session.status === "running"
  const openPort = (port: number) => {
    void openLocalPort(port, browser).catch(() => showNotice(`Could not open port ${port}`))
  }

  return (
    <aside
      className="absolute top-0 right-0 bottom-[28px] z-[8] flex w-[min(360px,calc(100%-32px))] animate-[inspector-in_140ms_ease-out] flex-col border-l border-surface-6 bg-surface-2/82 shadow-[-14px_0_36px_#0006] backdrop-blur-xl"
      aria-label={`${session.process} session details`}
    >
      <header className="flex min-h-[58px] flex-none items-center justify-between border-b border-surface-5 px-[14px] py-[10px]">
        <div>
          <h2 className="m-0 text-lg font-semibold">{session.process}</h2>
          <span className="text-xs text-surface-9">{session.project}</span>
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className={SECTION}>
          <div className="mb-[12px] flex items-center gap-[7px] text-sm">
            <Dot tone={toneOf(session)} small />
            <span className="text-surface-9">State</span>
            <strong className="font-book">{inspectorState(session)}</strong>
          </div>
          <div className="mb-[12px] flex gap-2">
            <Button variant={!running ? "primary" : "default"} disabled={running} onClick={() => actions.start(session.project, session.process)}>
              Start
            </Button>
            <Button disabled={!running} onClick={() => requestConfirm({ action: "restart", project: session.project, process: session.process })}>
              Restart
            </Button>
            <Button disabled={!running} onClick={() => requestConfirm({ action: "stop", project: session.project, process: session.process })}>
              Stop
            </Button>
          </div>
          <dl className="m-0 grid grid-cols-[68px_minmax(0,1fr)] gap-x-[10px] gap-y-[7px] text-sm">
            <Detail label="Uptime" value={formatDuration((session.endedAt ?? now) - session.startedAt)} />
            <Detail label="Started" value={formatDate(session.startedAt)} />
            {session.pid !== undefined && <Detail label="PID" value={String(session.pid)} mono />}
            <Detail label="Command" value={session.cmd} mono />
          </dl>
        </section>

        {metrics && <ResourceSection sessionId={session.id} metrics={metrics} history={metricHistory} />}

        {metrics && metrics.ports.length > 0 && <section className={SECTION}>
          <h3 className={SECTION_TITLE}>Ports</h3>
          <div className={STACK}>
            {metrics.ports.map((port) => <button
              key={port}
              className="flex items-center justify-between rounded-md border border-surface-5 bg-surface-a2 px-[8px] py-[7px] text-xs text-surface-9 hover:bg-surface-a4 hover:text-accent-10"
              type="button"
              onClick={() => openPort(port)}
            >
              <code className="text-surface-12">:{port}</code><span>Open in browser ↗</span>
            </button>)}
          </div>
        </section>}

        <section className={SECTION}>
          <h3 className={SECTION_TITLE}>Previous runs</h3>
          {!historyEnabled && <p className={EMPTY}>Enable session history in Settings to keep local run summaries.</p>}
          {historyEnabled && history.length === 0 && <p className={EMPTY}>No previous runs yet.</p>}
          {history.length > 0 && <div className={STACK}>{history.map((entry) => <HistoryRow key={entry.runId} entry={entry} />)}</div>}
        </section>
      </div>
    </aside>
  )
}

function inspectorState(session: SessionInfo): string {
  if (hasHighCpu(session)) return `Running · high CPU (${formatCpu(session.metrics!.cpuPercent)})`
  if (session.status === "running") return "Running"
  return session.exitCode == null ? "Exited" : `Exited with code ${session.exitCode}`
}

function ResourceSection({ sessionId, metrics, history }: { sessionId: string; metrics: SessionMetrics; history: SessionMetricPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null)
  const [layout, setLayout] = useState<"grid" | "rows">("grid")
  const showNotice = useStore((state) => state.showNotice)
  const hovered = hoveredIndex === null ? undefined : history[hoveredIndex]

  useEffect(() => subscribeToMetricSelection(sessionId, (range) => {
    if (range === null) {
      setSelectedRange(null)
      return
    }
    const start = history.findIndex((point) => point.sampledAt === range.startSampledAt)
    const end = history.findIndex((point) => point.sampledAt === range.endSampledAt)
    setSelectedRange(start < 0 || end < 0 ? null : [Math.min(start, end), Math.max(start, end)])
  }), [history, sessionId])
  const selectSample = (index: number) => {
    const sample = history[index]
    if (!sample) return
    if (!scrollToMetricPosition(sessionId, sample.sampledAt)) {
      showNotice("That output line is no longer in scrollback")
    }
  }

  const shared = { hoveredIndex, selectedRange, compact: layout === "rows", onHover: setHoveredIndex, onSelect: selectSample }
  return <section className={SECTION} onPointerLeave={() => setHoveredIndex(null)}>
    <div className="mb-[10px] flex items-center justify-between gap-2">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-caps text-surface-9" title="Hover to compare all metrics; click to jump to that point in the terminal">
        Resources · {hovered ? formatTime(hovered.sampledAt) : "last 15 minutes"}
      </h3>
      <IconButton
        className="size-[22px] rounded-sm text-[13px] text-surface-8"
        title={layout === "grid" ? "Switch to compact rows" : "Switch to card grid"}
        aria-label={layout === "grid" ? "Switch to compact rows" : "Switch to card grid"}
        onClick={() => setLayout((current) => current === "grid" ? "rows" : "grid")}
      >
        {layout === "grid" ? "⊞" : "☰"}
      </IconButton>
    </div>
    <div className={cx("grid gap-[7px]", layout === "grid" ? "grid-cols-2" : "grid-cols-1 gap-[4px]")}>
      <Metric label="CPU" value={formatCpu(metrics.cpuPercent)} hoverValue={hovered && formatCpu(hovered.cpuPercent)} peak={`peak ${formatCpu(metrics.peakCpuPercent)}`} values={history.map((point) => point.cpuPercent)} tone="accent" {...shared} />
      <Metric label="Memory" value={formatBytes(metrics.memoryBytes)} hoverValue={hovered && formatBytes(hovered.memoryBytes)} peak={`peak ${formatBytes(metrics.peakMemoryBytes)}`} values={history.map((point) => point.memoryBytes)} tone="success" {...shared} />
      <Metric label="Processes" value={String(metrics.processCount)} hoverValue={hovered && String(hovered.processCount ?? metrics.processCount)} values={history.map((point) => point.processCount ?? metrics.processCount)} tone="accent" {...shared} />
      <Metric label="Output" value={`${formatBytes(metrics.outputBytesPerSecond)}/s`} hoverValue={hovered && `${formatBytes(hovered.outputBytesPerSecond)}/s`} peak={`${formatBytes(metrics.outputBytes)} total`} values={history.map((point) => point.outputBytesPerSecond)} tone="warning" {...shared} />
    </div>
  </section>
}

type MetricProps = {
  label: string
  value: string
  hoverValue?: string
  peak?: string
  values: number[]
  tone: "accent" | "success" | "warning"
  hoveredIndex: number | null
  selectedRange: [number, number] | null
  compact: boolean
  onHover: (index: number) => void
  onSelect: (index: number) => void
}

function Metric({ label, value, hoverValue, peak, values, tone, hoveredIndex, selectedRange, compact, onHover, onSelect }: MetricProps) {
  if (compact) return <div className="grid h-[42px] grid-cols-[48px_62px_minmax(60px,1fr)_auto] items-center gap-[6px] rounded-md border border-surface-5 bg-surface-a2 px-[8px]">
    <span className="text-xs text-surface-9">{label}</span>
    <strong className="text-base font-book tabular-nums text-surface-12">{hoverValue ?? value}</strong>
    <Sparkline compact values={values} tone={tone} hoveredIndex={hoveredIndex} selectedRange={selectedRange} onHover={onHover} onSelect={onSelect} />
    <small className="max-w-[82px] truncate text-right text-2xs text-surface-8" title={peak}>{peak}</small>
  </div>

  return <div className="flex min-h-[100px] flex-col rounded-md border border-surface-5 bg-surface-a2 p-[9px]">
    <span className="text-xs text-surface-9">{label}</span>
    <strong className="mt-[4px] text-xl font-book text-surface-12">{hoverValue ?? value}</strong>
    <Sparkline values={values} tone={tone} hoveredIndex={hoveredIndex} selectedRange={selectedRange} onHover={onHover} onSelect={onSelect} />
    {peak && <small className="mt-auto text-xs text-surface-8">{peak}</small>}
  </div>
}

/** Ports of `.sparkline-accent` / `-success` / `-warning` — the polyline reads `currentColor`. */
const SPARKLINE_TONE = {
  accent: "text-accent-10",
  success: "text-success-10",
  warning: "text-warning-10",
} as const

function Sparkline({ values, tone, hoveredIndex, selectedRange, compact = false, onHover, onSelect }: {
  values: number[]
  tone: "accent" | "success" | "warning"
  hoveredIndex: number | null
  selectedRange: [number, number] | null
  compact?: boolean
  onHover: (index: number) => void
  onSelect: (index: number) => void
}) {
  if (values.length < 2) return <span className={cx("text-2xs text-surface-7", compact ? "m-0" : "my-[10px]")}>collecting…</span>
  const maximum = Math.max(1, ...values)
  const points = values.map((value, index) => {
    const x = index / (values.length - 1) * 100
    const y = 27 - value / maximum * 25
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(" ")
  const hoverX = hoveredIndex === null ? null : hoveredIndex / (values.length - 1) * 100
  const selectionX = selectedRange === null ? null : {
    start: selectedRange[0] / (values.length - 1) * 100,
    end: selectedRange[1] / (values.length - 1) * 100,
  }
  const pointAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    return Math.round(ratio * (values.length - 1))
  }
  return <svg
    className={cx("w-full cursor-crosshair overflow-visible", compact ? "m-0 h-[22px]" : "mt-[5px] mb-[3px] h-[28px]", SPARKLINE_TONE[tone])}
    viewBox="0 0 100 28"
    preserveAspectRatio="none"
    role="button"
    aria-label="Metric history; click to jump to this point in terminal output"
    onPointerMove={(event) => onHover(pointAt(event))}
    onPointerDown={(event) => onSelect(pointAt(event))}
  >
    {selectionX !== null && <rect
      className="pointer-events-none fill-surface-a5"
      x={selectionX.start}
      y="0"
      width={Math.max(1.2, selectionX.end - selectionX.start)}
      height="28"
    />}
    <polyline className="pointer-events-none fill-none stroke-current [stroke-width:1.5] [vector-effect:non-scaling-stroke]" points={points} />
    {hoverX !== null && <line
      className="pointer-events-none stroke-surface-11 opacity-45 [stroke-width:1] [vector-effect:non-scaling-stroke]"
      x1={hoverX}
      x2={hoverX}
      y1="0"
      y2="28"
    />}
  </svg>
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <>
    <dt className="text-surface-8">{label}</dt>
    <dd
      className={cx("m-0 overflow-hidden text-ellipsis whitespace-nowrap text-surface-11", mono && "font-mono text-xs")}
      title={value}
    >
      {value}
    </dd>
  </>
}

/** Ports of `.history-result.completed` / `.failed` / `.stopped`. */
const RESULT_TONE: Record<SessionHistoryEntry["reason"], string> = {
  completed: "text-success-10",
  failed: "text-danger-10",
  stopped: "text-surface-8",
}

function HistoryRow({ entry }: { entry: SessionHistoryEntry }) {
  const openHistoryRun = useStore((state) => state.openHistoryRun)
  return <button type="button" className="grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[7px] rounded-md px-[4px] py-[6px] text-left hover:bg-surface-a3" onClick={() => openHistoryRun(entry.runId)} title="Open historical run">
    <span className={cx("text-center text-[13px]", RESULT_TONE[entry.reason])}>{entry.reason === "completed" ? "✓" : entry.reason === "failed" ? "×" : "■"}</span>
    <span className="flex min-w-0 flex-col">
      <strong className="text-sm font-medium">{formatDate(entry.startedAt)}</strong>
      <small className="text-xs text-surface-8">{formatDuration(entry.durationMs)} · {entry.reason}{entry.exitCode === null ? "" : ` (${entry.exitCode})`} · {formatBytes(entry.totalOutputBytes)} output</small>
    </span>
    <span className="text-xs text-surface-8">{formatCpu(entry.peakCpuPercent)} · {formatBytes(entry.peakMemoryBytes)}</span>
  </button>
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return `${sameDay ? "Today" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
}
