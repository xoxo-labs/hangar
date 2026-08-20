import type { ConnectionConfig } from "@hangar/client-core"
import type { BrowserChoice, ShareHostChoice } from "@hangar/contracts"

export type NetworkInfo = { lan: string[]; tailscale: string[] }

export const EMPTY_NETWORK: NetworkInfo = { lan: [], tailscale: [] }

/** Base HTTP address of one machine's hangar server. */
export function serverOrigin(config: ConnectionConfig): string {
  return `${config.secure ? "https" : "http"}://${config.host}:${config.port}`
}

/** Paired machines authenticate with their session token; loopback is trusted as-is. */
export function authHeaders(config: ConnectionConfig): Record<string, string> | undefined {
  return config.token === undefined ? undefined : { authorization: `Bearer ${config.token}` }
}

/** Addresses one machine can be reached on. A paired machine answers the CORS preflight this triggers. */
export async function loadNetworkInfo(config: ConnectionConfig): Promise<NetworkInfo> {
  const response = await fetch(`${serverOrigin(config)}/network-info`, { headers: authHeaders(config) })
  if (!response.ok) throw new Error("Could not detect network addresses")
  return response.json() as Promise<NetworkInfo>
}

const NETWORK_POLL_MS = 10_000

type NetworkWatch = { listeners: Set<(info: NetworkInfo) => void>; timer: number; value: NetworkInfo }

const watches = new Map<string, NetworkWatch>()

/**
 * One poll per machine however many components ask — the inspector and every
 * session strip on screen share a single `/network-info` request.
 */
export function watchNetworkInfo(config: ConnectionConfig, onChange: (info: NetworkInfo) => void): () => void {
  const key = serverOrigin(config)
  let watch = watches.get(key)
  if (!watch) {
    const publish = (value: NetworkInfo) => {
      const live = watches.get(key)
      if (!live) return
      live.value = value
      for (const listener of live.listeners) listener(value)
    }
    const refresh = () => void loadNetworkInfo(config).then(publish, () => publish(EMPTY_NETWORK))
    watch = { listeners: new Set(), timer: window.setInterval(refresh, NETWORK_POLL_MS), value: EMPTY_NETWORK }
    watches.set(key, watch)
    refresh()
  }
  watch.listeners.add(onChange)
  onChange(watch.value)
  return () => {
    const live = watches.get(key)
    if (!live) return
    live.listeners.delete(onChange)
    if (live.listeners.size === 0) {
      window.clearInterval(live.timer)
      watches.delete(key)
    }
  }
}

export function shareUrl(
  port: number,
  choice: ShareHostChoice,
  customHost: string,
  network: NetworkInfo,
  /** Where the port lives when no better address is known: this Mac, or a paired machine's host. */
  fallbackHost = "localhost",
): { url: string; kind: "local" | "lan" | "tailscale" | "custom" | "direct" } {
  const custom = customHost
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
  if (choice === "custom" && custom) return { url: `http://${custom}:${port}`, kind: "custom" }
  if ((choice === "tailscale" || choice === "auto") && network.tailscale[0]) {
    return { url: `http://${network.tailscale[0]}:${port}`, kind: "tailscale" }
  }
  if ((choice === "lan" || choice === "auto") && network.lan[0]) {
    return { url: `http://${network.lan[0]}:${port}`, kind: "lan" }
  }
  return { url: `http://${fallbackHost}:${port}`, kind: fallbackHost === "localhost" ? "local" : "direct" }
}

/**
 * Where *this* browser should dial a detected port. An explicit choice is the
 * user saying which address of that machine actually answers — honoured here as
 * much as for a copied link. "Automatic" is not: it optimises for a link handed
 * to another device, while this browser already reaches the machine on the host
 * it is connected to, and a dev server that filters Host headers may well
 * refuse the LAN alias.
 */
export function openUrl(
  port: number,
  choice: ShareHostChoice,
  customHost: string,
  network: NetworkInfo,
  fallbackHost = "localhost",
): string {
  if (choice === "auto") return `http://${fallbackHost}:${port}`
  return shareUrl(port, choice, customHost, network, fallbackHost).url
}

const BROWSER_LABELS: Record<BrowserChoice, string> = {
  system: "system default browser",
  safari: "Safari",
  chrome: "Google Chrome",
  arc: "Arc",
  firefox: "Firefox",
  brave: "Brave",
  edge: "Microsoft Edge",
}

export function browserLabel(browser: BrowserChoice): string {
  return BROWSER_LABELS[browser]
}

/** Opens a detected service in the configured browser. */
export async function openPortUrl(url: string, browser: BrowserChoice): Promise<void> {
  if (window.hangarDesktop) {
    const error = await window.hangarDesktop.openUrl(url, browser)
    if (error) throw new Error(error)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

/** What a `hangar://…` link from the App Intents surface points at. */
export type DeepLinkTarget =
  | { kind: "project"; project: string }
  | { kind: "process"; project: string; process: string }

/**
 * Reads the two links Spotlight, Siri and Shortcuts hand back:
 * `hangar://project/<name>` and `hangar://process/<project>/<process>`. Both ids
 * are raw registry values in a URL path, so they arrive percent-encoded. Anything
 * else is null — a link we do not recognise is not one to guess at.
 */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  let link: URL
  try {
    link = new URL(url)
  } catch {
    return null
  }
  if (link.protocol !== "hangar:") return null

  // `hangar://project/<id>` parses the kind as the host and the id as the path.
  let id: string
  try {
    id = decodeURIComponent(link.pathname.replace(/^\//, ""))
  } catch {
    return null // a malformed escape: nothing to look up
  }
  if (id === "") return null
  if (link.host === "project") return { kind: "project", project: id }
  if (link.host !== "process") return null

  // The id is a sessionId(), which the server splits at its first slash; a
  // process name that contains one therefore keeps it.
  const slash = id.indexOf("/")
  if (slash < 1 || slash === id.length - 1) return null
  return { kind: "process", project: id.slice(0, slash), process: id.slice(slash + 1) }
}
