import { Stack, useRouter } from "expo-router"
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Button } from "../src/components/Button"
import { Dot } from "../src/components/Dot"
import { connections } from "../src/connections"
import { processCounts } from "../src/state"
import { CONNECTION_LABEL, connectionTone } from "../src/status"
import { type Machine, machineLabel, useStore } from "../src/store"
import { color, mono, radius, space } from "../src/theme"

export default function MachinesScreen() {
  const machines = useStore((store) => store.machines)
  const ready = useStore((store) => store.ready)
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
        <ScrollView contentContainerStyle={styles.list}>
          {machines.map((machine) => (
            <MachineCard key={machine.config.id} machine={machine} />
          ))}
          <Text style={styles.footnote}>Long-press a machine to rename, retry or remove it.</Text>
        </ScrollView>
      )}
    </View>
  )
}

function MachineCard({ machine }: { machine: Machine }) {
  // Select the world itself, never a derived object: zustand compares with
  // Object.is, so a selector that builds a fresh value re-renders forever.
  const world = useStore((store) => store.world)
  const counts = processCounts(world, machine.config.id)
  const router = useRouter()
  const { config, status } = machine

  const manage = (): void => {
    const buttons = [
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
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28 },
  emptyTitle: { color: color.text, fontSize: 17, fontWeight: "600" },
  emptyBody: { color: color.muted, fontSize: 13, textAlign: "center", marginBottom: 8, lineHeight: 19 },
  footnote: { color: color.faint, fontSize: 11, textAlign: "center", marginTop: 6 },
})
