import { Stack, useLocalSearchParams } from "expo-router"
import { SessionView } from "../../src/components/SessionView"
import { splitSessionId } from "../../src/state"

/**
 * The compact route. At iPad widths the same view is held in the right pane
 * instead (see `app/_layout.tsx`) and this screen is never pushed.
 */
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const sessionKey = id ?? ""

  return (
    <>
      <Stack.Screen options={{ title: splitSessionId(sessionKey).process }} />
      <SessionView id={sessionKey} />
    </>
  )
}
