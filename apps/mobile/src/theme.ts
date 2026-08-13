/**
 * The desktop app's palette, resolved to plain values. Those steps come from
 * Radix's dark scales (mauve / grass / amber / red / blue) — the same ones
 * `apps/web/src/styles.css` maps onto `surface`, `success`, `warning`, `danger`
 * and `accent`. Hangar on a phone is dark-only.
 */

import { Platform } from "react-native"
import type { Tone } from "./status"

export const color = {
  bg: "#121113", // mauve-1
  panel: "#1a191b", // mauve-2
  raised: "#232225", // mauve-3
  line: "#2b292d", // mauve-4
  border: "#3c393f", // mauve-6
  faint: "#625f69", // mauve-8
  muted: "#7c7a85", // mauve-10
  soft: "#b5b2bc", // mauve-11
  text: "#eeeef0", // mauve-12
  accent: "#3b9eff", // blue-10
  accentDim: "#0d2847", // blue-3
  success: "#53b365", // grass-10
  warning: "#ffd60a", // amber-10
  danger: "#ec5d5e", // red-10
  dangerDim: "#3b1219", // red-3
} as const

export const TONE_COLOR: Record<Tone, string> = {
  running: color.success,
  warning: color.warning,
  idle: color.faint,
  done: color.muted,
  failed: color.danger,
}

export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })

export const radius = { card: 10, chip: 6 } as const
export const space = { gutter: 16, gap: 10 } as const
