import { Pressable, StyleSheet, Text } from "react-native"
import { color, mono, radius } from "../theme"

/**
 * `ghost` is the row-level variant: no box at all, just a word. A list of
 * processes carries three or four actions per row, and boxed buttons at that
 * density read as a wall of chrome — see `ProcessRow`.
 */
export type ButtonVariant = "default" | "accent" | "danger" | "ghost"

export function Button({
  label,
  onPress,
  variant = "default",
  disabled = false,
  /** Terminal-ish: the monospace face the log view and addresses use. */
  mono: monospace = false,
  accessibilityLabel,
}: {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  mono?: boolean
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      // A ghost button is smaller than a finger; the slop is what makes it hittable.
      hitSlop={variant === "ghost" ? 10 : 0}
      style={({ pressed }) => [
        styles.button,
        variant === "accent" && styles.accent,
        variant === "danger" && styles.danger,
        variant === "ghost" && styles.ghost,
        (pressed || disabled) && styles.faded,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === "accent" && styles.accentLabel,
          variant === "danger" && styles.dangerLabel,
          variant === "ghost" && styles.ghostLabel,
          monospace && styles.monoLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    backgroundColor: color.raised,
  },
  accent: { borderColor: color.accent, backgroundColor: color.accentDim },
  danger: { borderColor: color.danger, backgroundColor: color.dangerDim },
  ghost: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  faded: { opacity: 0.55 },
  label: { color: color.soft, fontSize: 13, fontWeight: "600" },
  accentLabel: { color: color.accent },
  dangerLabel: { color: color.danger },
  ghostLabel: { color: color.muted, fontSize: 12, fontWeight: "500" },
  monoLabel: { fontFamily: mono, color: color.accent },
})
