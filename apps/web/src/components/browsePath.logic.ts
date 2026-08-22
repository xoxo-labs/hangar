/** Path string handling for the typeahead folder browser, where one text input
 * is both the address bar and the filter box: what has been typed so far decides
 * which directory the server lists and which prefix narrows that listing. A
 * trailing separator means "list this directory"; without one the last segment
 * is a prefix, and the directory above it is what gets listed.
 *
 * Both "/" and "\" are read as separators — a path pasted from somewhere else
 * costs nothing to tolerate — but everything returned here is written with "/",
 * because Hangar targets macOS and Linux and never needs to emit the other one.
 * Nothing here touches the filesystem, the window, or React. */

const LEADING_SEPARATOR = /^[\\/]/
const TRAILING_SEPARATOR = /[\\/]$/
const SEPARATORS = /[\\/]+/

/** True when the path ends in a separator — the signal that it names a directory to list rather than a prefix to
 * filter. "~" alone counts: it is the home directory, not the start of a name. */
export function hasTrailingSeparator(path: string): boolean {
  if (path === "") return false
  return path === "~" || TRAILING_SEPARATOR.test(path)
}

/** The directory portion, including its trailing separator. "~/co" -> "~/", "~/code/" -> "~/code/", "code" -> "". */
export function directoryPart(path: string): string {
  return splitPath(path).directory
}

/** The last segment, the part acting as a filter prefix. "~/co" -> "co", "~/code/" -> "". */
export function leafPart(path: string): string {
  return splitPath(path).leaf
}

/** Appends a chosen directory name to the directory portion — replacing whatever prefix was typed — and leaves a
 * trailing separator so the next listing follows straight on. "~/co" + "code" -> "~/code/". */
export function appendSegment(path: string, name: string): string {
  const segment = name.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
  const directory = directoryPart(path)
  return segment === "" ? directory : `${directory}${segment}/`
}

/**
 * The parent directory with a trailing separator, or null at a root ("/" or
 * "~/") where there is nowhere to go up to.
 *
 * The rule, which holds whether or not the input ends in a separator: strip a
 * trailing separator first, then drop the last segment. So "/Users/sorin/" and
 * "/Users/sorin" both give "/Users/" — a leaf that is only a half-typed prefix
 * still sits in the same parent as the directory it would become, and going up
 * from a listing must not depend on whether the user has started typing.
 *
 * Home is a floor: "~/" has a real parent on disk, but the browser starts at
 * home and offering a way above it only leads somewhere the user did not mean.
 */
export function parentPath(path: string): string | null {
  const segments = segmentsOf(path)
  if (segments.length === 0) return null
  segments.pop()
  const root = LEADING_SEPARATOR.test(path) ? "/" : ""
  if (segments.length === 0) return root === "" ? null : root
  return `${root}${segments.join("/")}/`
}

/** True when a ".." row should be offered: only meaningful once a directory is being listed, since a half-typed leaf
 * is a filter that a ".." row would not match anyway, and only when there is somewhere above to go. */
export function canGoUp(path: string): boolean {
  return hasTrailingSeparator(path) && parentPath(path) !== null
}

/** Ensures a trailing separator, so a selected absolute path becomes a browsable directory. "" stays "" — an empty
 * input is not yet a directory, and turning it into "/" would jump the browser to the filesystem root. */
export function asDirectory(path: string): string {
  const { directory, leaf } = splitPath(path)
  return leaf === "" ? directory : `${directory}${leaf}/`
}

export type BrowseEntry = { name: string; git: boolean; pkg: boolean }

/**
 * Orders a directory listing: project-looking directories — the ones holding a
 * .git or a package.json — sort above plain ones, then alphabetically, ignoring
 * case. Ranking by how well the name matches the typed prefix is deliberately
 * not the goal; the prefix already decided which rows are here at all, so the
 * useful thing left to surface is which of them is plausibly a project.
 *
 * Total and stable: identical names differing only in case fall back to a plain
 * codepoint comparison rather than tying, so the order never depends on the
 * sort implementation.
 */
export function compareBrowseEntries(a: BrowseEntry, b: BrowseEntry): number {
  const projectA = a.git || a.pkg
  const projectB = b.git || b.pkg
  if (projectA !== projectB) return projectA ? -1 : 1
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "accent" })
  if (byName !== 0) return byName
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/** Every non-empty segment, so repeated separators ("~//code") collapse instead of yielding empty names. */
function segmentsOf(path: string): string[] {
  return path.split(SEPARATORS).filter((segment) => segment !== "")
}

/** The one parse the rest of this module is written against: where the directory ends and the filter prefix begins. */
function splitPath(path: string): { directory: string; leaf: string } {
  if (path === "") return { directory: "", leaf: "" }
  const root = LEADING_SEPARATOR.test(path) ? "/" : ""
  const segments = segmentsOf(path)
  const leaf = hasTrailingSeparator(path) ? "" : (segments.pop() ?? "")
  const directory = segments.length === 0 ? root : `${root}${segments.join("/")}/`
  return { directory, leaf }
}
