import { connIdOf, displayName } from "@hangar/client-core"
import type { Project, ProjectProcess } from "@hangar/contracts"

/**
 * The sidebar's project list, machine by machine. When the same repo is
 * registered on more than one connected machine it collapses into ONE entry
 * listing every machine's processes under it. This is presentation only:
 * identity stays per-connection, every part keeps its own scoped project.
 */

/** One machine's contribution to an entry. */
export type SidebarPart = {
  connId: string
  project: Project
  /** The processes to list — a subset of the project's while a filter is on. */
  processes: ProjectProcess[]
}

export type SidebarEntry = {
  /** Collapse key and drag id: the anchor machine's scoped project name. */
  key: string
  /** Contributing machines in connection order; more than one means a merged repo. */
  parts: [SidebarPart, ...SidebarPart[]]
}

export type SidebarGroup = {
  connId: string
  entries: SidebarEntry[]
}

/**
 * Groups the projects the sidebar should render.
 *
 * `connIds` is the connection order (local first); every one of them gets a
 * group, empty ones included, so machines with no projects keep a header.
 * `query` is the filter, already trimmed and lowercased.
 */
export function buildSidebarModel(connIds: string[], projects: Project[], query: string): SidebarGroup[] {
  const entries = filterEntries(mergeEntries(connIds, projects), query)

  const groups = new Map<string, SidebarEntry[]>(connIds.map((connId) => [connId, []]))
  for (const entry of entries) {
    const connId = entry.parts[0].connId
    const known = groups.get(connId)
    // A project scoped to a machine that is no longer connected still renders,
    // in a group of its own — same as it did before grouping existed.
    if (known) known.push(entry)
    else groups.set(connId, [entry])
  }
  return [...groups].map(([connId, entries]) => ({ connId, entries }))
}

/** Every entry of the model, in render order — the flat list of a lone machine. */
export function flatEntries(groups: SidebarGroup[]): SidebarEntry[] {
  return groups.flatMap((group) => group.entries)
}

/**
 * One entry per project, except where the same repo is registered on several
 * machines: those merge into one entry anchored at its first contributor in
 * connection order. Two checkouts of one repo on the same machine are distinct
 * working copies, so they never merge — and their ambiguity disables merging
 * for that remote everywhere, since there is no telling which copy pairs up.
 */
function mergeEntries(connIds: string[], projects: Project[]): SidebarEntry[] {
  const parts = projects.map(
    (project): SidebarPart => ({ connId: connIdOf(project.name), project, processes: project.processes }),
  )
  // Grouping is a multi-machine affair; one connection is the overwhelming case
  // and must come out exactly as it went in.
  if (connIds.length < 2) return parts.map((part) => ({ key: part.project.name, parts: [part] }))

  const rank = new Map(connIds.map((connId, index) => [connId, index]))
  const byRemote = new Map<string, SidebarPart[]>()
  for (const part of parts) {
    const remote = part.project.gitRemote
    if (!remote || !rank.has(part.connId)) continue
    const known = byRemote.get(remote)
    if (known) known.push(part)
    else byRemote.set(remote, [part])
  }

  const merged = new Map<string, SidebarEntry>()
  for (const [, candidates] of byRemote) {
    const machines = new Set(candidates.map((part) => part.connId))
    if (machines.size < 2 || machines.size !== candidates.length) continue
    const entry = entryOf([...candidates].sort((a, b) => rank.get(a.connId)! - rank.get(b.connId)!))
    if (entry === null) continue
    for (const part of entry.parts) merged.set(part.project.name, entry)
  }

  const emitted = new Set<SidebarEntry>()
  const entries: SidebarEntry[] = []
  for (const part of parts) {
    const entry = merged.get(part.project.name)
    if (entry === undefined) {
      entries.push({ key: part.project.name, parts: [part] })
      continue
    }
    // The merged entry takes the anchor's slot and vanishes from the others'.
    if (emitted.has(entry) || entry.parts[0] !== part) continue
    emitted.add(entry)
    entries.push(entry)
  }
  return entries
}

/** Keys an entry by its anchor — the first machine still in it. */
function entryOf(parts: SidebarPart[]): SidebarEntry | null {
  const [anchor, ...rest] = parts
  return anchor === undefined ? null : { key: anchor.project.name, parts: [anchor, ...rest] }
}

/**
 * Narrows entries to what matches the filter. A name match keeps the whole
 * entry — every machine's processes — so a merged repo stays one card; an entry
 * matched only through processes narrows down to the machines that have them.
 */
function filterEntries(entries: SidebarEntry[], query: string): SidebarEntry[] {
  if (query === "") return entries
  return entries.flatMap((entry) => {
    if (entry.parts.some((part) => displayName(part.project.name).toLowerCase().includes(query))) return [entry]
    const parts = entry.parts.flatMap((part) => {
      const processes = part.processes.filter((process) => process.name.toLowerCase().includes(query))
      return processes.length === 0 ? [] : [{ ...part, processes }]
    })
    // Filtering can strip the anchor: the first machine still standing takes over.
    const narrowed = entryOf(parts)
    return narrowed === null ? [] : [narrowed]
  })
}
