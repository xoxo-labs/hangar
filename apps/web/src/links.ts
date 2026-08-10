import type { BrowserChoice, ShareHostChoice } from "@hangar/contracts"

export type NetworkInfo = { lan: string[]; tailscale: string[] }

export async function loadNetworkInfo(port: number): Promise<NetworkInfo> {
  const response = await fetch(`http://127.0.0.1:${port}/network-info`)
  if (!response.ok) throw new Error("Could not detect network addresses")
  return response.json() as Promise<NetworkInfo>
}

export function shareUrl(
  port: number,
  choice: ShareHostChoice,
  customHost: string,
  network: NetworkInfo,
): { url: string; kind: "local" | "lan" | "tailscale" | "custom" } {
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
  return { url: `http://localhost:${port}`, kind: "local" }
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

/** Opens a detected localhost service in the configured browser. */
export async function openLocalPort(port: number, browser: BrowserChoice): Promise<void> {
  const url = `http://localhost:${port}`
  if (window.hangarDesktop) {
    const error = await window.hangarDesktop.openUrl(url, browser)
    if (error) throw new Error(error)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
