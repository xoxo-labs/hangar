/**
 * One session: what it is doing, what you can do to it, and everything it has
 * said. The same component either way — pushed as a screen on a phone, or held
 * in the right pane at iPad widths — so there is one log view to keep honest
 * and one place a follow-the-tail bug can hide.
 */

import { useMemo, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { restart, start, stop } from "../actions"
import { type Span, softWrap, visibleSpans } from "../ansi"
import { sessionOf, splitSessionId } from "../state"
import { describe, formatCpu, formatMemory, toneOf } from "../status"
import { useStore } from "../store"
import { color, mono, space } from "../theme"
import { Button } from "./Button"
import { Dot } from "./Dot"

/** More than a phone can scroll through; the ring buffer holds the rest. */
const MAX_LINES = 1_500
/** Anything closer than this to the end counts as "at the bottom". */
const FOLLOW_SLACK = 48

export function SessionView({
  id,
  /**
   * Name the process in the header. The pane has no navigation bar to put the
   * title in; the pushed screen does, and would say it twice.
   */
  heading = false,
}: {
  id: string
  heading?: boolean
}) {
  const session = useStore((store) => sessionOf(store.world, id))
  const output = useStore((store) => store.world.output[id] ?? "")
  const [following, setFollowing] = useState(true)
  const scroller = useRef<ScrollView>(null)

  const { project, process } = splitSessionId(id)
  const lines = useMemo(() => visibleSpans(output, MAX_LINES), [output])
  const running = session?.status === "running"

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Dot tone={toneOf(session)} size={7} />
        {heading && (
          <Text style={styles.title} numberOfLines={1}>
            {process}
          </Text>
        )}
        <Text style={styles.headerText} numberOfLines={1}>
          {describe(session)}
          {session?.metrics && running
            ? ` · ${formatCpu(session.metrics.cpuPercent)} · ${formatMemory(session.metrics.memoryBytes)}`
            : ""}
        </Text>
        {running ? (
          <>
            <Button label="Stop" variant="danger" onPress={() => stop(project, process)} />
            <Button label="Restart" onPress={() => restart(project, process)} />
          </>
        ) : (
          <Button label="Start" variant="accent" onPress={() => start(project, process)} />
        )}
      </View>

      {/*
       * Log lines wrap; this view never scrolls sideways. A terminal's own
       * answer to a long line is a horizontal scroller, but on a phone that
       * fights the navigator: a sideways drag is the back gesture, so panning
       * the log threw you out to the process list instead of moving the text.
       * Hence soft wrapping, and hence the belt and braces below — the
       * ScrollView is told twice that it has no horizontal axis.
       */}
      <ScrollView
        ref={scroller}
        style={styles.log}
        contentContainerStyle={styles.logBody}
        horizontal={false}
        directionalLockEnabled
        alwaysBounceHorizontal={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={64}
        onScroll={({ nativeEvent }) => {
          const distance =
            nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height
          setFollowing(distance <= FOLLOW_SLACK)
        }}
        onContentSizeChange={() => {
          if (following) scroller.current?.scrollToEnd({ animated: false })
        }}
      >
        {lines.length === 0 ? (
          <Text style={styles.placeholder}>No output yet.</Text>
        ) : (
          lines.map((spans, index) => (
            // Log lines have no identity of their own; their position is the key.
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are positional
            <LogLine key={index} spans={spans} />
          ))
        )}
      </ScrollView>

      {!following && (
        <View style={styles.jumpWrap}>
          <Button
            label="Jump to latest"
            onPress={() => {
              setFollowing(true)
              scroller.current?.scrollToEnd({ animated: true })
            }}
          />
        </View>
      )}
    </View>
  )
}

/**
 * One line. The outer <Text> owns the wrapping and the spans are nested inside
 * it, because only a single text block lays its runs out as continuous text —
 * a row of sibling <Text>s would each wrap on their own and stair-step.
 */
function LogLine({ spans }: { spans: Span[] }) {
  if (spans.length === 0) return <Text style={styles.line}> </Text>
  return (
    <Text style={styles.line} selectable>
      {spans.map((span, index) => (
        <Text
          // Spans are positional too: they are a rendering of the line, not data.
          // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
          key={index}
          style={[
            span.color === undefined ? null : { color: span.color },
            span.bold === true && styles.bold,
            span.underline === true && styles.underline,
          ]}
        >
          {softWrap(span.text)}
        </Text>
      ))}
    </Text>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: space.gutter,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  title: { flexShrink: 1, color: color.text, fontSize: 15, fontWeight: "600" },
  headerText: { flex: 1, color: color.muted, fontSize: 12 },
  log: { flex: 1 },
  // `width: 100%` is what pins the content to the viewport: without it the
  // content view takes the width of its widest child and the log spills out.
  logBody: { width: "100%", padding: 12, paddingBottom: 32 },
  line: { width: "100%", color: color.soft, fontFamily: mono, fontSize: 11, lineHeight: 15 },
  bold: { fontWeight: "700" },
  underline: { textDecorationLine: "underline" },
  placeholder: { color: color.faint, fontSize: 13 },
  jumpWrap: { position: "absolute", bottom: 24, alignSelf: "center" },
})
