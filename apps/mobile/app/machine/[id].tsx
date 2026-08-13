import { displayName } from "@hangar/client-core"
import type { Project, ProjectProcess, SessionInfo } from "@hangar/contracts"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { restart, start, stop } from "../../src/actions"
import { Button } from "../../src/components/Button"
import { Dot } from "../../src/components/Dot"
import { connections } from "../../src/connections"
import { projectsOf, sessionIdFor, sessionOf } from "../../src/state"
import { CONNECTION_LABEL, connectionTone, describe, formatCpu, formatMemory, toneOf } from "../../src/status"
import { machineLabel, machineOf, useStore } from "../../src/store"
import { color, mono, radius, space } from "../../src/theme"

export default function MachineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const machine = useStore((store) => machineOf(store.machines, id))
  // The world is selected whole; deriving inside a selector would hand zustand a
  // new value on every render and spin.
  const world = useStore((store) => store.world)
  const projects = id === undefined ? [] : projectsOf(world, id)

  if (machine === undefined) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyBody}>This machine is no longer paired.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: machineLabel(machine) }} />
      <View style={styles.header}>
        <Dot tone={connectionTone(machine.status)} />
        <Text style={styles.headerText} numberOfLines={2}>
          <Text style={styles.address}>
            {machine.config.host}:{machine.config.port}
          </Text>
          {"  ·  "}
          {machine.error ?? CONNECTION_LABEL[machine.status]}
        </Text>
        {machine.status === "blocked" && (
          <Button label="Retry" onPress={() => connections().retry(machine.config.id)} />
        )}
      </View>

      {projects.length === 0 ? (
        <Text style={styles.emptyBody}>
          {machine.status === "connected" ? "This machine has no projects yet." : "Waiting for this machine to answer…"}
        </Text>
      ) : (
        projects.map((project) => <ProjectBlock key={project.name} project={project} />)
      )}
    </ScrollView>
  )
}

function ProjectBlock({ project }: { project: Project }) {
  return (
    <View style={styles.project}>
      <Text style={styles.projectName}>{displayName(project.name)}</Text>
      <View style={styles.rows}>
        {project.processes.map((process) => (
          <ProcessRow key={process.name} project={project.name} process={process} />
        ))}
      </View>
    </View>
  )
}

function ProcessRow({ project, process }: { project: string; process: ProjectProcess }) {
  const id = sessionIdFor(project, process.name)
  const session = useStore((store) => sessionOf(store.world, id))
  const router = useRouter()
  const running = session?.status === "running"

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.raised }]}
      onPress={() => router.push({ pathname: "/session/[id]", params: { id } })}
    >
      <View style={styles.rowHead}>
        <Dot tone={toneOf(session)} size={7} />
        <Text style={styles.processName} numberOfLines={1}>
          {process.name}
        </Text>
        <Metrics session={session} />
      </View>
      <Text style={styles.processMeta} numberOfLines={1}>
        {process.cmd === "" ? "interactive shell" : process.cmd} · {describe(session)}
      </Text>
      <View style={styles.rowActions}>
        {running ? (
          <>
            <Button label="Stop" variant="danger" onPress={() => stop(project, process.name)} />
            <Button label="Restart" onPress={() => restart(project, process.name)} />
          </>
        ) : (
          <Button label="Start" variant="accent" onPress={() => start(project, process.name)} />
        )}
      </View>
    </Pressable>
  )
}

function Metrics({ session }: { session: SessionInfo | undefined }) {
  if (session?.status !== "running" || session.metrics === undefined) return null
  return (
    <Text style={styles.metrics}>
      {formatCpu(session.metrics.cpuPercent)} · {formatMemory(session.metrics.memoryBytes)}
    </Text>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { padding: space.gutter, gap: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerText: { flex: 1, color: color.muted, fontSize: 12 },
  address: { fontFamily: mono, color: color.soft },
  project: { gap: 8 },
  projectName: { color: color.soft, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.9 },
  rows: { gap: 8 },
  row: {
    backgroundColor: color.panel,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    padding: 12,
    gap: 8,
  },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  processName: { flex: 1, color: color.text, fontSize: 15, fontWeight: "600" },
  metrics: { color: color.muted, fontSize: 11, fontFamily: mono },
  processMeta: { color: color.muted, fontSize: 12, fontFamily: mono },
  rowActions: { flexDirection: "row", gap: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.bg },
  emptyBody: { color: color.muted, fontSize: 13, textAlign: "center" },
})
