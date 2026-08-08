import { useEffect, useMemo, useState } from "react"
import { type SessionMetricPoint, useStore } from "../store"
import { scrollToMetricPosition, subscribeToMetricSelection } from "../terminals"

export type MetricRange = "5m" | "15m" | "1h" | "session"

const RANGE_MS: Record<Exclude<MetricRange, "session">, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
}

/** Shared range, hover, terminal-selection and jump behavior for all metric charts. */
export function useMetricTimeline(sessionId: string, allHistory: SessionMetricPoint[]) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null)
  const [range, setRangeState] = useState<MetricRange>("15m")
  const showNotice = useStore((state) => state.showNotice)

  const history = useMemo(() => {
    if (range === "session" || allHistory.length === 0) return allHistory
    const latest = allHistory[allHistory.length - 1]!.sampledAt
    const cutoff = latest - RANGE_MS[range]
    return allHistory.filter((point) => point.sampledAt >= cutoff)
  }, [allHistory, range])

  const coverage = useMemo(() => {
    if (range === "session") return 1
    if (history.length < 2) return 0
    const elapsed = history[history.length - 1]!.sampledAt - history[0]!.sampledAt
    return Math.min(1, elapsed / RANGE_MS[range])
  }, [history, range])

  useEffect(() => subscribeToMetricSelection(sessionId, (selection) => {
    if (selection === null) {
      setSelectedRange(null)
      return
    }
    const start = history.findIndex((point) => point.sampledAt === selection.startSampledAt)
    const end = history.findIndex((point) => point.sampledAt === selection.endSampledAt)
    setSelectedRange(start < 0 || end < 0 ? null : [Math.min(start, end), Math.max(start, end)])
  }), [history, sessionId])

  const setRange = (next: MetricRange) => {
    setRangeState(next)
    setHoveredIndex(null)
    setSelectedRange(null)
  }

  const selectSample = (index: number) => {
    const sample = history[index]
    if (!sample) return
    if (!scrollToMetricPosition(sessionId, sample.sampledAt)) {
      showNotice("That output line is no longer in scrollback")
    }
  }

  return {
    history,
    coverage,
    range,
    setRange,
    hoveredIndex,
    setHoveredIndex,
    selectedRange,
    selectSample,
  }
}
