import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react"
import { cx } from "./cx"

/*
 * Ports of the retired `.field` / `.input` family from styles.css. `mono`
 * mirrors the old `.input.mono` (paths, font stacks); the select keeps its
 * hand-drawn caret as two gradient triangles because appearance:none eats the
 * native one.
 */

export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cx("flex flex-col items-start gap-[5px]", className)}>
      <span className="text-[11px] tracking-[0.02em] text-surface-10">{label}</span>
      {children}
      {hint !== undefined && <span className="text-[10.5px] text-surface-9">{hint}</span>}
    </label>
  )
}

const INPUT =
  "w-full min-w-0 rounded-[5px] border border-surface-5 bg-surface-1 px-2 py-[6px] text-surface-12 " +
  "placeholder:text-surface-7 read-only:bg-surface-a2 read-only:text-surface-10 " +
  "focus:border-accent-9 focus:shadow-[0_0_0_2px_var(--color-accent-a3)] focus:outline-none"

const FONT = { sans: "text-[12px] [font-family:inherit]", mono: "font-mono text-[11.5px]" }

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }

export function TextInput({ mono = false, className, ...rest }: TextInputProps) {
  return <input className={cx(INPUT, FONT[mono ? "mono" : "sans"], className)} {...rest} />
}

const CARET =
  "cursor-pointer appearance-none bg-no-repeat pr-7 disabled:cursor-default " +
  "[background-image:linear-gradient(45deg,transparent_50%,var(--color-surface-9)_50%),linear-gradient(135deg,var(--color-surface-9)_50%,transparent_50%)] " +
  "[background-position:calc(100%-13px)_50%,calc(100%-9px)_50%] [background-size:4px_4px,4px_4px]"

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { mono?: boolean }

export function Select({ mono = false, className, ...rest }: SelectProps) {
  return <select className={cx(INPUT, CARET, FONT[mono ? "mono" : "sans"], className)} {...rest} />
}
