import type { ButtonHTMLAttributes } from "react"
import { cx } from "./cx"

/** Port of the retired `.icon-button` from styles.css: a 26px square hit area. */
export function IconButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "grid size-[26px] place-items-center rounded-md text-[14px] leading-none text-surface-10",
        "enabled:hover:bg-surface-a4 enabled:hover:text-surface-12 disabled:cursor-default disabled:opacity-30",
        className,
      )}
      {...rest}
    />
  )
}
