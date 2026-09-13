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
 * "Update available", "Downloading (42%)", "Restart to update", "Restarting…"
 * — instead of the old 30px icon nobody noticed. One per machine with
 * something to say: this Mac's own updater, and every paired Mac whose
 * desktop app reports one. Settings keeps the full update row — this is the
 * shortcut, and it is simply absent whenever there is nothing to say.
 */
export function SidebarUpdateButton({
  update,
  restarting = false,
  machine,
  onDownload,
  onInstall,
}: {
  update: DesktopUpdateState | null
  restarting?: boolean
  /** Named for a paired Mac; this Mac's pill says nothing about where. */
  machine?: string
  onDownload: () => void
  onInstall: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const control = resolveSidebarUpdate(update, restarting)

  if (control === null) return null
  const text = machine === undefined ? control.text : `${machine} · ${control.text}`
  const label = machine === undefined ? control.label : `${machine}: ${control.label}`

  /* Dismissal hides the offer until the next launch — never a download in
   * flight or a staged install, which the user already asked for. */
  if (dismissed && control.kind === "download" && control.percent === null) return null

  if (control.kind === "restarting") {
    return (
      <div className={cx(PILL, "gap-[8px] px-[9px] opacity-60")} role="status" title={label}>
        <RotateCw className="size-[14px] flex-none animate-spin [animation-duration:1.6s]" aria-hidden="true" />
        <span>{text}</span>
      </div>
    )
  }

  /* Downloading is not clickable, so it is not a button. That also keeps the
   * percentage reachable: a button's descendants are presentational to screen
   * readers, which would swallow a progressbar role nested inside one. */
  if (control.percent !== null) {
    return (
      <div
        className={cx(PILL, "gap-[8px] px-[9px] opacity-60")}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={control.percent}
        title={label}
      >
        <Download className="size-[14px] flex-none" aria-hidden="true" />
        <span>{text}</span>
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
          title={label}
          aria-label={label}
          onClick={() => {
            if (install) setConfirming(true)
            else onDownload()
          }}
        >
          {install ? (
            <RotateCw className="size-[14px] flex-none" aria-hidden="true" />
          ) : (
            <Download className="size-[14px] flex-none" aria-hidden="true" />
          )}
          <span>{text}</span>
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
      {confirming && (
        <InstallDialog
          label={label}
          machine={machine}
          onClose={() => setConfirming(false)}
          onInstall={() => {
            setConfirming(false)
            onInstall()
          }}
        />
      )}
    </>
  )
}

/** Restarting kills every running process, so the pill click asks first. */
function InstallDialog({
  label,
  machine,
  onClose,
  onInstall,
}: {
  label: string
  machine: string | undefined
  onClose: () => void
  onInstall: () => void
}) {
  return createPortal(
    <Overlay onDismiss={onClose}>
      <Dialog
        label={label}
        className="max-w-[380px]"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
      >
        <DialogHeader title={machine === undefined ? "Restart to install" : `Restart ${machine} to install`} />
        <DialogBody>
          <p className="m-0 text-sm text-surface-10">
            {machine === undefined
              ? "Running processes will be stopped, then Hangar restarts on the new version."
              : `Running processes on ${machine} will be stopped, then Hangar restarts there on the new version. This window reconnects on its own.`}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onInstall}>
            Restart now
          </Button>
        </DialogFooter>
      </Dialog>
    </Overlay>,
    document.body,
  )
}
