import type { ButtonHTMLAttributes } from "react"
import { cx } from "./cx"

/*
 * Ports of the retired `.button` family from styles.css. `enabled:` guards the
 * hover styles because the old rules relied on source order to let :disabled
 * win over :hover, and utility order is not something to lean on.
 */
const VARIANTS = {
  default: "border border-surface-5 bg-surface-a3 text-surface-12 enabled:hover:bg-surface-a4 disabled:opacity-35",
  primary: "border border-transparent bg-accent-9 font-book text-white enabled:hover:bg-accent-10 disabled:opacity-35",
  danger: "border border-transparent bg-transparent text-danger-10 enabled:hover:bg-danger-a3 disabled:opacity-35",
} as const

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
}

export function Button({ variant = "default", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      data-dialog-action=""
      data-dialog-primary={variant === "primary" ? "" : undefined}
      className={cx("rounded-md px-[11px] py-[5px] text-base disabled:cursor-default", VARIANTS[variant], className)}
      {...rest}
    />
  )
}
