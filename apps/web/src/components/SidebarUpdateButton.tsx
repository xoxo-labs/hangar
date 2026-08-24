import type { DesktopUpdateState } from "@hangar/contracts"
import { Download, RotateCw, X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { resolveSidebarUpdate } from "./settingsUpdate.logic"

const PILL = "flex h-[28px] w-full items-center rounded-md bg-accent-a3 text-sm font-book text-accent-11"

/**
 * The update affordance above the sidebar footer: a full-width labeled pill —
 * "Update available", "Downloading (42%)", "Restart to update" — instead of the
 * old 30px icon nobody noticed. Settings keeps the full update row — this is
 * the shortcut, and it is simply absent whenever there is nothing to say,
 * including in a browser where `update` is always null.
 */
export function SidebarUpdateButton({ update }: { update: DesktopUpdateState | null }) {
  const [confirming, setConfirming] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const control = resolveSidebarUpdate(update)

  if (control === null) return null

  /* Dismissal hides the offer until the next launch — never a download in
   * flight or a staged install, which the user already asked for. */
  if (dismissed && control.kind === "download" && control.percent === null) return null

  /* Downloading is not clickable, so it is not a button. That also keeps the
   * percentage reachable: a button's descendants are presentational to screen
   * readers, which would swallow a progressbar role nested inside one. */
  if (control.percent !== null) {
    return (
      <div
        className={cx(PILL, "gap-[8px] px-[9px] opacity-60")}
        role="progressbar"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={control.percent}
        title={control.label}
      >
        <Download className="size-[14px] flex-none" aria-hidden="true" />
        <span>{control.text}</span>
      </div>
    )
  }

  const install = control.kind === "install"
  return (
    <>
      <div className={cx("group/update relative", PILL)}>
        {/* Hover paint lives on an overlay keyed to the main button alone, so
         * pointing at the dismiss X does not light up the whole pill. */}
        <div className="pointer-events-none absolute inset-0 rounded-md transition-colors group-has-[button.update-main:hover]/update:bg-accent-a4" />
        <button
          type="button"
          className="update-main relative flex h-full flex-1 items-center gap-[8px] px-[9px] text-left"
          title={control.label}
          aria-label={control.label}
          onClick={() => {
            if (install) setConfirming(true)
            else void window.hangarDesktop?.downloadUpdate()
          }}
        >
          {install ? (
            <RotateCw className="size-[14px] flex-none" aria-hidden="true" />
          ) : (
            <Download className="size-[14px] flex-none" aria-hidden="true" />
          )}
          <span>{control.text}</span>
        </button>
        {!install && (
          <button
            type="button"
            className="relative mr-[4px] grid size-[20px] flex-none place-items-center rounded text-accent-9 transition-colors hover:text-accent-11"
            title="Dismiss until next launch"
            aria-label="Dismiss until next launch"
            onClick={() => setDismissed(true)}
          >
            <X className="size-[13px]" aria-hidden="true" />
          </button>
        )}
      </div>
      {confirming && <InstallDialog label={control.label} onClose={() => setConfirming(false)} />}
    </>
  )
}

/** Restarting kills every running process, so the pill click asks first. */
function InstallDialog({ label, onClose }: { label: string; onClose: () => void }) {
  return createPortal(
    <Overlay onDismiss={onClose}>
      <Dialog
        label={label}
        className="max-w-[380px]"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <DialogHeader title="Restart to install" />
        <DialogBody>
          <p className="m-0 text-sm text-surface-10">
            Running processes will be stopped, then Hangar restarts on the new version.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void window.hangarDesktop?.installUpdate()}>
            Restart now
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>,
    document.body,
  )
}
