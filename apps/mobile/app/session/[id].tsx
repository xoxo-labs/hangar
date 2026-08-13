import { parseScoped, scoped } from "@hangar/client-core"
import { Stack, useLocalSearchParams } from "expo-router"
import { useRef, useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { restart, start, stop } from "../../src/actions"
import { visibleLines } from "../../src/ansi"
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
  const lines = visibleLines(output, MAX_LINES)
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

      <ScrollView
        ref={scroller}
        style={styles.log}
        contentContainerStyle={styles.logBody}
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
          lines.map((line, index) => (
            // Log lines have no identity of their own; their position is the key.
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are positional
            <Text key={index} style={styles.line} selectable>
              {line === "" ? " " : line}
            </Text>
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
  logBody: { padding: 12, paddingBottom: 32 },
  line: { color: color.soft, fontFamily: mono, fontSize: 11, lineHeight: 15 },
  placeholder: { color: color.faint, fontSize: 13 },
  jumpWrap: { position: "absolute", bottom: 24, alignSelf: "center" },
})
