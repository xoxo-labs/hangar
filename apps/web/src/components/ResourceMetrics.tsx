import type { SessionMetrics } from "@hangar/contracts"
import { Check, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { type MetricRange, useMetricTimeline } from "../hooks/useMetricTimeline"
import type { SessionMetricPoint } from "../store"
import { cx } from "../ui/cx"
import { IconButton } from "../ui/IconButton"

const SECTION = "border-b border-surface-4 p-[14px]"
const METRIC_RANGE_OPTIONS: Array<[MetricRange, string]> = [
  ["5m", "Last 5 minutes"],
  ["15m", "Last 15 minutes"],
  ["1h", "Last hour"],
  ["session", "Full session"],
]

export function ResourceMetrics({ sessionId, metrics, history: allHistory }: {
  sessionId: string
  metrics: SessionMetrics
  history: SessionMetricPoint[]
}) {
  const [layout, setLayout] = useState<"grid" | "rows">("grid")
  const { history, coverage, range, setRange, hoveredIndex, setHoveredIndex, selectedRange, selectSample } =
    useMetricTimeline(sessionId, allHistory)
  const hovered = hoveredIndex === null ? undefined : history[hoveredIndex]
  const shared = {
    coverage,
    hoveredIndex,
    selectedRange,
    compact: layout === "rows",
    onHover: setHoveredIndex,
    onSelect: selectSample,
  }

  return <section className={SECTION} onPointerLeave={() => setHoveredIndex(null)}>
    <div className="mb-[10px] flex items-center justify-between gap-2">
      <div className="min-w-0">
        <h3 className="m-0 truncate text-xs font-semibold uppercase tracking-caps text-surface-9" title="Hover to compare all metrics; click to jump to that point in the terminal">
          Resources{hovered ? ` · ${formatTime(hovered.sampledAt)}` : ""}
        </h3>
        <span className="mt-0.5 block truncate whitespace-nowrap text-2xs text-surface-8" title="Live · sampled every 2 seconds">
          Live · 2s samples
        </span>
      </div>
      <div className="flex items-center gap-1">
        <MetricRangeMenu value={range} onChange={setRange} />
        <IconButton
          className="size-[22px] rounded-sm text-[13px] text-surface-8"
          title={layout === "grid" ? "Switch to compact rows" : "Switch to card grid"}
          aria-label={layout === "grid" ? "Switch to compact rows" : "Switch to card grid"}
          onClick={() => setLayout((current) => current === "grid" ? "rows" : "grid")}
        >
          {layout === "grid" ? "⊞" : "☰"}
        </IconButton>
      </div>
    </div>
    <div className={cx("grid gap-[7px]", layout === "grid" ? "grid-cols-2" : "grid-cols-1 gap-[4px]")}>
      <Metric label="CPU" value={formatCpu(metrics.cpuPercent)} hoverValue={hovered && formatCpu(hovered.cpuPercent)} peak={`peak ${formatCpu(metrics.peakCpuPercent)}`} values={history.map((point) => point.cpuPercent)} tone="accent" {...shared} />
      <Metric label="Memory" value={formatBytes(metrics.memoryBytes)} hoverValue={hovered && formatBytes(hovered.memoryBytes)} peak={`peak ${formatBytes(metrics.peakMemoryBytes)}`} values={history.map((point) => point.memoryBytes)} tone="success" {...shared} />
      <Metric label="Processes" value={String(metrics.processCount)} hoverValue={hovered && String(hovered.processCount ?? metrics.processCount)} values={history.map((point) => point.processCount ?? metrics.processCount)} tone="accent" {...shared} />
      <Metric label="Output" value={`${formatBytes(metrics.outputBytesPerSecond)}/s`} hoverValue={hovered && `${formatBytes(hovered.outputBytesPerSecond)}/s`} peak={`${formatBytes(metrics.outputBytes)} total`} values={history.map((point) => point.outputBytesPerSecond)} tone="warning" {...shared} />
    </div>
  </section>
}

function MetricRangeMenu({ value, onChange }: { value: MetricRange; onChange: (range: MetricRange) => void }) {
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.current?.open) {
        details.current.open = false
        details.current.querySelector("summary")?.focus()
      }
    }
    window.addEventListener("pointerdown", dismiss)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", dismiss)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  return <details ref={details} className="relative">
    <summary className="flex h-[24px] cursor-pointer list-none items-center gap-1 rounded-sm px-1.5 text-xs text-surface-9 hover:bg-surface-a4 hover:text-surface-12 [&::-webkit-details-marker]:hidden">
      {value === "session" ? "Session" : value}
      <ChevronDown className="size-[12px]" aria-hidden="true" />
    </summary>
    <div className="absolute top-[28px] right-0 z-20 flex min-w-[150px] flex-col rounded-md border border-surface-5 bg-surface-3 p-1 shadow-[0_10px_30px_#0008]">
      {METRIC_RANGE_OPTIONS.map(([range, label]) => <button
        key={range}
        type="button"
        className="flex items-center gap-2 rounded-sm px-2 py-1 text-left text-base text-surface-11 hover:bg-surface-a3 hover:text-surface-12"
        onClick={() => {
          onChange(range)
          if (details.current) details.current.open = false
        }}
      >
        <Check className={cx("size-[13px]", value === range ? "opacity-100" : "opacity-0")} aria-hidden="true" />
        {label}
      </button>)}
    </div>
  </details>
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
  coverage: number
  compact: boolean
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}

