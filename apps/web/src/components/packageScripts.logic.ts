/** Pure list transforms for the detected-scripts panel in the project dialog.
 * The server hands back root scripts followed by every workspace package's
 * scripts, so in a monorepo this list is cumulative and easily runs long. */

export type PackageScript = { name: string; value: string; cmd: string; cwd?: string; workspace?: string }

export type ScriptGroup = { label: string; scripts: PackageScript[] }

/** Above this many detected scripts the panel offers a filter; a shorter list is quicker to scan than to type at. */
export const SCRIPT_FILTER_THRESHOLD = 5

export function groupPackageScripts(scripts: PackageScript[]): ScriptGroup[] {
  const groups = new Map<string, PackageScript[]>()
  for (const script of scripts) {
    const label = script.workspace ?? (script.cwd || "Root")
    const group = groups.get(label)
    if (group) group.push(script)
    else groups.set(label, [script])
  }
  return Array.from(groups, ([label, entries]) => ({ label, scripts: entries }))
}

/** Case-insensitive match on the prefixed script name, the workspace label, or the command it runs.
 * Fields are tested one by one so a query can't match across a boundary between two of them. */
export function filterPackageScripts(scripts: PackageScript[], query: string): PackageScript[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return scripts
  return scripts.filter((script) =>
    [script.name, script.workspace ?? "", script.value].some((field) => field.toLowerCase().includes(needle)),
  )
}
