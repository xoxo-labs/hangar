import { displayName } from "@hangar/client-core"
import type { HistoryOutputEvent, SessionHistoryEntry } from "@hangar/contracts"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import * as actions from "../actions"
import { type HistoryReplay, useStore } from "../store"
import { currentTerminalTheme } from "../terminals"
import { cx } from "../ui/cx"
import { Dot } from "./Dot"

/** Exported so the command palette labels archived runs with the same glyph/tone. */
export const RESULT = {
  completed: { icon: "✓", label: "Completed", tone: "text-success-10", dot: "done" },
  failed: { icon: "×", label: "Failed", tone: "text-danger-10", dot: "failed" },
  stopped: { icon: "■", label: "Stopped", tone: "text-surface-9 dark:text-surface-10", dot: "idle" },
} as const

export function HistoryWorkspace({ runId }: { runId: string | null }) {
  const entry = useStore((state) => (runId === null ? undefined : state.history.find((item) => item.runId === runId)))
  if (runId !== null && entry) return <RunDetail entry={entry} />
  return <HistoryOverview />
}

function HistoryOverview() {
  const history = useStore((state) => state.history)
  const enabled = useStore((state) => state.settings.sessionHistory.enabled)
  const openRun = useStore((state) => state.openHistoryRun)
  const openSettings = useStore((state) => state.openSettings)
  const showNotice = useStore((state) => state.showNotice)
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<"all" | SessionHistoryEntry["reason"]>("all")

  const deleteRun = (entry: SessionHistoryEntry) => {
    actions.deleteHistoryRun(entry.runId)
    showNotice(`Deleted ${displayName(entry.project)} / ${entry.process} run`)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return history.filter(
      (entry) =>
        (result === "all" || entry.reason === result) &&
        (needle === "" || `${displayName(entry.project)} ${entry.process} ${entry.cmd}`.toLowerCase().includes(needle)),
    )
  }, [history, query, result])
  const groups = useMemo(() => groupByDay(filtered), [filtered])
  const failed = history.filter((entry) => entry.reason === "failed").length
  const totalDuration = history.reduce((sum, entry) => sum + entry.durationMs, 0)

  return (
    <div className="absolute inset-0 overflow-y-auto bg-surface-1">
      <div className="mx-auto w-full max-w-[1080px] px-[30px] py-[28px]">
        <header className="mb-[24px] flex items-start justify-between gap-5">
          <div>
            <div className="mb-[5px] flex items-center gap-[9px]">
              <span className="text-[20px] text-surface-8" aria-hidden="true">
                ◷
              </span>
              <h2 className="m-0 text-2xl font-strong tracking-[-0.015em]">Session history</h2>
            </div>
            <p className="m-0 text-base text-surface-9">Past runs, resource peaks and captured output on this Mac.</p>
          </div>
          {!enabled && (
            <button
              type="button"
              className="rounded-md border border-accent-7 bg-accent-a3 px-[10px] py-[6px] text-sm text-accent-11 hover:bg-accent-a4"
              onClick={openSettings}
            >
              Enable history
            </button>
          )}
        </header>

        <div className="mb-[20px] grid grid-cols-3 gap-[8px]">
          <Stat label="Saved runs" value={String(history.length)} />
          <Stat label="Failed" value={String(failed)} danger={failed > 0} />
          <Stat label="Recorded time" value={formatDuration(totalDuration)} />
        </div>

        <div className="mb-[18px] flex items-center gap-[8px]">
          <label className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute top-1/2 left-[10px] -translate-y-1/2 text-[12px] text-surface-8">
              ⌕
            </span>
            <input
              className="h-[34px] w-full rounded-md border border-surface-6 bg-surface-2 pr-[10px] pl-[30px] text-base text-surface-12 outline-none placeholder:text-surface-8 focus:border-accent-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search project, process or command…"
            />
          </label>
          <select
            className="h-[34px] rounded-md border border-surface-6 bg-surface-2 px-[9px] text-sm text-surface-11 outline-none"
            value={result}
            onChange={(event) => setResult(event.target.value as typeof result)}
          >
            <option value="all">All results</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>

        {!enabled && history.length === 0 && (
          <Empty
            title="History is off"
            detail="Enable session history in Settings to retain local run summaries and resource timelines."
          />
        )}
        {enabled && history.length === 0 && (
          <Empty title="No previous runs" detail="Completed, failed and stopped sessions will appear here." />
        )}
        {history.length > 0 && filtered.length === 0 && (
          <Empty title="No matching runs" detail="Try another search or result filter." />
        )}

        <div className="flex flex-col gap-[20px]">
          {groups.map(([day, entries]) => (
            <section key={day}>
              <h3 className="mb-[7px] px-[3px] text-xs font-semibold tracking-caps text-surface-8 uppercase">{day}</h3>
              <div className="overflow-hidden rounded-lg border border-surface-5 bg-surface-2">
                {entries.map((entry, index) => (
                  <HistoryRow
                    key={entry.runId}
                    entry={entry}
                    last={index === entries.length - 1}
                    onOpen={() => openRun(entry.runId)}
                    onDelete={() => deleteRun(entry)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function HistoryRow({
  entry,
  last,
  onOpen,
  onDelete,
}: {
  entry: SessionHistoryEntry
  last: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const result = RESULT[entry.reason]
  return (
    // A wrapper rather than nesting: the delete control cannot live inside the
    // row, which is itself a button.
    <div className={cx("group relative", !last && "border-b border-surface-4")}>
      <button
        type="button"
        className="grid w-full grid-cols-[minmax(180px,1.25fr)_100px_115px_130px_18px] items-center gap-[14px] px-[14px] py-[11px] text-left hover:bg-surface-a3"
        onClick={onOpen}
      >
        <div className="flex min-w-0 items-center gap-[10px]">
          <span
            className={cx(
              "grid size-[22px] flex-none place-items-center rounded-full bg-surface-a3 text-[12px]",
              result.tone,
            )}
          >
            {result.icon}
          </span>
          <span className="flex min-w-0 flex-col">
            <strong className="truncate text-base font-book text-surface-12">
              {displayName(entry.project)} <span className="font-normal text-surface-8">/</span> {entry.process}
            </strong>
            <code className="truncate text-xs text-surface-8">{entry.cmd}</code>
          </span>
        </div>
        <span className={cx("text-xs", result.tone)}>
          {result.label}
          {entry.exitCode === null ? "" : ` · ${entry.exitCode}`}
        </span>
        <span className="text-xs tabular-nums text-surface-9 dark:text-surface-10">
          {formatDuration(entry.durationMs)}
        </span>
        <span className="text-xs tabular-nums text-surface-8 dark:text-surface-9">
          {formatCpu(entry.peakCpuPercent)} · {formatBytes(entry.peakMemoryBytes)}
        </span>
        <span className="text-[15px] text-surface-7 group-hover:text-surface-11">›</span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${entry.process} run from history`}
        title="Delete this run from history"
        className="absolute top-1/2 right-[38px] grid size-[24px] -translate-y-1/2 place-items-center rounded-md bg-surface-2 text-[12px] text-surface-8 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-danger-a3 hover:text-danger-11 focus-visible:opacity-100"
        onClick={onDelete}
      >
        ✕
      </button>
    </div>
  )
}

function RunDetail({ entry }: { entry: SessionHistoryEntry }) {
  const openHistory = useStore((state) => state.openHistory)
  const showNotice = useStore((state) => state.showNotice)
  const timeline = useStore((state) => state.historyMetrics[entry.runId])
  // Older servers still inline the timeline on the entry; newer ones serve it
  // on demand, keeping 10 800-sample runs out of every state broadcast.
  const samples = entry.metricSamples ?? timeline?.samples ?? []
  const timelineLoading = entry.metricSamples === undefined && (timeline === undefined || timeline.loading)
  const replay = useStore((state) => state.historyReplays[entry.runId])
  const [sampleIndex, setSampleIndex] = useState(Math.max(0, samples.length - 1))
  const sample = samples[sampleIndex]
  const replayCutoff =
    samples.length > 1 && sampleIndex < samples.length - 1 ? (sample?.sampledAt ?? entry.endedAt) : entry.endedAt
  const result = RESULT[entry.reason]

  useEffect(() => {
    if (entry.hasReplay) actions.loadHistoryReplay(entry.runId)
    if (entry.metricSamples === undefined) actions.loadHistoryMetrics(entry.runId)
  }, [entry.hasReplay, entry.metricSamples, entry.runId])
  // The timeline arrives after mount now; park the cursor at the end, where it
  // started when the samples rode the entry itself.
  useEffect(() => {
    setSampleIndex(Math.max(0, samples.length - 1))
  }, [samples.length])
  const revealLog = () => {
    if (entry.logPath && window.hangarDesktop) void window.hangarDesktop.revealPath(entry.logPath)
    else if (entry.logPath) void navigator.clipboard.writeText(entry.logPath).then(() => showNotice("Log path copied"))
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-surface-1">
      <div className="mx-auto w-full max-w-[1040px] px-[30px] py-[24px]">
        <button type="button" className="mb-[17px] text-sm text-surface-9 hover:text-surface-12" onClick={openHistory}>
          ‹ All history
        </button>
        <header className="mb-[20px] flex items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-[5px] flex items-center gap-[9px]">
              <Dot tone={result.dot} />
              <h2 className="m-0 truncate text-xl font-strong">
                {displayName(entry.project)} <span className="font-normal text-surface-8">/</span> {entry.process}
              </h2>
              <span className="px-[3px] py-[2px] text-2xs font-semibold tracking-wider text-surface-9 uppercase">
                Historical
              </span>
            </div>
            <p className="m-0 text-sm text-surface-9">
              {formatFullDate(entry.startedAt)} · {formatDuration(entry.durationMs)} ·{" "}
              <span className={result.tone}>{result.label}</span>
            </p>
          </div>
          <div className="flex flex-none items-center gap-[8px]">
            <button
              type="button"
              className="rounded-md border border-surface-6 bg-surface-a3 px-[11px] py-[7px] text-sm text-surface-11 hover:border-danger-7 hover:bg-danger-a3 hover:text-danger-11"
              onClick={() => {
                actions.deleteHistoryRun(entry.runId)
                showNotice(`Deleted ${displayName(entry.project)} / ${entry.process} run`)
              }}
            >
              Delete run
            </button>
            <button
              type="button"
              className="rounded-md bg-accent-9 px-[11px] py-[7px] text-sm font-book text-white hover:bg-accent-10"
              onClick={() => actions.start(entry.project, entry.process)}
            >
              ▶ Run again
            </button>
          </div>
        </header>

        <div className="mb-[12px] grid grid-cols-4 gap-[8px]">
          <Stat label="Duration" value={formatDuration(entry.durationMs)} />
          <Stat label="Peak CPU" value={formatCpu(entry.peakCpuPercent)} />
          <Stat label="Peak memory" value={formatBytes(entry.peakMemoryBytes)} />
          <Stat label="Output" value={formatBytes(entry.totalOutputBytes)} />
        </div>

        <section className="mb-[12px] rounded-lg border border-surface-5 bg-surface-2 p-[16px]">
          <div className="mb-[14px] flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold text-surface-12">Run timeline</h3>
              <p className="mt-[3px] mb-0 text-xs text-surface-8">Move across the timeline to rewind resource usage.</p>
            </div>
            {sample && (
              <time className="font-mono text-xs tabular-nums text-accent-10">
                +{formatDuration(replayCutoff - entry.startedAt)}
              </time>
            )}
          </div>
          {timelineLoading ? (
            <div className="grid h-[120px] place-items-center rounded-md border border-dashed border-surface-5 text-sm text-surface-8">
              Loading timeline…
            </div>
          ) : samples.length === 0 ? (
            <div className="grid h-[120px] place-items-center rounded-md border border-dashed border-surface-5 text-center text-sm leading-normal text-surface-8">
              <span>
                This run predates timeline capture.
                <br />
                Start a new run to record resource samples.
              </span>
            </div>
          ) : samples.length === 1 ? (
            <div>
              <div className="grid grid-cols-4 gap-[8px]">
                <MetricSnapshot label="CPU" value={formatCpu(sample?.cpuPercent ?? 0)} />
                <MetricSnapshot label="Memory" value={formatBytes(sample?.memoryBytes ?? 0)} />
                <MetricSnapshot label="Processes" value={String(sample?.processCount ?? 0)} />
                <MetricSnapshot label="Output rate" value={`${formatBytes(sample?.outputBytesPerSecond ?? 0)}/s`} />
              </div>
              <p className="mt-[10px] mb-0 text-xs text-surface-8">
                The run ended before a second timeline sample could be recorded.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-[8px]">
                <Timeline
                  label="CPU"
                  value={formatCpu(sample?.cpuPercent ?? 0)}
                  values={samples.map((item) => item.cpuPercent)}
                  index={sampleIndex}
                  onSelect={setSampleIndex}
                  tone="accent"
                />
                <Timeline
                  label="Memory"
                  value={formatBytes(sample?.memoryBytes ?? 0)}
                  values={samples.map((item) => item.memoryBytes)}
                  index={sampleIndex}
                  onSelect={setSampleIndex}
                  tone="success"
                />
                <Timeline
                  label="Processes"
                  value={String(sample?.processCount ?? 0)}
                  values={samples.map((item) => item.processCount)}
                  index={sampleIndex}
                  onSelect={setSampleIndex}
                  tone="accent"
                />
                <Timeline
                  label="Output rate"
                  value={`${formatBytes(sample?.outputBytesPerSecond ?? 0)}/s`}
                  values={samples.map((item) => item.outputBytesPerSecond)}
                  index={sampleIndex}
                  onSelect={setSampleIndex}
                  tone="warning"
                />
              </div>
              <input
                aria-label="Rewind run timeline"
                className="mt-[12px] h-[3px] w-full cursor-ew-resize accent-accent-9"
                type="range"
                min={0}
                max={samples.length - 1}
                value={sampleIndex}
                onChange={(event) => setSampleIndex(Number(event.target.value))}
              />
            </>
          )}
        </section>

        <ArchivedOutput entry={entry} replay={replay} cutoff={replayCutoff} />

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)] gap-[12px]">
          <section className="rounded-lg border border-surface-5 bg-surface-2 p-[16px]">
            <h3 className="mb-[12px] text-xs font-semibold tracking-caps text-surface-9 uppercase">Run details</h3>
            <dl className="m-0 grid grid-cols-[80px_minmax(0,1fr)] gap-x-[12px] gap-y-[9px] text-sm">
              <Detail label="Command" value={entry.cmd} mono />
              <Detail label="Started" value={formatFullDate(entry.startedAt)} />
              <Detail label="Ended" value={formatFullDate(entry.endedAt)} />
              <Detail label="Exit code" value={entry.exitCode === null ? "—" : String(entry.exitCode)} />
              <Detail label="Run ID" value={displayName(entry.runId)} mono />
            </dl>
          </section>
          <section className="rounded-lg border border-surface-5 bg-surface-2 p-[16px]">
            <h3 className="mb-[12px] text-xs font-semibold tracking-caps text-surface-9 uppercase">
              External log file
            </h3>
            {entry.logPath ? (
              <>
                <p className="mb-[12px] line-clamp-2 break-all font-mono text-xs leading-normal text-surface-9">
                  {entry.logPath}
                </p>
                <button
                  type="button"
                  className="rounded-md border border-surface-6 bg-surface-a3 px-[9px] py-[6px] text-sm text-surface-11 hover:bg-surface-a4"
                  onClick={revealLog}
                >
                  {window.hangarDesktop ? "Reveal log in Finder" : "Copy log path"}
                </button>
              </>
            ) : (
              <p className="m-0 text-sm leading-normal text-surface-8">
                Terminal logging was disabled for this run. Resource history is still available.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function ArchivedOutput({
  entry,
  replay,
  cutoff,
}: {
  entry: SessionHistoryEntry
  replay: HistoryReplay | undefined
  cutoff: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const terminalSettings = useStore((state) => state.settings.terminal)
  const visibleEvents = useMemo(
    () => replay?.events.filter((event) => event.timestamp <= cutoff) ?? [],
    [cutoff, replay?.events],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !entry.hasReplay) return
    const terminal = new Terminal({
      fontSize: terminalSettings.fontSize,
      fontFamily: terminalSettings.fontFamily,
      scrollback: 10_000,
      cursorBlink: false,
      cursorStyle: "bar",
      disableStdin: true,
      theme: currentTerminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    terminalRef.current = terminal
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {}
    })
    observer.observe(container)
    const frame = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {}
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      terminalRef.current = null
      terminal.dispose()
    }
  }, [entry.hasReplay, replay?.loading, terminalSettings.fontFamily, terminalSettings.fontSize])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || replay?.loading) return
    const timer = setTimeout(() => {
      terminal.write("\x1bc" + visibleEvents.map((event: HistoryOutputEvent) => event.data).join(""), () =>
        terminal.scrollToBottom(),
      )
    }, 35)
    return () => clearTimeout(timer)
  }, [replay?.loading, visibleEvents])

  const outputTime = Math.max(0, cutoff - entry.startedAt)
  return (
    <section className="mb-[12px] overflow-hidden rounded-lg border border-surface-5 bg-surface-2">
      <header className="flex min-h-[42px] items-center justify-between border-b border-surface-5 px-[13px]">
        <div className="flex items-center gap-[8px]">
          <span className="size-[6px] rounded-full bg-surface-8" />
          <h3 className="m-0 text-xs font-semibold tracking-caps text-surface-10 uppercase">Terminal output</h3>
          <span className="px-[2px] py-[2px] text-2xs text-surface-8">read only</span>
        </div>
        {entry.hasReplay && (
          <time className="font-mono text-xs tabular-nums text-surface-8">through +{formatDuration(outputTime)}</time>
        )}
      </header>
      {!entry.hasReplay ? (
        <div className="grid h-[230px] place-items-center bg-surface-1 text-center text-sm leading-normal text-surface-8">
          <span>
            This run predates output capture.
            <br />
            New historical runs save timestamped ANSI output.
          </span>
        </div>
      ) : replay?.loading || replay === undefined ? (
        <div className="grid h-[230px] place-items-center bg-surface-1 text-sm text-surface-8">
          Loading captured output…
        </div>
      ) : (
        <>
          <div ref={containerRef} className="terminal-pane h-[300px] bg-surface-1 px-[8px] py-[6px]" />
          {replay.truncated && (
            <p className="m-0 border-t border-warning-6 bg-warning-a2 px-[10px] py-[6px] text-xs text-warning-11">
              Replay reached the 10 MB history limit; later output was not captured.
            </p>
          )}
          {replay.events.length === 0 && (
            <p className="m-0 border-t border-surface-5 px-[10px] py-[6px] text-xs text-surface-8">
              This run produced no terminal output.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function Timeline({
  label,
  value,
  values,
  index,
  onSelect,
  tone,
}: {
  label: string
  value: string
  values: number[]
  index: number
  onSelect: (index: number) => void
  tone: "accent" | "success" | "warning"
}) {
  const maximum = Math.max(1, ...values) * 1.1
  const points = values
    .map((item, itemIndex) => `${(itemIndex / (values.length - 1)) * 100},${34 - (item / maximum) * 30}`)
    .join(" ")
  const x = (index / (values.length - 1)) * 100
  const pointAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    onSelect(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (values.length - 1)))
  }
  return (
    <div className="rounded-md border border-surface-5 bg-surface-a2 p-[10px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-surface-8">{label}</span>
        <strong className="text-md font-book tabular-nums">{value}</strong>
      </div>
      <svg
        className={cx(
          "mt-[7px] h-[36px] w-full cursor-ew-resize",
          tone === "accent" ? "text-accent-10" : tone === "success" ? "text-success-10" : "text-warning-10",
        )}
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        onPointerMove={pointAt}
        onPointerDown={pointAt}
      >
        <polyline
          points={points}
          className="pointer-events-none fill-none stroke-current [stroke-width:1.5] [vector-effect:non-scaling-stroke]"
        />
        <line
          x1={x}
          x2={x}
          y1="0"
          y2="36"
          className="pointer-events-none stroke-surface-11 opacity-50 [stroke-width:1] [vector-effect:non-scaling-stroke]"
        />
      </svg>
    </div>
  )
}

function MetricSnapshot({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-surface-5 bg-surface-a2 px-[10px] py-[12px]">
      <span className="block text-2xs text-surface-8">{label}</span>
      <strong className="mt-[4px] block text-md font-book tabular-nums">{value}</strong>
    </div>
  )
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-surface-5 bg-surface-2 px-[13px] py-[11px]">
      <span className="block text-2xs font-semibold tracking-caps text-surface-8 uppercase">{label}</span>
      <strong
        className={cx(
          "mt-[4px] block text-xl font-semibold tabular-nums",
          danger ? "text-danger-10" : "text-surface-12",
        )}
      >
        {value}
      </strong>
    </div>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-surface-8">{label}</dt>
      <dd className={cx("m-0 truncate text-surface-11", mono && "font-mono text-xs")} title={value}>
        {value}
      </dd>
    </>
  )
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-surface-5 text-center">
      <div>
        <span className="text-[25px] text-surface-7">◷</span>
        <h3 className="mt-[8px] mb-[4px] text-base font-book">{title}</h3>
        <p className="m-0 max-w-[360px] text-sm leading-normal text-surface-8">{detail}</p>
      </div>
    </div>
  )
}

function groupByDay(entries: SessionHistoryEntry[]): Array<[string, SessionHistoryEntry[]]> {
  const groups = new Map<string, SessionHistoryEntry[]>()
  for (const entry of entries) {
    const date = new Date(entry.startedAt)
    const today = new Date()
    const yesterday = new Date(Date.now() - 86_400_000)
    const key =
      date.toDateString() === today.toDateString()
        ? "Today"
        : date.toDateString() === yesterday.toDateString()
          ? "Yesterday"
          : date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups.entries()]
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
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
