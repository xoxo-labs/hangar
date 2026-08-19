import type { DesktopUpdateState } from "@hangar/contracts"
import { Download, RotateCw } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "../ui/Button"
import { cx } from "../ui/cx"
import { Dialog, DialogBody, DialogFooter, DialogHeader, Overlay } from "../ui/Dialog"
import { resolveSidebarUpdate } from "./settingsUpdate.logic"

/* The ring is drawn inside the control's own 30px box: r=13 keeps the 1.5px
 * stroke clear of the edge, and the dash offset walks the full circumference
 * from whole (0%) to nothing (100%). The -90° turn starts it at twelve. */
const RING_RADIUS = 13
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

const BOX = "relative grid size-[30px] flex-none place-items-center rounded-md bg-accent-a3! text-accent-11!"

/**
 * The one-click update affordance in the sidebar footer: a download arrow while
 * an update is waiting, wrapped in a progress ring while it downloads, then a
 * restart glyph once it is staged. Settings keeps the full update row — this is
 * the shortcut, and it is simply absent whenever there is nothing to click,
 * including in a browser where `update` is always null.
 */
export function SidebarUpdateButton({ update }: { update: DesktopUpdateState | null }) {
  const [confirming, setConfirming] = useState(false)
  const control = resolveSidebarUpdate(update)

  if (control === null) return null

  /* Downloading is not clickable, so it is not a button. That also keeps the
   * percentage reachable: a button's descendants are presentational to screen
   * readers, which would swallow a progressbar role nested inside one. */
  if (control.percent !== null) {
    return (
      <div
        className={BOX}
        role="progressbar"
        aria-label={control.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={control.percent}
        title={control.label}
      >
        <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 30 30" aria-hidden="true">
          <circle
            cx="15"
            cy="15"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1.5"
          />
          <circle
            cx="15"
            cy="15"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - control.percent / 100)}
            strokeLinecap="round"
            strokeWidth="1.5"
            className="transition-[stroke-dashoffset] duration-[250ms] ease-out motion-reduce:transition-none"
          />
        </svg>
        <Download className="size-[15px]" aria-hidden="true" />
      </div>
    )
  }

  const install = control.kind === "install"
  return (
    <>
      <button
        type="button"
        className={cx(BOX, "hover:bg-accent-a4!")}
        title={control.label}
        aria-label={control.label}
        onClick={() => {
          if (install) setConfirming(true)
          else void window.hangarDesktop?.downloadUpdate()
        }}
      >
        {install ? (
          <RotateCw className="size-[15px]" aria-hidden="true" />
        ) : (
          <Download className="size-[15px]" aria-hidden="true" />
        )}
      </button>
      {confirming && <InstallDialog label={control.label} onClose={() => setConfirming(false)} />}
    </>
  )
}

/** Restarting kills every running process, so the icon click asks first. */
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
