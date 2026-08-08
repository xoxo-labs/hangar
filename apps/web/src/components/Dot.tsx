import type { Tone } from "../status"
import { cx } from "../ui/cx"

const TONE: Record<Tone, string> = {
  running: "bg-success-10 shadow-glow shadow-success-a6",
  warning: "bg-warning-10 shadow-glow shadow-warning-a6",
  idle: "bg-surface-8",
  done: "bg-surface-10",
  failed: "bg-danger-10 shadow-glow shadow-danger-a6",
}

export function Dot({ tone, small = false, title }: { tone: Tone; small?: boolean; title?: string }) {
  return (
    <span className={cx("flex-none rounded-full", small ? "size-[6px]" : "size-[8px]", TONE[tone])} title={title} />
  )
}
