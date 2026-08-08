import type { SessionMetrics } from "@hangar/contracts"
import { useCallback, useEffect, useState } from "react"
import { loadNetworkInfo, openLocalPort, shareUrl, type NetworkInfo } from "../links"
import { useStore } from "../store"

const EMPTY_NETWORK: NetworkInfo = { lan: [], tailscale: [] }
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"])

/** Network discovery and open/copy actions for the inspector's detected ports. */
export function usePortLinks(metrics: SessionMetrics | undefined) {
  const links = useStore((state) => state.settings.links)
  const serverPort = useStore((state) => state.port)
  const showNotice = useStore((state) => state.showNotice)
  const [network, setNetwork] = useState<NetworkInfo>(EMPTY_NETWORK)

  useEffect(() => {
    const refresh = () =>
      void loadNetworkInfo(serverPort)
        .then(setNetwork)
        .catch(() => setNetwork(EMPTY_NETWORK))
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(timer)
  }, [serverPort])

  const openPort = useCallback(
    (port: number) => {
      void openLocalPort(port, links.browser).catch(() => showNotice(`Could not open port ${port}`))
    },
    [links.browser, showNotice],
  )

  const copyPort = useCallback(
    async (port: number): Promise<void> => {
      try {
        // Refresh at copy time so a Tailscale login/logout cannot produce a stale link.
        const fresh = await loadNetworkInfo(serverPort)
        setNetwork(fresh)
        const shared = shareUrl(port, links.shareHost, links.customHost, fresh)
        await navigator.clipboard.writeText(shared.url)
        showNotice(`Copied ${shared.kind} link`)
      } catch {
        showNotice("Could not copy link")
      }
    },
    [links.customHost, links.shareHost, serverPort, showNotice],
  )

  const linkForPort = useCallback(
    (port: number) => shareUrl(port, links.shareHost, links.customHost, network),
    [links.customHost, links.shareHost, network],
  )

  const isLoopbackOnly = useCallback(
    (port: number): boolean => {
      const bindings = metrics?.portBindings?.[port] ?? []
      return bindings.length > 0 && bindings.every((host) => LOOPBACK_HOSTS.has(host))
    },
    [metrics?.portBindings],
  )

  return { openPort, copyPort, linkForPort, isLoopbackOnly }
}
