import { Stack, useGlobalSearchParams, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useRef } from "react"
import { StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SessionView } from "../src/components/SessionView"
import { startConnections } from "../src/connections"
import { adoptOnResize, type LayoutMode } from "../src/layout"
import { useStore } from "../src/store"
import { color, space } from "../src/theme"
import { useLayoutMode } from "../src/useLayoutMode"

/**
 * Wide enough for a machine's name and a process line with its actions, narrow
 * enough that the log beside it keeps most of the window — the same proportion
 * the desktop app's sidebar takes.
 */
const LEFT_PANE_WIDTH = 360

export default function RootLayout() {
  useEffect(() => {
    startConnections()
  }, [])

  const mode = useLayoutMode()
  useAdoption(mode)
  const regular = mode === "regular"

  // The stack is mounted the same way in both shapes and only its box changes:
  // rebuilding the navigator on a resize would drop wherever you had navigated
  // to, which is exactly what a Split View drag must not do.
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={regular ? styles.left : styles.full}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: color.bg },
            headerTintColor: color.accent,
            headerTitleStyle: { color: color.text, fontSize: 16 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: "Hangar" }} />
          <Stack.Screen name="pair" options={{ title: "Pair a machine", presentation: "modal" }} />
          <Stack.Screen name="machine/[id]" options={{ title: "Machine" }} />
          <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
          <Stack.Screen name="address/[id]" options={{ title: "Address" }} />
        </Stack>
      </View>
      {regular && <SessionPane />}
    </View>
  )
}

/** The right pane: whatever is selected, or the reason nothing is. */
function SessionPane() {
  const selected = useStore((store) => store.selectedSessionId)
  // No navigation bar over this pane, so it clears the status bar itself.
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.pane, { paddingTop: insets.top }]}>
      {selected === null ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Select a process</Text>
          <Text style={styles.emptyBody}>Pick one from the list and its output runs here.</Text>
        </View>
      ) : (
        // Keyed by session: a new subject starts at the tail of its own log
        // rather than inheriting the last one's scroll position.
        <SessionView key={selected} id={selected} heading />
      )}
    </View>
  )
}

/**
 * Carries state across the breakpoint. The width can change under any screen —
 * a Split View drag, an iPad turning — so the decision lives in `adoptOnResize`
 * and this hook only supplies what it needs and does what it says.
 */
function useAdoption(mode: LayoutMode): void {
  const router = useRouter()
  const segments = useSegments()
  // Every `[id]` route answers here, so the segment is what says which one.
  const params = useGlobalSearchParams<{ id?: string }>()
  const select = useStore((store) => store.select)
  const selection = useStore((store) => store.selectedSessionId)
  const previous = useRef(mode)

  const routeSessionId = segments[0] === "session" && typeof params.id === "string" ? params.id : null

  useEffect(() => {
    const was = previous.current
    previous.current = mode
    if (was === mode) return
    const next = adoptOnResize(was, mode, routeSessionId, selection)
    if (next.selection !== selection) select(next.selection)
    if (next.pop && router.canGoBack()) router.back()
  }, [mode, routeSessionId, selection, select, router])
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: color.bg },
  full: { flex: 1 },
  left: {
    width: LEFT_PANE_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.line,
  },
  pane: { flex: 1, backgroundColor: color.bg },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: space.gutter },
  emptyTitle: { color: color.soft, fontSize: 15, fontWeight: "600" },
  emptyBody: { color: color.faint, fontSize: 13, textAlign: "center" },
})