function Metric({ label, value, hoverValue, peak, values, tone, hoveredIndex, selectedRange, coverage, compact, onHover, onSelect }: MetricProps) {
  if (compact) return <div className="grid h-[42px] grid-cols-[48px_62px_minmax(60px,1fr)_auto] items-center gap-[6px] rounded-md border border-surface-5 bg-surface-a2 px-[8px]">
    <span className="text-xs text-surface-9">{label}</span>
    <strong className="text-base font-book tabular-nums text-surface-12">{hoverValue ?? value}</strong>
    <Sparkline compact values={values} tone={tone} hoveredIndex={hoveredIndex} selectedRange={selectedRange} coverage={coverage} onHover={onHover} onSelect={onSelect} />
    <small className="max-w-[82px] truncate text-right text-2xs text-surface-8" title={peak}>{peak}</small>
  </div>

  return <div className="flex min-h-[100px] flex-col rounded-md border border-surface-5 bg-surface-a2 p-[9px]">
    <span className="text-xs text-surface-9">{label}</span>
    <strong className="mt-[4px] text-xl font-book text-surface-12">{hoverValue ?? value}</strong>
    <Sparkline values={values} tone={tone} hoveredIndex={hoveredIndex} selectedRange={selectedRange} coverage={coverage} onHover={onHover} onSelect={onSelect} />
    {peak && <small className="mt-auto text-xs text-surface-8">{peak}</small>}
  </div>
}

const SPARKLINE_TONE = {
  accent: "text-accent-10",
  success: "text-success-10",
  warning: "text-warning-10",
} as const

/** A fixed time window: newest samples stay at the right edge and move left as new data arrives. */
function Sparkline({ values, tone, hoveredIndex, selectedRange, coverage, compact = false, onHover, onSelect }: {
  values: number[]
  tone: "accent" | "success" | "warning"
  hoveredIndex: number | null
  selectedRange: [number, number] | null
  coverage: number
  compact?: boolean
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}) {
  const plotWidth = coverage * 100
  const plotStart = 100 - plotWidth
  const maximum = Math.max(1, ...values)
  const xAt = (index: number) => plotStart + index / (values.length - 1) * plotWidth
  const points = values.length < 2 ? "" : values.map((value, index) => {
    const y = 27 - value / maximum * 25
    return `${xAt(index).toFixed(2)},${y.toFixed(2)}`
  }).join(" ")
  const hoverX = hoveredIndex === null || values.length < 2 ? null : xAt(hoveredIndex)
  const selectionX = selectedRange === null || values.length < 2 ? null : {
    start: xAt(selectedRange[0]),
    end: xAt(selectedRange[1]),
  }
  const pointAt = (event: ReactPointerEvent<SVGSVGElement>): number | null => {
    if (coverage === 0 || values.length < 2) return null
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const start = 1 - coverage
    if (position < start) return null
    return Math.round((position - start) / coverage * (values.length - 1))
  }

  return <svg
    className={cx("w-full cursor-crosshair overflow-visible", compact ? "m-0 h-[22px]" : "mt-[5px] mb-[3px] h-[28px]", SPARKLINE_TONE[tone])}
    viewBox="0 0 100 28"
    preserveAspectRatio="none"
    role="button"
    aria-label="Metric history; click to jump to this point in terminal output"
    onPointerMove={(event) => onHover(pointAt(event))}
    onPointerDown={(event) => {
      const index = pointAt(event)
      if (index !== null) onSelect(index)
    }}
  >
    {coverage < 1 && <rect className="pointer-events-none fill-surface-a3" x="0" y="0" width={plotStart} height="28" />}
    {coverage > 0 && coverage < 1 && <line
      className="pointer-events-none stroke-surface-7 [stroke-dasharray:2_2] [stroke-width:1] [vector-effect:non-scaling-stroke]"
      x1={plotStart}
      x2={plotStart}
      y1="0"
      y2="28"
    />}
    {selectionX !== null && <rect
      className="pointer-events-none fill-surface-a5"
      x={selectionX.start}
      y="0"
      width={Math.max(1.2, selectionX.end - selectionX.start)}
      height="28"
    />}
    {points && <polyline className="pointer-events-none fill-none stroke-current [stroke-width:1.5] [vector-effect:non-scaling-stroke]" points={points} />}
    {hoverX !== null && <line
      className="pointer-events-none stroke-surface-11 opacity-45 [stroke-width:1] [vector-effect:non-scaling-stroke]"
      x1={hoverX}
      x2={hoverX}
      y1="0"
      y2="28"
    />}
  </svg>
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
