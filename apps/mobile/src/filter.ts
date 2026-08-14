/**
 * The home screen's search. Projects are filtered by `buildSidebarModel`, which
 * already knows how a repo spanning machines narrows down; machines are matched
 * here, on the two things a card actually shows — what it is called and where
 * it lives.
 *
 * `node --test` covers this file, so nothing here may import react-native.
 */

/** What a machine looks like to the search: its rendered card, not its config. */
export type MachineMatch = {
  /** What the card calls it — label, else reported hostname, else host. */
  name: string
  host: string
  port: number
}

/**
 * The form `buildSidebarModel` documents for its query, and the one every
 * matcher below compares against: trimmed and lowercased, once, at the source.
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * A machine matches on its name or its address. The address is matched whole
 * (`192.168.1.20:4780`) as well as by host, so typing a port finds the machine
 * on it — two machines on one box differ by nothing else.
 */
export function matchesMachine(machine: MachineMatch, query: string): boolean {
  if (query === "") return true
  const address = `${machine.host}:${machine.port}`
  return machine.name.toLowerCase().includes(query) || address.toLowerCase().includes(query)
}

/** Keeps the machines that match, in the order they came in. */
export function filterMachines<T>(machines: T[], query: string, describe: (machine: T) => MachineMatch): T[] {
  const normalized = normalizeQuery(query)
  if (normalized === "") return machines
  return machines.filter((machine) => matchesMachine(describe(machine), normalized))
}
