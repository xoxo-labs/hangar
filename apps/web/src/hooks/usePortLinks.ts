import { LOCAL_CONN_ID } from "@hangar/client-core"
import type { BrowserChoice, SessionMetrics } from "@hangar/contracts"
import { useCallback, useEffect, useState } from "react"
import { loadNetworkInfo, openPortUrl, portUrl, shareUrl, type NetworkInfo } from "../links"
import { connectionOf, useStore } from "../store"

const EMPTY_NETWORK: NetworkInfo = { lan: [], tailscale: [] }
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"])

/**
 * Network discovery and open/copy actions for the inspector's detected ports.
 * Everything is resolved on the machine that owns the session: its `network-info`,
 * its link settings, its host.
 */
export function usePortLinks(connId: string, metrics: SessionMetrics | undefined, browserOverride?: BrowserChoice) {
  const config = useStore((state) => connectionOf(state.connections, connId).config)
  const links = useStore((state) => connectionOf(state.connections, connId).settings.links)
  const showNotice = useStore((state) => state.showNotice)
  const browser = browserOverride ?? links.browser
  const [network, setNetwork] = useState<NetworkInfo>(EMPTY_NETWORK)

  useEffect(() => {
    const refresh = () =>
      void loadNetworkInfo(config)
        .then(setNetwork)
        .catch(() => setNetwork(EMPTY_NETWORK))
    refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(timer)
  }, [config])

  const openPort = useCallback(
    (port: number) => {
      void openPortUrl(portUrl(config, port), browser).catch(() => showNotice(`Could not open port ${port}`))
    },
    [browser, config, showNotice],
  )

  const copyPort = useCallback(
    async (port: number): Promise<void> => {
      try {
        // Refresh at copy time so a Tailscale login/logout cannot produce a stale link.
        const fresh = await loadNetworkInfo(config)
        setNetwork(fresh)
        const shared = shareUrl(port, links.shareHost, links.customHost, fresh, fallbackHost(config))
        await navigator.clipboard.writeText(shared.url)
        showNotice(`Copied ${shared.kind} link`)
      } catch {
        showNotice("Could not copy link")
      }
    },
    [config, links.customHost, links.shareHost, showNotice],
  )

  const linkForPort = useCallback(
    (port: number) => shareUrl(port, links.shareHost, links.customHost, network, fallbackHost(config)),
    [config, links.customHost, links.shareHost, network],
  )

  const isLoopbackOnly = useCallback(
    (port: number): boolean => {
      const bindings = metrics?.portBindings?.[port] ?? []
      return bindings.length > 0 && bindings.every((host) => LOOPBACK_HOSTS.has(host))
    },
    [metrics?.portBindings],
  )

  return { openPort, copyPort, linkForPort, isLoopbackOnly, browser }
}

function fallbackHost(config: { id: string; host: string }): string {
  return config.id === LOCAL_CONN_ID ? "localhost" : config.host
}
