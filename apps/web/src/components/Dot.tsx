import type { Tone } from "../status"

export function Dot({ tone, small = false, title }: { tone: Tone; small?: boolean; title?: string }) {
  return <span className={`dot dot-${tone}${small ? " dot-small" : ""}`} title={title} />
}
