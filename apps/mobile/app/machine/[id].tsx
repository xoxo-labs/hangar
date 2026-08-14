import { displayName } from "@hangar/client-core"
import type { Project } from "@hangar/contracts"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import { Button } from "../../src/components/Button"
import { Dot } from "../../src/components/Dot"
import { ProcessRow } from "../../src/components/ProcessRow"
import { connections } from "../../src/connections"
import { projectsOf } from "../../src/state"
import { CONNECTION_LABEL, connectionTone } from "../../src/status"
import { machineLabel, machineOf, useStore } from "../../src/store"
import { color, mono, space } from "../../src/theme"

export default function MachineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const machine = useStore((store) => machineOf(store.machines, id))
  // The world is selected whole; deriving inside a selector would hand zustand a
  // new value on every render and spin.
  const world = useStore((store) => store.world)
  const projects = id === undefined ? [] : projectsOf(world, id)
  const router = useRouter()

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
        <Button
          label="Address"
          onPress={() => router.push({ pathname: "/address/[id]", params: { id: machine.config.id } })}
        />
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
      <View>
        {project.processes.map((process, index) => (
          <ProcessRow
            key={process.name}
            project={project.name}
            process={process}
            last={index === project.processes.length - 1}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { padding: space.gutter, gap: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerText: { flex: 1, color: color.muted, fontSize: 12 },
  address: { fontFamily: mono, color: color.soft },
  project: { gap: 2 },
  projectName: { color: color.soft, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.bg },
  emptyBody: { color: color.muted, fontSize: 13, textAlign: "center" },
})
