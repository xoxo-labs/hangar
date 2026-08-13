import { parsePairingString } from "@hangar/client-core"
import { CameraView, useCameraPermissions } from "expo-camera"
import * as Device from "expo-device"
import { useRouter } from "expo-router"
import { type ReactNode, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Button } from "../src/components/Button"
import { connections } from "../src/connections"
import { pair, readTarget } from "../src/pairing"
import { color, mono, radius, space } from "../src/theme"

export default function PairScreen() {
  const router = useRouter()
  const [permission, requestPermission] = useCameraPermissions()
  const [host, setHost] = useState("")
  const [port, setPort] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A camera fires the same QR many times a second; one redemption is enough.
  const claimed = useRef(false)

  const submit = async (target: { host: string; port: number; code: string }): Promise<void> => {
    setBusy(true)
    setError(null)
    const label = Device.deviceName ?? Platform.select({ ios: "iPhone", default: "Phone" })
    const outcome = await pair(target, label)
    if (!outcome.ok) {
      claimed.current = false
      setBusy(false)
      setError(outcome.message)
      return
    }
    await connections().add({
      label: outcome.serverName || target.host,
      host: target.host,
      port: target.port,
      token: outcome.token,
    })
    setBusy(false)
    router.back()
  }

  const onScan = (data: string): void => {
    if (claimed.current || busy) return
    const parsed = parsePairingString(data)
    if (parsed === null) {
      setError("That QR code is not a Hangar pairing code.")
      return
    }
    setHost(parsed.host)
    setPort(String(parsed.port))
    setCode(parsed.code)
    if (parsed.code === "") return
    claimed.current = true
    void submit({ host: parsed.host, port: parsed.port, code: parsed.code })
  }

  const onManual = (): void => {
    const target = readTarget(host, port, code)
    if (target === null) {
      setError("Fill in the address and the pairing code.")
      return
    }
    void submit(target)
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={64}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          On your Mac, open Hangar → Settings → Connections, generate a pairing code, and scan its QR.
        </Text>

        <View style={styles.viewfinder}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => onScan(data)}
            />
          ) : (
            <View style={styles.permission}>
              <Text style={styles.permissionText}>
                {permission === null ? "Checking the camera…" : "Hangar needs the camera to scan a pairing QR."}
              </Text>
              {permission !== null && !permission.granted && (
                <Button label="Allow camera" onPress={() => void requestPermission()} />
              )}
            </View>
          )}
        </View>

        <Text style={styles.divider}>or type it in</Text>

        <Field label="Host">
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="100.90.1.5"
            placeholderTextColor={color.faint}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
          />
        </Field>
        <Field label="Port">
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="4780"
            placeholderTextColor={color.faint}
            inputMode="numeric"
          />
        </Field>
        <Field label="Pairing code">
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(value) => setCode(value.toUpperCase())}
            placeholder="ABCD2345WXYZ"
            placeholderTextColor={color.faint}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </Field>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        <View style={styles.actions}>
          {busy ? (
            <ActivityIndicator color={color.accent} />
          ) : (
            <Button label="Pair" variant="accent" onPress={onManual} />
          )}
        </View>
        <Text style={styles.note}>
          Hangar talks to your Mac in plaintext — Tailscale is the recommended way to reach it from outside your own
          network.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  body: { padding: space.gutter, gap: 12 },
  lead: { color: color.muted, fontSize: 13, lineHeight: 19 },
  viewfinder: {
    height: 240,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: color.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 20 },
  permissionText: { color: color.muted, fontSize: 13, textAlign: "center" },
  divider: { color: color.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, textAlign: "center" },
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
  note: { color: color.faint, fontSize: 11, lineHeight: 16, marginTop: 8 },
})
