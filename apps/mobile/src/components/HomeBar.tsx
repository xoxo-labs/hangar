/**
 * The home screen's controls, as a floating glass bar over the list rather than
 * a band under the navigation title: grouping on the left, search filling the
 * rest. Both live where a thumb already is, the way iOS puts Safari's and Apps'
 * controls at the bottom — and the list keeps its full height behind them.
 *
 * The bar owns no state of its own: the query and the mode belong to the
 * screen, so a re-render from either one cannot desynchronise the two.
 */

import { BlurView } from "expo-blur"
import { useEffect, useRef, useState } from "react"
import { Keyboard, type KeyboardEvent, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ViewMode } from "../mode"
import { color, space } from "../theme"

/** How much room the bar needs at the end of a list so the last row clears it. */
export const HOME_BAR_INSET = 76

const MODES: { mode: ViewMode; label: string }[] = [
  { mode: "machines", label: "Machines" },
  { mode: "projects", label: "Projects" },
]

export function HomeBar({
  query,
  onQuery,
  mode,
  onMode,
}: {
  query: string
  onQuery: (query: string) => void
  mode: ViewMode
  onMode: (mode: ViewMode) => void
}) {
  const insets = useSafeAreaInsets()
  const [menuOpen, setMenuOpen] = useState(false)
  const lift = useKeyboardLift()
  const input = useRef<TextInput>(null)

  // Resting just above the home indicator, or off the bottom edge on a device
  // without one; the keyboard pushes the whole bar up by its own height.
  const bottom = Math.max(insets.bottom, 12) + lift

  return (
    <>
      {menuOpen && (
        // Anything outside the menu dismisses it, including the bar itself.
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu" />
      )}
      <View style={[styles.dock, { bottom }]} pointerEvents="box-none">
        {menuOpen && (
          <View style={styles.menu}>
            <BlurView intensity={70} tint="systemThinMaterialDark" style={StyleSheet.absoluteFill} />
            <View style={styles.sheen} pointerEvents="none" />
            {MODES.map((option) => (
              <Pressable
                key={option.mode}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: mode === option.mode }}
                onPress={() => {
                  onMode(option.mode)
                  setMenuOpen(false)
                }}
                style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
              >
                <Text style={styles.check}>{mode === option.mode ? "✓" : " "}</Text>
                <Text style={[styles.menuLabel, mode === option.mode && styles.menuLabelOn]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.bar}>
          <BlurView intensity={70} tint="systemThinMaterialDark" style={StyleSheet.absoluteFill} />
          {/* The sheen a glass surface catches along its top edge. */}
          <View style={styles.sheen} pointerEvents="none" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change grouping"
            accessibilityState={{ expanded: menuOpen }}
            hitSlop={8}
            onPress={() => {
              Keyboard.dismiss()
              setMenuOpen((open) => !open)
            }}
            style={({ pressed }) => [styles.grouping, (pressed || menuOpen) && styles.groupingOn]}
          >
            <Text style={[styles.glyph, menuOpen && styles.glyphOn]}>☰</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.search} onPress={() => input.current?.focus()}>
            <Text style={styles.glyph}>⌕</Text>
            <TextInput
              ref={input}
              style={styles.input}
              value={query}
              onChangeText={onQuery}
              placeholder={mode === "machines" ? "Search machines" : "Search projects"}
              placeholderTextColor={color.faint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
            />
            {query !== "" && (
              <Pressable
                accessibilityLabel="Clear search"
                hitSlop={10}
                onPress={() => {
                  onQuery("")
                  Keyboard.dismiss()
                }}
              >
                <Text style={styles.clear}>✕</Text>
              </Pressable>
            )}
          </Pressable>
        </View>
      </View>
    </>
  )
}

/**
 * How far the keyboard pushes the bar up. `KeyboardAvoidingView` would need the
 * bar in normal flow to do this; the bar is absolutely positioned over the list
 * on purpose, so it follows the keyboard itself.
 */
function useKeyboardLift(): number {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    // The `will` events run alongside the keyboard's own animation on iOS.
    const shown = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event: KeyboardEvent) => setLift(event.endCoordinates.height),
    )
    const hidden = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () =>
      setLift(0),
    )
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  return lift
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: space.gutter, right: space.gutter, gap: 8 },
  /*
   * Glass: the iOS material does the work, so the fill is only a breath of
   * white to lift it off a near-black list, and the border is a bright hairline
   * rather than the chrome grey the cards use. `overflow: hidden` is what clips
   * the blur to the rounded shape, and the shadow is what makes it float.
   */
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    paddingHorizontal: 6,
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ffffff2b",
    backgroundColor: "#ffffff0f",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  sheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#ffffff33",
  },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  input: { flex: 1, color: color.text, fontSize: 15, paddingVertical: 8 },
  glyph: { color: color.muted, fontSize: 17 },
  glyphOn: { color: color.accent },
  clear: { color: color.faint, fontSize: 13 },
  divider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: color.line },
  grouping: { alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 20 },
  groupingOn: { backgroundColor: "#ffffff1f" },
  menu: {
    alignSelf: "flex-start",
    minWidth: 200,
    paddingVertical: 4,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ffffff2b",
    backgroundColor: "#ffffff0f",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  pressed: { backgroundColor: color.raised },
  check: { width: 14, color: color.accent, fontSize: 13 },
  menuLabel: { color: color.soft, fontSize: 15 },
  menuLabelOn: { color: color.text, fontWeight: "600" },
})
