import { Pressable, StyleSheet, Text } from "react-native"
import { color, radius } from "../theme"

export type ButtonVariant = "default" | "accent" | "danger"

export function Button({
  label,
  onPress,
  variant = "default",
  disabled = false,
}: {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "accent" && styles.accent,
        variant === "danger" && styles.danger,
        (pressed || disabled) && styles.faded,
      ]}
    >
      <Text
        style={[styles.label, variant === "accent" && styles.accentLabel, variant === "danger" && styles.dangerLabel]}
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
  faded: { opacity: 0.55 },
  label: { color: color.soft, fontSize: 13, fontWeight: "600" },
  accentLabel: { color: color.accent },
  dangerLabel: { color: color.danger },
})
