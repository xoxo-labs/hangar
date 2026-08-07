import type { SessionHistoryEntry, SessionInfo, SessionMetrics } from "@hangar/contracts"
import { useEffect, useMemo, useState } from "react"
import { openLocalPort } from "../links"
import { describe, toneOf } from "../status"
import { useStore } from "../store"
import { Dot } from "./Dot"

export function SessionStrip({ session, onInspect }: { session: SessionInfo; onInspect: () => void }) {
  const now = useNow(session.status === "running")
  const metrics = session.metrics
  const primaryPort = metrics?.ports[0]
  const browser = useStore((state) => state.settings.links.browser)
  const showNotice = useStore((state) => state.showNotice)
  const openPort = (port: number) => {
    void openLocalPort(port, browser).catch(() => showNotice(`Could not open port ${port}`))
  }
  return (
    <div className="session-strip">
      <button className="session-strip-details" type="button" onClick={onInspect} title="Open session inspector">
        <Dot tone={toneOf(session)} small />
        <strong>{session.process}</strong>
        <span>{formatDuration((session.endedAt ?? now) - session.startedAt)}</span>
        {metrics && <>
          <i />
          <span>CPU {formatCpu(metrics.cpuPercent)}</span>
          <span>{formatBytes(metrics.memoryBytes)}</span>
        </>}
      </button>
      {primaryPort !== undefined && <button className="session-strip-port" type="button" onClick={() => openPort(primaryPort)} title={`Open localhost:${primaryPort}`}>
        :{primaryPort}
      </button>}
    </div>
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
  const browser = useStore((state) => state.settings.links.browser)
  const showNotice = useStore((state) => state.showNotice)
  const openPort = (port: number) => {
    void openLocalPort(port, browser).catch(() => showNotice(`Could not open port ${port}`))
  }

  return (
    <aside className="session-inspector" aria-label={`${session.process} session details`}>
      <header className="inspector-header">
        <div><h2>{session.process}</h2><span>{session.project}</span></div>
        <button type="button" onClick={onClose} aria-label="Close inspector">×</button>
      </header>
      <div className="inspector-scroll">
        <section className="inspector-summary">
          <div className="inspector-state"><Dot tone={toneOf(session)} small /><strong>{describe(session)}</strong></div>
          <dl className="detail-list">
            <Detail label="Uptime" value={formatDuration((session.endedAt ?? now) - session.startedAt)} />
            <Detail label="Started" value={formatDate(session.startedAt)} />
            {session.pid !== undefined && <Detail label="PID" value={String(session.pid)} mono />}
            <Detail label="Command" value={session.cmd} mono />
          </dl>
        </section>

        {metrics && <ResourceSection metrics={metrics} />}

        {metrics && metrics.ports.length > 0 && <section className="inspector-section">
          <h3>Ports</h3>
          <div className="port-list">
            {metrics.ports.map((port) => <button key={port} type="button" onClick={() => openPort(port)}>
              <code>:{port}</code><span>Open in browser ↗</span>
            </button>)}
          </div>
        </section>}

        <section className="inspector-section">
          <h3>Previous runs</h3>
          {!historyEnabled && <p className="inspector-empty">Enable session history in Settings to keep local run summaries.</p>}
          {historyEnabled && history.length === 0 && <p className="inspector-empty">No previous runs yet.</p>}
          {history.length > 0 && <div className="history-list">{history.map((entry) => <HistoryRow key={entry.runId} entry={entry} />)}</div>}
        </section>
      </div>
    </aside>
  )
}

function ResourceSection({ metrics }: { metrics: SessionMetrics }) {
  return <section className="inspector-section">
    <h3>Resources</h3>
    <div className="metric-grid">
      <Metric label="CPU" value={formatCpu(metrics.cpuPercent)} peak={`peak ${formatCpu(metrics.peakCpuPercent)}`} />
      <Metric label="Memory" value={formatBytes(metrics.memoryBytes)} peak={`peak ${formatBytes(metrics.peakMemoryBytes)}`} />
      <Metric label="Processes" value={String(metrics.processCount)} />
      <Metric label="Output" value={`${formatBytes(metrics.outputBytesPerSecond)}/s`} peak={`${formatBytes(metrics.outputBytes)} total`} />
    </div>
  </section>
}

function Metric({ label, value, peak }: { label: string; value: string; peak?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{peak && <small>{peak}</small>}</div>
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <><dt>{label}</dt><dd className={mono ? "mono" : undefined} title={value}>{value}</dd></>
}

function HistoryRow({ entry }: { entry: SessionHistoryEntry }) {
  return <div className="history-row">
    <span className={`history-result ${entry.reason}`}>{entry.reason === "completed" ? "✓" : entry.reason === "failed" ? "×" : "■"}</span>
    <div><strong>{formatDate(entry.startedAt)}</strong><small>{formatDuration(entry.durationMs)} · {entry.reason}{entry.exitCode === null ? "" : ` (${entry.exitCode})`}</small></div>
    <span>{formatBytes(entry.peakMemoryBytes)}</span>
  </div>
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
