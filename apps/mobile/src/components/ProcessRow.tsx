/**
 * One process, wherever it is listed: under a project on a machine, or under a
 * project that spans machines. Two lines and no box — a phone shows a dozen of
 * these at once, and a card each turned the list into a stack of panels you had
 * to scroll past rather than read down.
 *
 * The whole row opens the session; `View` is the same trip, spelled out. Both
 * exist on purpose: the row-tap is what a thumb does, the button is what a
 * first-time eye finds — and it stays there for an exited process, where the
 * session view still holds the buffer it left behind.
 */

import type { ProjectProcess } from "@hangar/contracts"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { restart, start, stop } from "../actions"
import { sessionIdFor, sessionOf } from "../state"
import { describe, formatCpu, formatMemory, toneOf } from "../status"
import { useStore } from "../store"
import { color, mono, radius, space } from "../theme"
import { Button } from "./Button"
import { Dot } from "./Dot"

export function ProcessRow({
  project,
  process,
  /** The machine this process runs on, when the list mixes several. */
  machine,
  /** The last row of a group drops its separator: nothing follows it to divide from. */
  last = false,
}: {
  /** Scoped project name — the actions and the session id both need the scope. */
  project: string
  process: ProjectProcess
  machine?: string
  last?: boolean
}) {
  const id = sessionIdFor(project, process.name)
  const session = useStore((store) => sessionOf(store.world, id))
  const router = useRouter()
  const running = session?.status === "running"
  const open = (): void => router.push({ pathname: "/session/[id]", params: { id } })

  return (
    <Pressable style={({ pressed }) => [styles.row, last && styles.lastRow, pressed && styles.pressed]} onPress={open}>
      <View style={styles.line}>
        <Dot tone={toneOf(session)} size={7} />
        <Text style={styles.name} numberOfLines={1}>
          {process.name}
        </Text>
        {machine !== undefined && (
          <Text style={styles.chip} numberOfLines={1}>
            {machine}
          </Text>
        )}
        {running && session?.metrics !== undefined && (
          <Text style={styles.metrics}>
            {formatCpu(session.metrics.cpuPercent)} · {formatMemory(session.metrics.memoryBytes)}
          </Text>
        )}
      </View>
      <View style={styles.line}>
        <Text style={styles.meta} numberOfLines={1}>
          {describe(session)} · {process.cmd === "" ? "interactive shell" : process.cmd}
        </Text>
        <View style={styles.actions}>
          <Button
            label="View"
            variant="ghost"
            mono
            onPress={open}
            accessibilityLabel={`View ${process.name} session`}
          />
          {running ? (
            <>
              <Button label="Restart" variant="ghost" onPress={() => restart(project, process.name)} />
              <Button label="Stop" variant="ghost" onPress={() => stop(project, process.name)} />
            </>
          ) : (
            <Button label="Start" variant="ghost" onPress={() => start(project, process.name)} />
          )}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The hairline is the row separator; the last row's is hidden by the list.
  row: {
    paddingVertical: 9,
    paddingHorizontal: 4,
    gap: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  lastRow: { borderBottomWidth: 0 },
  pressed: { backgroundColor: color.raised },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1, color: color.text, fontSize: 15, fontWeight: "600" },
  chip: {
    flexShrink: 1,
    color: color.faint,
    fontSize: 10,
    fontFamily: mono,
    backgroundColor: color.panel,
    borderRadius: radius.chip,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: "hidden",
  },
  // Pushes the metrics to the right edge whether or not a chip is there.
  metrics: { marginLeft: "auto", color: color.muted, fontSize: 11, fontFamily: mono },
  meta: { flex: 1, color: color.muted, fontSize: 11, fontFamily: mono },
  actions: { flexDirection: "row", alignItems: "center", gap: space.gap + 2 },
})
