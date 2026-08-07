import { useStore } from "../store"

const LABELS = {
  connecting: "connecting…",
  connected: "connected",
  reconnecting: "reconnecting…",
} as const

export function StatusBar() {
  const status = useStore((s) => s.status)
  const port = useStore((s) => s.port)
  const lastError = useStore((s) => s.lastError)

  return (
    <footer className="statusbar">
      <span className={`conn conn-${status}`}>
        <span className="conn-dot" aria-hidden="true" />
        {LABELS[status]}
      </span>
      {lastError !== null && <span className="statusbar-error">{lastError}</span>}
      <span className="statusbar-spacer" />
      <span className="statusbar-port">127.0.0.1:{port}</span>
    </footer>
  )
}
