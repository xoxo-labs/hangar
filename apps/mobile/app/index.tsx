import { buildSidebarModel, displayName, flatEntries, type SidebarEntry } from "@hangar/client-core"
import { Stack, useRouter } from "expo-router"
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Button } from "../src/components/Button"
import { Dot } from "../src/components/Dot"
import { ProcessRow } from "../src/components/ProcessRow"
import { connections } from "../src/connections"
import type { ViewMode } from "../src/mode"
import { processCounts } from "../src/state"
import { CONNECTION_LABEL, connectionTone } from "../src/status"
import { type Machine, machineLabel, useStore } from "../src/store"
import { color, mono, radius, space } from "../src/theme"

export default function HomeScreen() {
  const machines = useStore((store) => store.machines)
  const ready = useStore((store) => store.ready)
  const mode = useStore((store) => store.mode)
  const router = useRouter()

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityLabel="Pair a machine" onPress={() => router.push("/pair")} hitSlop={12}>
              <Text style={styles.add}>+</Text>
            </Pressable>
          ),
        }}
      />
      {machines.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{ready ? "No paired machines yet" : "Loading connections…"}</Text>
          <Text style={styles.emptyBody}>Scan the QR from Hangar's Connections settings on your Mac.</Text>
          <Button label="Pair a machine" variant="accent" onPress={() => router.push("/pair")} />
        </View>
      ) : (
        <>
          <ModeSwitch mode={mode} />
          {mode === "machines" ? <MachineList machines={machines} /> : <ProjectList machines={machines} />}
        </>
      )}
    </View>
  )
}

/**
 * The same machines, cut two ways. By machine is where you go to see one Mac's
 * state; by project is where you go when a repo lives on two of them and you
 * only care what is running, wherever it runs.
 */
function ModeSwitch({ mode }: { mode: ViewMode }) {
  const setMode = useStore((store) => store.setMode)
  return (
    <View style={styles.switch}>
      {(["machines", "projects"] as const).map((option) => (
        <Pressable
          key={option}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === option }}
          onPress={() => setMode(option)}
          style={[styles.segment, mode === option && styles.segmentOn]}
        >
          <Text style={[styles.segmentLabel, mode === option && styles.segmentLabelOn]}>
            {option === "machines" ? "Machines" : "Projects"}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function MachineList({ machines }: { machines: Machine[] }) {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      {machines.map((machine) => (
        <MachineCard key={machine.config.id} machine={machine} />
      ))}
      <Text style={styles.footnote}>Long-press a machine to rename it, change its address, retry or remove it.</Text>
    </ScrollView>
  )
}

/**
 * Every project on every machine, one entry per repo: a project registered on
 * two machines collapses into a single block listing both machines' processes,
 * exactly as the desktop sidebar groups them (`buildSidebarModel`).
 */
function ProjectList({ machines }: { machines: Machine[] }) {
  // Select the world itself, never a derived object: zustand compares with
  // Object.is, so a selector that builds a fresh value re-renders forever.
  const world = useStore((store) => store.world)
  // Grouping a phone-sized project list is cheap enough to redo on render;
  // memoising it would only add a dependency array to keep honest.
  const labels = new Map(machines.map((machine) => [machine.config.id, machineLabel(machine)]))
  const connIds = machines.map((machine) => machine.config.id)
  const entries = flatEntries(buildSidebarModel(connIds, world.projects, ""))

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyBody}>
          {machines.some((machine) => machine.status === "connected")
            ? "No projects on your machines yet."
            : "Waiting for your machines to answer…"}
        </Text>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {entries.map((entry) => (
        <ProjectBlock key={entry.key} entry={entry} labels={labels} />
      ))}
    </ScrollView>
  )
}

function ProjectBlock({ entry, labels }: { entry: SidebarEntry; labels: Map<string, string> }) {
  const rows = entry.parts.flatMap((part) =>
    part.processes.map((process) => ({ project: part.project.name, process, machine: labels.get(part.connId) })),
  )
  return (
    <View style={styles.project}>
      <Text style={styles.projectName}>{displayName(entry.parts[0].project.name)}</Text>
      <View>
        {rows.map((row, index) => (
          <ProcessRow
            key={`${row.project}/${row.process.name}`}
            project={row.project}
            process={row.process}
            machine={row.machine}
            last={index === rows.length - 1}
          />
        ))}
      </View>
    </View>
  )
}

function MachineCard({ machine }: { machine: Machine }) {
  const world = useStore((store) => store.world)
  const counts = processCounts(world, machine.config.id)
  const router = useRouter()
  const { config, status } = machine

  const manage = (): void => {
    const buttons = [
      {
        text: "Address…",
        onPress: () => router.push({ pathname: "/address/[id]", params: { id: config.id } }),
      },
      { text: "Retry now", onPress: () => connections().retry(config.id) },
      {
        text: "Remove",
        style: "destructive" as const,
        onPress: () => void connections().remove(config.id),
      },
      { text: "Cancel", style: "cancel" as const },
    ]
    if (Platform.OS === "ios") {
      buttons.unshift({
        text: "Rename",
        onPress: () =>
          Alert.prompt("Rename machine", "What should this machine be called?", (label) => {
            if (label.trim() !== "") void connections().update(config.id, { label: label.trim() })
          }),
      })
    }
    Alert.alert(machineLabel(machine), `${config.host}:${config.port}`, buttons)
  }

  return (
    // A plain Pressable, not <Link asChild>: the Link clones its child with its
    // own props and drops the style function, which flattens the card.
    <Pressable
      onPress={() => router.push({ pathname: "/machine/[id]", params: { id: config.id } })}
      onLongPress={manage}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: color.raised }]}
    >
      <View style={styles.cardHead}>
        <Dot tone={connectionTone(status)} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {machineLabel(machine)}
        </Text>
        <Text style={styles.counts}>
          {counts.running}/{counts.total}
        </Text>
      </View>
      <Text style={styles.cardMeta} numberOfLines={2}>
        <Text style={styles.address}>
          {config.host}:{config.port}
        </Text>
        {"  ·  "}
        {machine.error ?? CONNECTION_LABEL[status]}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  list: { padding: space.gutter, gap: space.gap },
  add: { color: color.accent, fontSize: 26, lineHeight: 30, fontWeight: "300" },
  switch: {
    flexDirection: "row",
    gap: 4,
    margin: space.gutter,
    marginBottom: 0,
    padding: 3,
    borderRadius: radius.card,
    backgroundColor: color.panel,
  },
  segment: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: radius.chip },
  segmentOn: { backgroundColor: color.raised },
  segmentLabel: { color: color.muted, fontSize: 13, fontWeight: "600" },
  segmentLabelOn: { color: color.text },
  card: {
    backgroundColor: color.panel,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    padding: 14,
    gap: 6,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, color: color.text, fontSize: 16, fontWeight: "600" },
  counts: { color: color.muted, fontSize: 12, fontFamily: mono },
  cardMeta: { color: color.muted, fontSize: 12 },
  address: { fontFamily: mono, color: color.soft },
  project: { gap: 2 },
  projectName: { color: color.soft, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28 },
  emptyTitle: { color: color.text, fontSize: 17, fontWeight: "600" },
  emptyBody: { color: color.muted, fontSize: 13, textAlign: "center", marginBottom: 8, lineHeight: 19 },
  footnote: { color: color.faint, fontSize: 11, textAlign: "center", marginTop: 6 },
})
