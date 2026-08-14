/**
 * The phone shows session output read-only, so terminal control sequences are
 * dropped at render time instead of being interpreted: the ring buffer keeps the
 * raw text the server sent, and only what reaches a <Text> is cleaned up.
 *
 * Colour is the one thing that survives the cleanup. SGR (`ESC[…m`) sequences
 * are kept through line splitting and handed to `anser`, which turns a whole
 * buffer into coloured spans — parsing the buffer in one go is what lets a
 * colour opened on one line still apply to the next, the way a terminal does.
 */

import Anser, { type AnserJsonEntry } from "anser"

/*
 * The terminal palette lives here rather than in theme.ts on purpose: this
 * module is covered by `node --test`, and theme.ts reaches for react-native's
 * `Platform`. These are xterm.js's default dark tones — the same ones the
 * desktop app's terminals paint with, which only override background and
 * foreground (see `apps/web/src/terminals.ts`); plain text keeps the view's own
 * foreground here, so a default-coloured log looks identical on both.
 */
const ANSI_COLOR: Record<string, string> = {
  black: "#2e3436",
  red: "#cc0000",
  green: "#4e9a06",
  yellow: "#c4a000",
  blue: "#3465a4",
  magenta: "#75507b",
  cyan: "#06989a",
  white: "#d3d7cf",
  "bright-black": "#555753",
  "bright-red": "#ef2929",
  "bright-green": "#8ae234",
  "bright-yellow": "#fce94f",
  "bright-blue": "#729fcf",
  "bright-magenta": "#ad7fa8",
  "bright-cyan": "#34e2e2",
  "bright-white": "#eeeeec",
}

/** `dim` with no colour of its own: mauve-10, the muted tone from theme.ts. */
const ANSI_DIM = "#7c7a85"

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

/** The colour half of CSI: `ESC[…m`, the only sequence the log view keeps. */
const SGR = new RegExp("[\\u001B\\u009B]\\[[\\d;:]*m", "g")

/** Whatever control characters survive the sequences above, minus tab and newline. */
const LEFTOVER_CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g")

/** The same, sparing ESC — the colour path still has SGR sequences to hand on. */
const LEFTOVER_CONTROL_KEEP_ESC = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001A\\u001C-\\u001F\\u007F]",
  "g",
)

export function stripAnsi(input: string): string {
  return input.replace(OSC, "").replace(CSI, "")
}

/**
 * One pass over the same sequences `stripAnsi` eats, with the colour half put
 * back: SGR is the first alternative, so it wins the match and comes back
 * untouched while everything else falls through to the drop. Alternation keeps
 * the two patterns in sync the way a CSI-minus-SGR pattern could not.
 */
const KEEP_COLOR = new RegExp(`(${SGR.source})|${OSC.source}|${CSI.source}`, "g")

export function stripExceptColor(input: string): string {
  return input.replace(KEEP_COLOR, (_match, sgr: string | undefined) => sgr ?? "")
}

/**
 * Splits a chunk of terminal output into display lines. A `\r` rewrites the line
 * it sits on (progress bars, spinners), so only the text after the last carriage
 * return survives.
 */
export function toLines(input: string): string[] {
  return splitLines(stripAnsi(input))
}

/**
 * `control` is what still has to go once the sequences are out. The colour path
 * passes the variant that spares ESC: every ESC left in its input opens an SGR
 * it wants to keep, and the general class would eat it and leave `[33m` behind
 * as text.
 */
function splitLines(cleaned: string, control = LEFTOVER_CONTROL): string[] {
  // A PTY ends every line with CRLF; that pair is a line break, not a rewrite.
  return cleaned
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const rewrites = line.split("\r")
      return (rewrites[rewrites.length - 1] ?? "").replace(control, "")
    })
}

/** The tail of a log: a long-running process must not make the list view unbounded. */
function tail(lines: string[], limit: number): string[] {
  // A trailing newline is where the cursor sits, not an empty last line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines.length > limit ? lines.slice(lines.length - limit) : lines
}

/** One run of same-looking text inside a log line. */
export type Span = {
  text: string
  /** Undefined means "the view's default foreground". */
  color?: string
  bold?: boolean
  underline?: boolean
}

