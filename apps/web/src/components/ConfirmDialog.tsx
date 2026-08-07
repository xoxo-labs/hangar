import { useEffect, useRef } from "react"
import * as actions from "../actions"
import { useStore } from "../store"

const COPY = {
  stop: {
    title: "Stop",
    body: "will be terminated.",
    button: "Stop",
    danger: true,
  },
  restart: {
    title: "Restart",
    body: "will be stopped and started again.",
    button: "Restart",
    danger: false,
  },
} as const

/** The stop/restart confirmation: a small modal, Esc or backdrop to cancel. */
export function ConfirmDialog() {
  const confirming = useStore((s) => s.confirming)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!confirming) return
    confirmButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeConfirm()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirming, closeConfirm])

  if (!confirming) return null

  const copy = COPY[confirming.action]
  const target = confirming.process
    ? `${confirming.project}/${confirming.process}`
    : `every process of ${confirming.project}`

  const run = () => {
    if (confirming.action === "stop") actions.stop(confirming.project, confirming.process)
    else actions.restart(confirming.project, confirming.process)
    closeConfirm()
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeConfirm()}>
      <div className="dialog slim" role="alertdialog" aria-modal="true">
        <header className="dialog-header">
          <h2>
            {copy.title} {confirming.process ?? "all processes"}?
          </h2>
        </header>
        <div className="dialog-body">
          <p className="confirm-text">
            <code>{target}</code> {copy.body}
          </p>
        </div>
        <footer className="dialog-footer">
          <button type="button" className="button" onClick={closeConfirm}>
            Cancel
          </button>
          <button
            ref={confirmButton}
            type="button"
            className={`button ${copy.danger ? "danger" : "primary"}`}
            onClick={run}
          >
            {copy.button}
          </button>
        </footer>
      </div>
    </div>
  )
}
