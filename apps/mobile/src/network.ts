/**
 * A machine's address, after pairing. The host saved at pairing time is just
 * the one that happened to work then — a laptop that moves between a LAN and
 * Tailscale needs it changed, and a *wrong* one needs it changed while the
 * machine is unreachable. So the candidate list below is a convenience the
 * screen can do without: the manual fields never depend on it.
 *
 * `node --test` covers this file, so nothing here may import react-native.
 */

import { httpBase } from "@hangar/client-core"
import type { ConnectionConfig } from "@hangar/client-core"

/** What `GET /network-info` answers with (see `apps/server/src/serve.ts`). */
export type NetworkInfo = { lan: string[]; tailscale: string[] }

export type AddressKind = "tailscale" | "lan"

export type Candidate = {
  host: string
  port: number
  kind: AddressKind
  /** True when this is the address the connection already uses. */
  current: boolean
}

export const EMPTY_INFO: NetworkInfo = { lan: [], tailscale: [] }

/**
 * The addresses to offer, port carried over from the current config — a machine
 * answers on one port whichever interface you reach it by. Tailscale leads
 * because it is the one that keeps working away from home; duplicates and
 * blanks are dropped, and an address already in use is marked, not hidden.
 */
export function candidates(info: NetworkInfo | null, config: { host: string; port: number }): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  const take = (hosts: string[] | undefined, kind: AddressKind): void => {
    for (const raw of hosts ?? []) {
      const host = typeof raw === "string" ? raw.trim() : ""
      if (host === "" || seen.has(host)) continue
      seen.add(host)
      out.push({ host, port: config.port, kind, current: host === config.host })
    }
  }
  take(info?.tailscale, "tailscale")
  take(info?.lan, "lan")
  return out
}

/** Validates the manual fields; null means "not a usable address yet". */
export function readAddress(host: string, port: string): { host: string; port: number } | null {
  const address = host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
  const number = Number.parseInt(port.trim(), 10)
  if (address === "" || /\s/.test(address)) return null
  if (!Number.isInteger(number) || number <= 0 || number > 65_535) return null
  return { host: address, port: number }
}

/** True when saving would change nothing — the screen can skip the reconnect. */
export function sameAddress(config: { host: string; port: number }, next: { host: string; port: number }): boolean {
  return config.host === next.host && config.port === next.port
}

/**
 * Asks a machine which addresses it answers on. Paired machines authenticate
 * with their session token; a machine that is unreachable, blocked or too old
 * simply throws, and the screen says so quietly.
 */
export async function fetchNetworkInfo(config: ConnectionConfig, signal?: AbortSignal): Promise<NetworkInfo> {
  const headers = config.token === undefined ? undefined : { authorization: `Bearer ${config.token}` }
  const response = await fetch(`${httpBase(config)}/network-info`, { headers, signal })
  if (!response.ok) throw new Error(`network-info refused (${response.status})`)
  return normalizeInfo(await response.json())
}

/** The response is another machine's JSON: trust nothing about its shape. */
export function normalizeInfo(body: unknown): NetworkInfo {
  if (typeof body !== "object" || body === null) return EMPTY_INFO
  const info = body as Partial<NetworkInfo>
  const hosts = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []
  return { lan: hosts(info.lan), tailscale: hosts(info.tailscale) }
}