/**
 * The tail of a log as coloured spans, one array per display line. The visible
 * lines go through `anser` in one pass, so a colour opened on one line still
 * applies to the next; the cut to `limit` happens first, which keeps a 200 KB
 * ring buffer from being re-parsed on every frame and costs only the colour of
 * a run that opened above the visible window.
 */
export function visibleSpans(input: string, limit: number): Span[][] {
  const lines = tail(splitLines(stripExceptColor(input), LEFTOVER_CONTROL_KEEP_ESC), limit)
  return spanLines(lines.join("\n"))
}

/** Turns SGR-carrying text into one span array per line. */
export function spanLines(text: string): Span[][] {
  const lines: Span[][] = [[]]
  for (const chunk of Anser.ansiToJson(text, { json: true, use_classes: true, remove_empty: false })) {
    const parts = chunk.content.split("\n")
    for (const [index, part] of parts.entries()) {
      if (index > 0) lines.push([])
      if (part === "") continue
      const line = lines[lines.length - 1]
      if (line) line.push(spanOf(part, chunk))
    }
  }
  return lines
}

function spanOf(text: string, chunk: AnserJsonEntry): Span {
  const span: Span = { text }
  const color = colorOf(chunk.fg, chunk.fg_truecolor)
  if (color !== undefined) span.color = chunk.decoration === "dim" ? dim(color) : color
  else if (chunk.decoration === "dim") span.color = ANSI_DIM
  if (chunk.decoration === "bold") span.bold = true
  if (chunk.decoration === "underline") span.underline = true
  return span
}

/**
 * An anser colour class (`ansi-red`, `ansi-bright-blue`, `ansi-palette-N`,
 * `ansi-truecolor`) resolved against the app's terminal palette.
 */
export function colorOf(klass: string | null | undefined, truecolor?: string | null): string | undefined {
  if (!klass) return undefined
  if (klass === "ansi-truecolor") return truecolor ? rgb(truecolor) : undefined
  const palette = klass.match(/^ansi-palette-(\d+)$/)
  if (palette?.[1] !== undefined) return paletteColor(Number(palette[1]))
  return ANSI_COLOR[klass.replace(/^ansi-/, "")]
}

function rgb(triplet: string): string | undefined {
  const parts = triplet.split(",").map((part) => Number(part.trim()))
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`
}

const CUBE_STEPS = [0, 95, 135, 175, 215, 255]

/** xterm's 256-colour table: 16 named, a 6×6×6 cube, then 24 greys. */
export function paletteColor(index: number): string | undefined {
  if (index < 0 || index > 255) return undefined
  if (index < 16) return ANSI_COLOR[NAMED[index] ?? ""]
  if (index < 232) {
    const value = index - 16
    const step = (n: number): number => CUBE_STEPS[n] ?? 0
    return `rgb(${step(Math.floor(value / 36))}, ${step(Math.floor(value / 6) % 6)}, ${step(value % 6)})`
  }
  const grey = 8 + (index - 232) * 10
  return `rgb(${grey}, ${grey}, ${grey})`
}

const NAMED = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
]

/** `dim` is an opacity in a terminal; on a phone it is a colour, so bake it in. */
function dim(color: string): string {
  return color.startsWith("#") && color.length === 7 ? `${color}b0` : color
}

/**
 * The break opportunity a phone-width log needs. A 300-character line of words
 * wraps on its spaces, but a URL or a base64 blob has none — with no break
 * opportunity in it the text engine lays such a run out as one unbreakable box
 * and it spills past the viewport. A zero-width space every `chunk` characters
 * of an otherwise unbreakable run gives the engine somewhere to fold; it takes
 * no width and copies as nothing.
 */
export const ZERO_WIDTH_SPACE = "\u200B"

/** Runs longer than this keep their break opportunities; anything longer gets some. */
export const WRAP_CHUNK = 16

export function softWrap(text: string, chunk = WRAP_CHUNK): string {
  if (text.length <= chunk) return text
  const unbreakable = new RegExp(`[^\\s${ZERO_WIDTH_SPACE}]{${chunk + 1},}`, "g")
  return text.replace(unbreakable, (run) => {
    const pieces: string[] = []
    for (let index = 0; index < run.length; index += chunk) pieces.push(run.slice(index, index + chunk))
    return pieces.join(ZERO_WIDTH_SPACE)
  })
}
