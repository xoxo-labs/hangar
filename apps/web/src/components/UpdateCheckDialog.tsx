import type { DesktopUpdateState } from "@hangar/contracts"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "../ui/Button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { describeCheckResult, resolveUpdateAction } from "./settingsUpdate.logic"

/**
 * The answer to "Check for Updates…" in the app menu. Everywhere else an update
 * announces itself only when there is one, which is the right default but makes
 * an explicit check indistinguishable from a dead menu item — so this reports
 * every outcome, including the boring one.
 *
 * `checkForUpdate()` resolves with the state *after* the check, so there is no
 * transition to observe: await it, then show what came back.
 */
export function UpdateCheckDialog({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<DesktopUpdateState | null>(null)

  useEffect(() => {
    let cancelled = false
    const desktop = window.hangarDesktop
    if (!desktop) {
      onClose()
      return
    }
    void desktop.checkForUpdate().then((state) => {
      if (!cancelled) setResult(state)
    })
    return () => {
      cancelled = true
    }
  }, [onClose])

  const described = result === null ? null : describeCheckResult(result)
  /* The same action the update row would offer — download, restart & install,
   * or retry. "check" is excluded: the user just did that. */
  const action = result === null ? null : resolveUpdateAction(result)
  const offered = action !== null && action.kind !== "check" ? action : null

  return createPortal(
    <Overlay onDismiss={onClose}>
      <Dialog
        label={described?.title ?? "Checking for updates"}
        className="max-w-[380px]"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <DialogHeader title={described?.title ?? "Checking for updates…"} />
        <DialogBody>
          <p className="m-0 text-sm text-surface-10" aria-live="polite">
            {described?.body ?? "Asking the update feed."}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{offered === null ? "Done" : "Not now"}</Button>
          {offered !== null && (
            <Button
              variant="primary"
              onClick={() => {
                if (offered.kind === "install") void window.hangarDesktop?.installUpdate()
                else void window.hangarDesktop?.downloadUpdate()
                onClose()
              }}
            >
              {offered.label}
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </Overlay>,
    document.body,
  )
}
