import { sessionId } from "@hangar/contracts"
import { useEffect } from "react"
import * as actions from "../actions"
import { markCloseOnExit, useStore } from "../store"
import { Button } from "../ui/Button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"

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
  "stop-close": {
    title: "Stop",
    body: "will be terminated and its tab closed.",
    button: "Stop & close",
    danger: true,
  },
} as const

/** The stop/restart confirmation: a small modal, Esc or backdrop to cancel. */
export function ConfirmDialog() {
  const confirming = useStore((s) => s.confirming)
  const closeConfirm = useStore((s) => s.closeConfirm)

  useEffect(() => {
    if (!confirming) return
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
    if (confirming.action === "restart") {
      actions.restart(confirming.project, confirming.process)
    } else {
      if (confirming.action === "stop-close" && confirming.process) {
        markCloseOnExit(sessionId(confirming.project, confirming.process))
      }
      actions.stop(confirming.project, confirming.process)
    }
    closeConfirm()
  }

  const title = `${copy.title} ${confirming.process ?? "all processes"}?`

  return (
    <Overlay onDismiss={closeConfirm}>
      <Dialog label={title} role="alertdialog" className="w-[380px]">
        <DialogHeader title={title} />
        <DialogBody>
          <p className="m-0 text-[13px] leading-[1.5] text-surface-11 [&_code]:text-surface-12">
            <code>{target}</code> {copy.body}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={closeConfirm}>Cancel</Button>
          {/* Keyed so a new confirm target remounts the button and re-fires autoFocus. */}
          <Button
            key={`${confirming.action}:${confirming.project}:${confirming.process ?? ""}`}
            autoFocus
            variant={copy.danger ? "danger" : "primary"}
            onClick={run}
          >
            {copy.button}
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>
  )
}
