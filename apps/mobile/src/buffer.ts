/**
 * Per-session scrollback. A phone holds a modest slice of what a Mac's terminal
 * keeps: `snapshot` replaces the buffer, `output` appends, and the oldest lines
 * fall off the front once the buffer passes the cap.
 */

/** ~200 KB of mostly-ASCII terminal output. */
export const BUFFER_LIMIT = 200_000

/** Trims from the front, at a line boundary when one is close enough. */
export function trimBuffer(text: string, limit = BUFFER_LIMIT): string {
  if (text.length <= limit) return text
  const cut = text.length - limit
  const newline = text.indexOf("\n", cut)
  // Only snap forward to a line start while it stays within the last 10% of the
  // buffer; a single enormous line must not empty the whole thing.
  if (newline !== -1 && newline - cut < limit / 10) return text.slice(newline + 1)
  return text.slice(cut)
}

export function appendBuffer(previous: string | undefined, chunk: string, limit = BUFFER_LIMIT): string {
  return trimBuffer((previous ?? "") + chunk, limit)
}
