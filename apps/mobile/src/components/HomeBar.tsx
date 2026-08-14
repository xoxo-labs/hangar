/**
 * The home screen's controls, as floating glass over the list rather than a
 * band under the navigation title: grouping on the left, search filling the
 * rest. Both live where a thumb already is, the way iOS puts Music's and
 * Safari's controls at the bottom — and the list keeps its full height behind
 * them.
 *
 * On iOS 26 these are real Liquid Glass elements, two separate shapes inside a
 * `GlassContainer` so they refract and merge at the edges the way the system's
 * own do. Anywhere else — older iOS, Android, or a device where the effect is
 * unavailable — the same shapes fall back to a blur with a drawn edge, which is
 * why every surface goes through `Surface` instead of picking one directly.
 *
 * The bar owns no state of its own: the query and the mode belong to the
 * screen, so a re-render from either one cannot desynchronise the two.
 */

import { BlurView } from "expo-blur"
import { GlassContainer, GlassView, isLiquidGlassAvailable } from "expo-glass-effect"
import { SymbolView } from "expo-symbols"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ViewMode } from "../mode"
import { color, space } from "../theme"

/** How much room the bar needs at the end of a list so the last row clears it. */
export const HOME_BAR_INSET = 84

const BAR_HEIGHT = 52

/**
 * Whether the system draws Liquid Glass for us. `isLiquidGlassAvailable` reaches
 * for a native module, so a build without it must not take the screen down.
 */
const LIQUID_GLASS = ((): boolean => {
  if (Platform.OS !== "ios") return false
  try {
    return isLiquidGlassAvailable()
  } catch {
    return false
  }
})()

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
          <Surface style={styles.menu} radius={20}>
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
          </Surface>
        )}

        <Row>
          <Surface style={styles.groupingGlass} radius={BAR_HEIGHT / 2}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change grouping"
              accessibilityState={{ expanded: menuOpen }}
              onPress={() => {
                Keyboard.dismiss()
                setMenuOpen((open) => !open)
              }}
              style={({ pressed }) => [styles.grouping, (pressed || menuOpen) && styles.groupingOn]}
            >
              <Icon name="line.3.horizontal.decrease" glyph="☰" size={19} tint={menuOpen ? color.accent : color.soft} />
            </Pressable>
          </Surface>

          <Surface style={styles.searchGlass} radius={BAR_HEIGHT / 2}>
            <Pressable style={styles.search} onPress={() => input.current?.focus()}>
              <Icon name="magnifyingglass" glyph="⌕" size={16} tint={color.muted} />
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
                  <Icon name="xmark.circle.fill" glyph="✕" size={16} tint={color.faint} />
                </Pressable>
              )}
            </Pressable>
          </Surface>
        </Row>
      </View>
    </>
  )
}

/**
 * Holds the two shapes. They are deliberately given no merge distance: a
 * `GlassContainer` with `spacing` lets neighbouring glass bleed together, which
 * reads as one smeared control rather than two buttons — the grouping button
 * and the field do different things and stay visibly apart. The container is
 * still what groups them as one glass layer.
 */
function Row({ children }: { children: ReactNode }) {
  if (!LIQUID_GLASS) return <View style={styles.row}>{children}</View>
  return <GlassContainer style={styles.row}>{children}</GlassContainer>
}

/**
 * An SF Symbol, with the text glyph it replaces as the fallback for anywhere
 * the symbol set is unavailable. Sizes follow iOS: the field's magnifier sits a
 * little smaller than the control icon beside it.
 */
function Icon({ name, glyph, size, tint }: { name: string; glyph: string; size: number; tint: string }) {
  return (
    <SymbolView
      name={name as never}
      size={size}
      tintColor={tint}
      weight="medium"
      resizeMode="scaleAspectFit"
      fallback={<Text style={{ color: tint, fontSize: size + 1 }}>{glyph}</Text>}
    />
  )
}

/**
 * One floating surface. `colorScheme="dark"` is not optional: Hangar on a phone
 * is dark-only, and glass left on `auto` would turn milky white on a phone set
 * to light appearance.
 */
function Surface({ style, radius, children }: { style: ViewStyle; radius: number; children: ReactNode }) {
  if (LIQUID_GLASS) {
    return (
      <GlassView style={[style, { borderRadius: radius }]} glassEffectStyle="clear" colorScheme="dark" isInteractive>
        {children}
      </GlassView>
    )
  }
  return (
    <View style={[style, styles.blurred, { borderRadius: radius }]}>
      <BlurView intensity={70} tint="systemThinMaterialDark" style={StyleSheet.absoluteFill} />
      {/* The sheen a glass surface catches along its top edge. */}
      <View style={styles.sheen} pointerEvents="none" />
      {children}
    </View>
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
  dock: { position: "absolute", left: space.gutter, right: space.gutter, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  // Shadow is what makes a floating shape read as floating; glass has no fill
  // of its own, so the list has to show through it.
  groupingGlass: { width: BAR_HEIGHT, height: BAR_HEIGHT, ...shadow() },
  searchGlass: { flex: 1, height: BAR_HEIGHT, ...shadow() },
  // Only the fallback draws its own edge: real glass brings one.
  blurred: {
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ffffff2b",
    backgroundColor: "#ffffff0f",
  },
  sheen: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: "#ffffff33" },
  grouping: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: BAR_HEIGHT / 2 },
  groupingOn: { backgroundColor: "#ffffff1f" },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 15 },
  input: { flex: 1, color: color.text, fontSize: 15, paddingVertical: 8 },
  menu: { alignSelf: "flex-start", minWidth: 200, paddingVertical: 4, ...shadow() },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  pressed: { backgroundColor: "#ffffff14" },
  check: { width: 14, color: color.accent, fontSize: 13 },
  menuLabel: { color: color.soft, fontSize: 15 },
  menuLabelOn: { color: color.text, fontWeight: "600" },
})

function shadow(): ViewStyle {
  return {
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  }
}
