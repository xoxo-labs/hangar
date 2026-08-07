import { useEffect, useState } from "react"
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
  const notice = useStore((s) => s.notice)
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    if (!detailsOpen) return
    const close = () => setDetailsOpen(false)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [detailsOpen])

  return (
    <footer className="statusbar">
      {lastError !== null && <span className="statusbar-error">{lastError}</span>}
      {notice !== null && <span className="statusbar-notice">✓ {notice}</span>}
      <span className="flex-1" />
      <div className="connection-control" onPointerDown={(event) => event.stopPropagation()}>
        <button
          className={`conn conn-${status}`}
          type="button"
          title="Hangar server details"
          aria-label={`Hangar server ${LABELS[status]}`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span className="conn-dot" aria-hidden="true" />
          {status !== "connected" && <span>{LABELS[status]}</span>}
        </button>
        {detailsOpen && <div className="connection-popover">
          <div className="connection-popover-title"><span className={`conn-dot conn-dot-${status}`} />Hangar server</div>
          <dl>
            <dt>Status</dt><dd>{LABELS[status]}</dd>
            <dt>Endpoint</dt><dd><code>127.0.0.1:{port}</code></dd>
            <dt>Access</dt><dd>Local only</dd>
          </dl>
        </div>}
      </div>
    </footer>
  )
}
