import { type ConnectionConfig, LOCAL_CONN_ID } from "@hangar/client-core"
import type { BrowserChoice, ShareHostChoice } from "@hangar/contracts"

export type NetworkInfo = { lan: string[]; tailscale: string[] }

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

/** A detected port belongs to the machine that reported it: never localhost for a paired one. */
export function portUrl(config: ConnectionConfig, port: number): string {
  return config.id === LOCAL_CONN_ID ? `http://localhost:${port}` : `http://${config.host}:${port}`
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
