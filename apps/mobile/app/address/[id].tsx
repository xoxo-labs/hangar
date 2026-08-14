/**
 * Where a machine lives. Pairing captures whichever address worked that day;
 * a laptop that moves between a LAN and Tailscale, or a router that hands out a
 * new lease, leaves the saved one pointing at nothing — and a connection that
 * cannot be reached is exactly the one you need to edit.
 *
 * So the screen is built around the manual fields: they are always usable, and
 * the suggestions above them are a convenience that quietly does not appear
 * when the machine cannot be asked.
 */

import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Button } from "../../src/components/Button"
import { connections } from "../../src/connections"
import {
  type Candidate,
  candidates,
  fetchNetworkInfo,
  type NetworkInfo,
  readAddress,
  sameAddress,
} from "../../src/network"
import { machineLabel, machineOf, useStore } from "../../src/store"
import { color, mono, radius, space } from "../../src/theme"

export default function AddressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const machine = useStore((store) => machineOf(store.machines, id))
  const router = useRouter()
  const [info, setInfo] = useState<NetworkInfo | null>(null)
  const [asking, setAsking] = useState(true)
  const [host, setHost] = useState(machine?.config.host ?? "")
  const [port, setPort] = useState(machine === undefined ? "" : String(machine.config.port))
  const [error, setError] = useState<string | null>(null)

  const config = machine?.config

  useEffect(() => {
    if (config === undefined) return
    const abort = new AbortController()
    setAsking(true)
    fetchNetworkInfo(config, abort.signal)
      .then((next) => setInfo(next))
      .catch(() => setInfo(null))
      .finally(() => setAsking(false))
    return () => abort.abort()
    // Re-ask whenever the address changes: the new one may answer where the old did not.
  }, [config?.id, config?.host, config?.port, config?.token])

  if (machine === undefined || config === undefined) {
    return (
      <View style={styles.gone}>
        <Text style={styles.note}>This machine is no longer paired.</Text>
      </View>
    )
  }

  const save = (next: { host: string; port: number }): void => {
    // Saving the address it already has would drop a healthy socket for nothing.
    if (!sameAddress(config, next)) void connections().update(config.id, next)
    router.back()
  }

  const saveManual = (): void => {
    const next = readAddress(host, port)
    if (next === null) {
      setError("Enter an address and a port, like 100.90.1.5 and 4780.")
      return
    }
    save(next)
  }

  const list = candidates(info, config)

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={96}
    >
      <Stack.Screen options={{ title: machineLabel(machine) }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>Hangar reaches this machine at</Text>
        <Text style={styles.current}>
          {config.host}:{config.port}
        </Text>

        <Text style={styles.section}>Addresses this machine answers on</Text>
        {asking && info === null ? (
          <View style={styles.asking}>
            <ActivityIndicator color={color.accent} />
            <Text style={styles.note}>Asking this machine…</Text>
          </View>
        ) : list.length === 0 ? (
          <Text style={styles.note}>
            Could not ask this machine which addresses it answers on — it is unreachable from here right now. Type one
            in below.
          </Text>
        ) : (
          <View style={styles.candidates}>
            {list.map((candidate) => (
              <CandidateRow
                key={`${candidate.kind}:${candidate.host}`}
                candidate={candidate}
                onPress={() => save({ host: candidate.host, port: candidate.port })}
              />
            ))}
            <Text style={styles.note}>
              Tailscale addresses keep working when you are away from your own network; a LAN address only answers at
              home.
            </Text>
          </View>
        )}

        <Text style={styles.section}>Or type it in</Text>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Host</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={(value) => {
              setHost(value)
              setError(null)
            }}
            placeholder="100.90.1.5"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={(value) => {
              setPort(value)
              setError(null)
            }}
            placeholder="4780"
            placeholderTextColor={color.faint}
            inputMode="numeric"
          />
        </View>
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          <Button label="Save address" variant="accent" onPress={saveManual} />
        </View>
        <Text style={styles.note}>Saving reconnects this machine straight away. Its pairing is not affected.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function CandidateRow({ candidate, onPress }: { candidate: Candidate; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={candidate.current}
      onPress={onPress}
      style={({ pressed }) => [styles.candidate, pressed && styles.pressed, candidate.current && styles.currentRow]}
    >
      <Text style={styles.candidateHost}>
        {candidate.host}:{candidate.port}
      </Text>
      <Text style={[styles.tag, candidate.kind === "tailscale" && styles.tagOn]}>
        {candidate.kind === "tailscale" ? "Tailscale" : "LAN"}
      </Text>
      {candidate.current && <Text style={styles.inUse}>in use</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.bg, padding: 28 },
  body: { padding: space.gutter, gap: 10 },
  lead: { color: color.muted, fontSize: 13 },
  current: { color: color.text, fontSize: 17, fontFamily: mono },
  section: {
    color: color.soft,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    marginTop: 14,
  },
  asking: { flexDirection: "row", alignItems: "center", gap: 10 },
  candidates: { gap: 8 },
  candidate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: color.panel,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pressed: { backgroundColor: color.raised },
  currentRow: { opacity: 0.6 },
  candidateHost: { flex: 1, color: color.text, fontSize: 14, fontFamily: mono },
  tag: {
    color: color.muted,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  tagOn: { color: color.accent, borderColor: color.accent },
  inUse: { color: color.faint, fontSize: 11 },
  field: { gap: 5 },
  fieldLabel: { color: color.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  input: {
    backgroundColor: color.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    borderRadius: radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: color.text,
    fontFamily: mono,
    fontSize: 14,
  },
  error: { color: color.danger, fontSize: 13, lineHeight: 18 },
  actions: { alignItems: "flex-start", marginTop: 4 },
  note: { color: color.faint, fontSize: 11, lineHeight: 16 },
})
