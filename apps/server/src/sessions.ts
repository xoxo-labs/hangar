import { chmodSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { spawn as ptySpawn, type IPty } from "node-pty"
import {
  sessionId,
  type Project,
  type ServerMsg,
  type SessionId,
  type SessionInfo,
} from "@hangar/contracts"
import { expandHome } from "./registry.ts"

/** Keep at most this much scrollback per session for late-joining clients. */
const MAX_BUFFER_CHARS = 512 * 1024
const KILL_GRACE_MS = 1500
/** Inherit the full environment except vars that would confuse dev servers. */
const ENV_BLOCKLIST = new Set(["PORT", "ELECTRON_RUN_AS_NODE", "HANGAR_PORT"])

// pnpm installs node-pty's spawn-helper without the executable bit, which makes
// every spawn die with "posix_spawnp failed." — chmod it once before first use.
let spawnHelperFixed = false
function ensureSpawnHelperExecutable(): void {
  if (spawnHelperFixed || process.platform === "win32") return
  spawnHelperFixed = true
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve("node-pty/package.json"))
  const candidates = [
    "build/Release/spawn-helper",
    "build/Debug/spawn-helper",
    `prebuilds/${process.platform}-${process.arch}/spawn-helper`,
  ]
  for (const rel of candidates) {
    try {
      chmodSync(join(root, rel), 0o755)
    } catch {}
  }
}

type Session = {
  id: SessionId
  project: string
  process: string
  cmd: string
  pty: IPty | null
  pid: number | undefined
  status: "running" | "exited"
  exitCode: number | null
  buffer: string
  killTimer: NodeJS.Timeout | null
}

export class SessionManager {
  private sessions = new Map<SessionId, Session>()

  /** Push a message to every connected client. */
  private broadcast: (msg: ServerMsg) => void
  /** Ask the server to re-broadcast the full state (registry + sessions). */
  private notifyState: () => void

  constructor(broadcast: (msg: ServerMsg) => void, notifyState: () => void) {
    this.broadcast = broadcast
    this.notifyState = notifyState
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      project: s.project,
      process: s.process,
      cmd: s.cmd,
      status: s.status,
      pid: s.pid,
      exitCode: s.exitCode,
    }))
  }

  snapshots(): Array<{ id: SessionId; data: string }> {
    return [...this.sessions.values()]
      .filter((s) => s.buffer.length > 0)
      .map((s) => ({ id: s.id, data: s.buffer }))
  }

  /** Start all (or one) of a project's processes. Running sessions are left alone. */
  start(project: Project, only?: string): void {
    ensureSpawnHelperExecutable()
    const root = expandHome(project.path)
    if (!existsSync(root)) throw new Error(`project path does not exist: ${root}`)
    const targets = only
      ? project.processes.filter((p) => p.name === only)
      : project.processes
    if (targets.length === 0) throw new Error(`no process named ${JSON.stringify(only)}`)

    for (const proc of targets) {
      const id = sessionId(project.name, proc.name)
      const existing = this.sessions.get(id)
      if (existing?.status === "running") continue

      const cwd = proc.cwd ? join(root, proc.cwd) : root
      if (!existsSync(cwd)) throw new Error(`cwd for ${proc.name} does not exist: ${cwd}`)

      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !ENV_BLOCKLIST.has(key)) env[key] = value
      }
      Object.assign(env, project.env)

      const shell = process.env.SHELL ?? "/bin/zsh"
      // A login shell (-l) gives GUI-launched servers a real PATH; -c runs the
      // command and exits, so the session lifetime is the command's lifetime.
      const pty = ptySpawn(shell, ["-lc", proc.cmd], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env,
      })

      const session: Session = {
        id,
        project: project.name,
        process: proc.name,
        cmd: proc.cmd,
        pty,
        pid: pty.pid,
        status: "running",
        exitCode: null,
        // Reuse the old buffer so a restart keeps prior scrollback context.
        buffer: existing ? existing.buffer + `\r\n\x1b[2m— restarted —\x1b[0m\r\n` : "",
        killTimer: null,
      }
      this.sessions.set(id, session)

      pty.onData((data) => {
        session.buffer = (session.buffer + data).slice(-MAX_BUFFER_CHARS)
        this.broadcast({ type: "output", id, data })
      })
      pty.onExit(({ exitCode }) => {
        if (session.killTimer) clearTimeout(session.killTimer)
        session.killTimer = null
        session.status = "exited"
        session.exitCode = exitCode
        session.pty = null
        this.broadcast({ type: "exit", id, exitCode })
        this.notifyState()
      })
    }
    this.notifyState()
  }

  /** Stop all (or one) of a project's sessions. State updates arrive via onExit. */
  stop(projectName: string, only?: string): void {
    for (const session of this.sessions.values()) {
      if (session.project !== projectName) continue
      if (only && session.process !== only) continue
      this.stopSession(session)
    }
  }

  write(id: SessionId, data: string): void {
    this.sessions.get(id)?.pty?.write(data)
  }

  resize(id: SessionId, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return
    if (cols < 2 || cols > 1000 || rows < 2 || rows > 500) return
    try {
      this.sessions.get(id)?.pty?.resize(cols, rows)
    } catch {}
  }

  dismiss(id: SessionId): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.status === "running") throw new Error(`cannot dismiss a running session: ${id}`)
    this.sessions.delete(id)
    this.notifyState()
  }

  /** Graceful shutdown: signal everything, resolve when all sessions exited (or timeout). */
  async stopAll(timeoutMs = 3000): Promise<void> {
    const running = [...this.sessions.values()].filter((s) => s.status === "running")
    if (running.length === 0) return
    const done = Promise.all(
      running.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.pty?.onExit(() => resolve())
            if (s.status === "exited") resolve()
          }),
      ),
    )
    for (const session of running) this.stopSession(session)
    await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs))])
  }

  private stopSession(session: Session): void {
    if (session.status !== "running" || session.pid === undefined) return
    if (session.killTimer) return // escalation already in flight
    this.signal(session, "SIGTERM")
    session.killTimer = setTimeout(() => {
      if (session.status === "running") this.signal(session, "SIGKILL")
    }, KILL_GRACE_MS)
  }

  private signal(session: Session, signal: NodeJS.Signals): void {
    if (session.pid === undefined) return
    // Negative pid signals the whole process group so dev-server children die too.
    try {
      process.kill(-session.pid, signal)
    } catch {
      try {
        session.pty?.kill(signal)
      } catch {}
    }
  }
}
