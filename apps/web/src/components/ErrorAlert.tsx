import { TriangleAlert, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"

/**
 * How long an error stays up on its own. Long enough to read a sentence; the
 * hover pause below is what covers messages that take longer than that.
 */
const DISMISS_MS = 9_000

/**
 * The app's one error surface. It used to be a truncated line in the status
 * bar, which was both easy to miss and impossible to clear — server errors set
 * `lastError` and nothing ever unset it. So: readable at a glance, wrapped
 * rather than ellipsed, and always dismissible.
 *
 * The countdown pauses on hover and on focus, because the messages worth
 * showing here are the ones worth acting on — Tailscale's funnel refusal, for
 * one, arrives as a paragraph containing the admin link that fixes it, and a
 * timer that expired mid-read would be worse than no timer at all.
 */
export function ErrorAlert() {
  const lastError = useStore((s) => s.lastError)
  const setError = useStore((s) => s.setError)
  const [held, setHeld] = useState(false)
  const dismiss = useRef(setError)
  dismiss.current = setError

  useEffect(() => {
    if (lastError === null || held) return
    const timer = setTimeout(() => dismiss.current(null), DISMISS_MS)
    return () => clearTimeout(timer)
  }, [lastError, held])

  useEffect(() => {
    if (lastError === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lastError])

  if (lastError === null) return null

  return (
    // Above the status bar rather than inside it: a message that needs a line
    // of its own cannot live in a 28px strip shared with four other controls.
    <div
      role="alert"
      aria-live="assertive"
      className="fixed right-2 bottom-9 z-[60] flex w-[min(420px,calc(100vw-1rem))] animate-[status-notice-in_140ms_ease-out] items-start gap-2 rounded-lg border border-danger-7 bg-danger-3 p-2.5 shadow-[0_10px_30px_#0008]"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <TriangleAlert className="mt-px size-4 flex-none text-danger-11" aria-hidden="true" />
      {/* select-text: these messages carry URLs and ports worth copying. */}
      <p className="m-0 min-w-0 flex-1 select-text text-xs leading-normal break-words whitespace-pre-wrap text-danger-11">
        {lastError}
      </p>
      <button
        type="button"
        className="flex-none rounded-sm p-0.5! text-danger-11 hover:bg-danger-a4!"
        title="Dismiss"
        aria-label="Dismiss error"
        onClick={() => setError(null)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
