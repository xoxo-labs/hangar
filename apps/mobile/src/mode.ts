/**
 * Which way the home screen lists things. A phone is one screen wide, so the
 * two useful groupings — by machine, by project — are a toggle rather than two
 * places to be. The choice sticks between launches: whichever one you work in
 * is the one you almost always want next.
 *
 * `node --test` covers `parseMode`, so nothing here may import react-native.
 */

export type ViewMode = "machines" | "projects"

/** Same versioned-key convention as `hangar.connections.v1`. */
export const MODE_KEY = "hangar.view.v1"

export const DEFAULT_MODE: ViewMode = "machines"

/** Stored preferences are device data, not trusted input: anything odd reads as the default. */
export function parseMode(raw: string | null | undefined): ViewMode {
  return raw === "projects" || raw === "machines" ? raw : DEFAULT_MODE
}
