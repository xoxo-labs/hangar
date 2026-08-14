/**
 * How wide the app is, in the only two shapes it has. A phone is always
 * compact; an iPad is regular until Split View or Stage Manager hands it a
 * slice narrower than the threshold, at which point it is a phone again — the
 * decision is the window's width, never the device.
 *
 * `node --test` covers this file, so nothing here may import react-native.
 */

export type LayoutMode = "compact" | "regular"

/**
 * The left pane wants ~360 pt of list and the log beside it wants at least as
 * much again to be worth reading; 700 pt is where both fit. It lands between an
 * iPad's narrowest multitasking slice and its half-screen one, so a two-thirds
 * or half split stays two-pane and a slide-over collapses.
 */
export const REGULAR_MIN_WIDTH = 700

export function layoutModeFor(width: number): LayoutMode {
  return width >= REGULAR_MIN_WIDTH ? "regular" : "compact"
}

/** What a width change does: the selection it leaves behind, and whether the stack drops a screen. */
export type Adoption = {
  selection: string | null
  /** Pop the session route: the pane is showing that session now. */
  pop: boolean
}

/**
 * Crossing the breakpoint moves state between the two models rather than
 * resetting it. Widening while a session route is up adopts that session as the
 * pane's subject and pops the screen, so the two do not show the same log
 * twice. Narrowing keeps the selection but pushes nothing: you land on the
 * stack where you left it, and the selection is waiting if you widen again.
 */
export function adoptOnResize(
  previous: LayoutMode,
  next: LayoutMode,
  routeSessionId: string | null,
  selection: string | null,
): Adoption {
  if (previous === next) return { selection, pop: false }
  if (next === "regular" && routeSessionId !== null) return { selection: routeSessionId, pop: true }
  return { selection, pop: false }
}
