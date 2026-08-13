/**
 * The phone shows session output read-only, so terminal control sequences are
 * dropped at render time instead of being interpreted: the ring buffer keeps the
 * raw text the server sent, and only what reaches a <Text> is cleaned up.
 */

/**
 * OSC first: a window-title sequence carries free text (spaces included) up to a
 * BEL or a string terminator, which the CSI pattern below would only half-eat.
 */
const OSC = new RegExp("[\\u001B\\u009D]\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)?", "g")

/** CSI and the single-character escapes around it — the `ansi-regex` pattern. */
const CSI = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*" +
    "(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)" +
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nqry=><~]))",
  "g",
)

/** Whatever control characters survive the sequences above, minus tab and newline. */
const LEFTOVER_CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g")

export function stripAnsi(input: string): string {
  return input.replace(OSC, "").replace(CSI, "")
}

/**
 * Splits a chunk of terminal output into display lines. A `\r` rewrites the line
 * it sits on (progress bars, spinners), so only the text after the last carriage
 * return survives.
 */
export function toLines(input: string): string[] {
  // A PTY ends every line with CRLF; that pair is a line break, not a rewrite.
  const text = stripAnsi(input).replace(/\r\n/g, "\n")
  return text.split("\n").map((line) => {
    const rewrites = line.split("\r")
    return (rewrites[rewrites.length - 1] ?? "").replace(LEFTOVER_CONTROL, "")
  })
}

/** The tail of a log: a long-running process must not make the list view unbounded. */
export function visibleLines(input: string, limit: number): string[] {
  const lines = toLines(input)
  // A trailing newline is where the cursor sits, not an empty last line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines.length > limit ? lines.slice(lines.length - limit) : lines
}
