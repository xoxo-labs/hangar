import type { BrowserChoice } from "@hangar/contracts"

/** Opens a detected localhost service in the configured browser. */
export async function openLocalPort(port: number, browser: BrowserChoice): Promise<void> {
  const url = `http://127.0.0.1:${port}`
  if (window.hangarDesktop) {
    const error = await window.hangarDesktop.openUrl(url, browser)
    if (error) throw new Error(error)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
