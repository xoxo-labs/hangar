import { useStore } from "../store"

/**
 * An action that shouldn't fire on a stray click: the first click arms the
 * button, a second one within `ARM_TIMEOUT` runs it. Only one button is armed
 * at a time, and the arm dies with the timeout, a blur, or the pointer leaving
 * the row.
 */
export function ArmedButton({
  armKey,
  title,
  armedTitle,
  glyph,
  disabled,
  className = "icon-button",
  onConfirm,
}: {
  armKey: string
  title: string
  armedTitle: string
  glyph: string
  disabled?: boolean
  className?: string
  onConfirm: () => void
}) {
  const armed = useStore((s) => s.armed === armKey)
  const arm = useStore((s) => s.arm)
  const disarm = useStore((s) => s.disarm)

  return (
    <button
      type="button"
      className={`${className}${armed ? " armed" : ""}`}
      title={armed ? armedTitle : title}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          arm(armKey)
          return
        }
        disarm(armKey)
        onConfirm()
      }}
      onBlur={() => disarm(armKey)}
    >
      {glyph}
    </button>
  )
}
