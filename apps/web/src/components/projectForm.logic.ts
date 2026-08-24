/* Pure form logic for the project editor: validation mirrored from the
 * server, the Row → Project mapping, and terminal naming. */

import type { BrowserChoice, Project, ProjectProcess } from "@hangar/contracts"

/** A process being edited. `id` only keeps React keys stable across row removals.
 * `description` is edited in the session inspector, not here; the row carries it
 * through so saving the dialog doesn't drop it. */
export type Row = {
  id: number
  name: string
  cmd: string
  cwd: string
  shell: boolean
  description?: string
  browser?: BrowserChoice
}

/** Mirrors the server's `validateProject` so the form can refuse early. */
export function validate(name: string, path: string, rows: Row[]): string | null {
  if (name.trim() === "") return "Name is required."
  if (/[\s/]/.test(name)) return "Name can't contain spaces or slashes."
  if (path.trim() === "") return "Path is required."
  if (rows.length === 0) return "A project needs at least one process."
  if (rows.some((row) => row.name.trim() === "" || (!row.shell && row.cmd.trim() === ""))) {
    return "Every process needs a name and a command."
  }
  const names = new Set(rows.map((row) => row.name.trim()))
  if (names.size !== rows.length) return "Process names must be unique."
  return null
}

export function toProject(
  name: string,
  path: string,
  rows: Row[],
  env: Record<string, string> | undefined,
  browser: BrowserChoice | "",
): Project {
  const processes: ProjectProcess[] = rows.map((row) => {
    const cwd = row.cwd.trim()
    return {
      name: row.name.trim(),
      cmd: row.shell ? "" : row.cmd.trim(),
      ...(row.shell ? { shell: true } : {}),
      ...(cwd === "" ? {} : { cwd }),
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.browser === undefined ? {} : { browser: row.browser }),
    }
  })
  return {
    name: name.trim(),
    path: path.trim(),
    processes,
    ...(env === undefined ? {} : { env }),
    ...(browser === "" ? {} : { browser }),
  }
}

export function uniqueTerminalName(rows: Row[]): string {
  const names = new Set(rows.map((row) => row.name.trim()))
  if (!names.has("terminal")) return "terminal"
  let suffix = 2
  while (names.has(`terminal-${suffix}`)) suffix += 1
  return `terminal-${suffix}`
}
