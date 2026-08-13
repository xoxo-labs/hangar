import { View } from "react-native"
import type { Tone } from "../status"
import { TONE_COLOR } from "../theme"

/** The desktop app's status dot: a lit one glows, a quiet one does not. */
export function Dot({ tone, size = 8 }: { tone: Tone; size?: number }) {
  const lit = tone === "running" || tone === "warning" || tone === "failed"
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: TONE_COLOR[tone],
        shadowColor: TONE_COLOR[tone],
        shadowOpacity: lit ? 0.8 : 0,
        shadowRadius: lit ? 4 : 0,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  )
}
