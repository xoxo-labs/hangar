import { SerializeAddon } from "@xterm/addon-serialize"
// @xterm/headless is CommonJS and exposes no named exports to Node's ESM
// loader; only the default (its module.exports) carries Terminal.
import headless from "@xterm/headless"

const { Terminal } = headless

/**
 * Scrollback the server keeps per session, in lines. xterm stores roughly a
 * dozen bytes per cell, so 3000 lines at 160 columns costs about 6 MB for a
 * session that actually fills them — worth it, because this is what lets a
 * reconnecting client be handed a screen rather than a replay of raw bytes.
 */
const SCREEN_SCROLLBACK_LINES = 3000

/**
 * A pty's screen as the process sees it: cursor position, scroll regions and
 * the alternate buffer included. Clients get this serialized, so a full-screen
 * program (docker compose's menu, turbo's TUI) reconnects intact instead of
 * having absolute cursor moves replayed against a differently sized terminal.
 */
export class Screen {
  private term: InstanceType<typeof Terminal>
  private addon: SerializeAddon
  /** Chunks handed to xterm so far; unchanged across a flush means all of them are parsed. */
  writes = 0

  constructor(size: { cols: number; rows: number }) {
    this.term = new Terminal({
      cols: size.cols,
      rows: size.rows,
      scrollback: SCREEN_SCROLLBACK_LINES,
      allowProposedApi: true,
    })
    this.addon = new SerializeAddon()
    this.term.loadAddon(this.addon)
  }

  write(data: string): void {
    this.writes += 1
    this.term.write(data)
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows }
  }

  /** xterm parses writes on its own schedule; serialize is only true after this. */
  flush(): Promise<void> {
    return new Promise((resolve) => this.term.write("", () => resolve()))
  }

  /** Scrollback, viewport, modes and the alternate buffer when one is active. */
  serialize(): string {
    return this.addon.serialize()
  }

  /** Plain text of the last lines, for exit diagnosis. Empty for an untouched screen. */
  tailText(chars: number): string {
    const buffer = this.term.buffer.active
    let end = buffer.length
    while (end > 0 && (buffer.getLine(end - 1)?.translateToString(true) ?? "") === "") end -= 1
    const lines: string[] = []
    let budget = chars
    for (let index = end - 1; index >= 0 && budget > 0; index -= 1) {
      const line = buffer.getLine(index)?.translateToString(true) ?? ""
      lines.push(line)
      budget -= line.length + 1
    }
    return lines.reverse().join("\n")
  }

  dispose(): void {
    this.term.dispose()
  }
}
