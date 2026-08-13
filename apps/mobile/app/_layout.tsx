import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { startConnections } from "../src/connections"
import { color } from "../src/theme"

export default function RootLayout() {
  useEffect(() => {
    startConnections()
  }, [])

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.bg },
          headerTintColor: color.accent,
          headerTitleStyle: { color: color.text, fontSize: 16 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: color.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Machines" }} />
        <Stack.Screen name="pair" options={{ title: "Pair a machine", presentation: "modal" }} />
        <Stack.Screen name="machine/[id]" options={{ title: "Machine" }} />
        <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
      </Stack>
    </>
  )
}
