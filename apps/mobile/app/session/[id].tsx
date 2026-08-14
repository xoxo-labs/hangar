import { parseScoped, scoped } from "@hangar/client-core"
import { Stack, useLocalSearchParams } from "expo-router"
import { useMemo, useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { restart, start, stop } from "../../src/actions"
import { type Span, softWrap, visibleSpans } from "../../src/ansi"
import { Button } from "../../src/components/Button"
import { Dot } from "../../src/components/Dot"
import { sessionOf } from "../../src/state"
import { describe, formatCpu, formatMemory, toneOf } from "../../src/status"
import { useStore } from "../../src/store"
import { color, mono, space } from "../../src/theme"

/** More than a phone can scroll through; the ring buffer holds the rest. */
const MAX_LINES = 1_500
/** Anything closer than this to the end counts as "at the bottom". */
const FOLLOW_SLACK = 48

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const sessionKey = id ?? ""
  const session = useStore((store) => sessionOf(store.world, sessionKey))
  const output = useStore((store) => store.world.output[sessionKey] ?? "")
  const [following, setFollowing] = useState(true)
  const scroller = useRef<ScrollView>(null)

  const { connId, value } = parseScoped(sessionKey)
  const slash = value.indexOf("/")
  const project = scoped(connId, slash === -1 ? value : value.slice(0, slash))
  const process = slash === -1 ? value : value.slice(slash + 1)
  const lines = useMemo(() => visibleSpans(output, MAX_LINES), [output])
  const running = session?.status === "running"

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: process }} />
      <View style={styles.header}>
        <Dot tone={toneOf(session)} size={7} />
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
