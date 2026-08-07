import { execFile } from "node:child_process"
import { chmodSync, createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { spawn as ptySpawn, type IPty } from "node-pty"
import {
  sessionId,
  type AppSettings,
  type Project,
  type ServerMsg,
  type SessionId,
  type SessionInfo,
  type SessionMetrics,
  type SessionMetricSample,
} from "@hangar/contracts"
import { appendHistory, ensureReplayDirectory, historyReplayPath } from "./history.ts"
import { expandHome } from "./registry.ts"

/** Keep at most this much scrollback per session for late-joining clients. */
const MAX_BUFFER_CHARS = 512 * 1024
const KILL_GRACE_MS = 1500
const METRICS_INTERVAL_MS = 2_000
/** Historical charts need much less resolution than the live inspector. */
const HISTORY_METRIC_INTERVAL_MS = METRICS_INTERVAL_MS
/** Compact older samples instead of letting a long-running process grow without bound. */
const MAX_HISTORY_METRIC_SAMPLES = 1_200
const MAX_HISTORY_REPLAY_BYTES = 10 * 1024 * 1024
const RESTART_DIVIDER = "\r\n\x1b[2m— restarted —\x1b[0m\r\n"
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

type SessionLog = Pick<
  Session,
  "logPath" | "logStream" | "logBytes" | "logMaxBytes" | "logFormat"
>

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

function createSessionLog(project: string, processName: string, settings: AppSettings): SessionLog {
  const config = settings.terminalLogging
  const empty: SessionLog = {
    logPath: undefined,
    logStream: null,
    logBytes: 0,
    logMaxBytes: config.maxFileSizeMb * 1024 * 1024,
    logFormat: config.format,
  }
  if (!config.enabled) return empty

  try {
    const directory = resolve(expandHome(config.directory), safeSegment(project), safeSegment(processName))
    mkdirSync(directory, { recursive: true })
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").replace("Z", "")
    const logPath = join(directory, `${timestamp}.log`)
    return { ...empty, logPath, logStream: createWriteStream(logPath, { flags: "a" }) }
  } catch {
    return empty
  }
}

function writeSessionLog(session: Session, data: string): void {
  if (!session.logStream) return
  const output = session.logFormat === "plain" ? stripVTControlCharacters(data) : data
  const bytes = Buffer.byteLength(output)
  if (session.logBytes + bytes > session.logMaxBytes) {
    session.logStream.end("\n[hangar] log size limit reached\n")
    session.logStream = null
    return
  }
  session.logBytes += bytes
  session.logStream.write(output)
}

function createHistoryReplay(runId: string, enabled: boolean): WriteStream | null {
  if (!enabled) return null
  try {
    ensureReplayDirectory()
    const stream = createWriteStream(historyReplayPath(runId), { flags: "w", mode: 0o600 })
    stream.on("error", () => {})
    return stream
  } catch {
    return null
  }
}

function writeHistoryReplay(session: Session, data: string): void {
  if (!session.replayStream) return
  const line = JSON.stringify({ timestamp: Date.now(), data }) + "\n"
  const bytes = Buffer.byteLength(line)
  if (session.replayBytes + bytes > MAX_HISTORY_REPLAY_BYTES) {
    session.replayTruncated = true
    session.replayStream.end()
    session.replayStream = null
    return
  }
  session.replayBytes += bytes
  session.replayStream.write(line)
}

type Session = {
  id: SessionId
  runId: string
  project: string
  process: string
  cmd: string
  pty: IPty | null
  pid: number | undefined
  status: "running" | "exited"
  exitCode: number | null
  startedAt: number
  endedAt: number | undefined
  metrics: SessionMetrics
  outputBytesAtLastSample: number
  stopRequested: boolean
  historyEnabled: boolean
  historyMetrics: SessionMetricSample[]
  historyMetricIntervalMs: number
  lastHistoryMetricAt: number
  replayCaptured: boolean
  replayStream: WriteStream | null
  replayBytes: number
  replayTruncated: boolean
  buffer: string
  killTimer: NodeJS.Timeout | null
  logPath: string | undefined
  logStream: WriteStream | null
  logBytes: number
  logMaxBytes: number
  logFormat: "plain" | "ansi"
}

type ProcessSample = { pid: number; ppid: number; cpu: number; rssKb: number }

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function descendants(rootPid: number, samples: ProcessSample[]): ProcessSample[] {
  const wanted = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const sample of samples) {
      if (wanted.has(sample.ppid) && !wanted.has(sample.pid)) {
        wanted.add(sample.pid)
        changed = true
      }
    }
  }
  return samples.filter((sample) => wanted.has(sample.pid))
}

async function listeningPorts(pids: number[]): Promise<number[]> {
  if (pids.length === 0) return []
  try {
    const output = await run("lsof", ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", pids.join(","), "-Fn"])
    const ports = new Set<number>()
    for (const line of output.split("\n")) {
      const match = line.match(/:(\d+)(?: \(LISTEN\))?$/)
      if (match) ports.add(Number(match[1]))
    }
    return [...ports].sort((a, b) => a - b)
  } catch {
    return []
  }
}

export class SessionManager {
  private sessions = new Map<SessionId, Session>()
  /** Sessions that should respawn (with this project config) when their exit lands. */
  private pendingRestarts = new Map<SessionId, Project>()
  private sampling = false
  private sampleNumber = 0

  /** Push a message to every connected client. */
  private broadcast: (msg: ServerMsg) => void
  /** Ask the server to re-broadcast the full state (registry + sessions). */
  private notifyState: () => void
  private getSettings: () => AppSettings

  constructor(
    broadcast: (msg: ServerMsg) => void,
    notifyState: () => void,
    getSettings: () => AppSettings,
  ) {
    this.broadcast = broadcast
    this.notifyState = notifyState
    this.getSettings = getSettings
    const timer = setInterval(() => void this.sampleMetrics(), METRICS_INTERVAL_MS)
    timer.unref()
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      runId: s.runId,
      project: s.project,
      process: s.process,
      cmd: s.cmd,
      status: s.status,
      pid: s.pid,
      exitCode: s.exitCode,
      startedAt: s.startedAt,
      ...(s.endedAt === undefined ? {} : { endedAt: s.endedAt }),
      metrics: s.metrics,
      ...(s.logPath ? { logPath: s.logPath } : {}),
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
      // Interactive terminals stay in a login shell. Commands use -c and exit
      // when the command does; -l gives GUI-launched servers a real PATH.
      const args = proc.shell ? ["-l"] : ["-lc", proc.cmd]
      const displayedCommand = proc.shell ? `${shell} -l` : proc.cmd
      const pty = ptySpawn(shell, args, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env,
      })

      const settings = this.getSettings()
      const logging = createSessionLog(project.name, proc.name, settings)
      const startedAt = Date.now()
      const runId = randomUUID()
      const replayStream = createHistoryReplay(runId, settings.sessionHistory.enabled)
      const session: Session = {
        id,
        runId,
        project: project.name,
        process: proc.name,
        cmd: displayedCommand,
        pty,
        pid: pty.pid,
        status: "running",
        exitCode: null,
        startedAt,
        endedAt: undefined,
        metrics: {
          cpuPercent: 0,
          memoryBytes: 0,
          processCount: 1,
          outputBytes: 0,
          outputBytesPerSecond: 0,
          ports: [],
          sampledAt: startedAt,
          peakCpuPercent: 0,
          peakMemoryBytes: 0,
        },
        outputBytesAtLastSample: 0,
        stopRequested: false,
        historyEnabled: settings.sessionHistory.enabled,
        historyMetrics: [],
        historyMetricIntervalMs: HISTORY_METRIC_INTERVAL_MS,
        lastHistoryMetricAt: 0,
        replayCaptured: replayStream !== null,
        replayStream,
        replayBytes: 0,
        replayTruncated: false,
        // Reuse the old buffer so a restart keeps prior scrollback context.
        buffer: existing ? existing.buffer + RESTART_DIVIDER : "",
        killTimer: null,
        ...logging,
      }
      this.sessions.set(id, session)
      // Live clients only get buffers as connect-time snapshots, so the divider
      // has to travel as output too or they'd never see the seam.
      if (existing) this.broadcast({ type: "output", id, data: RESTART_DIVIDER })

      pty.onData((data) => {
        session.buffer = (session.buffer + data).slice(-MAX_BUFFER_CHARS)
        session.metrics.outputBytes += Buffer.byteLength(data)
        writeSessionLog(session, data)
        writeHistoryReplay(session, data)
        this.broadcast({ type: "output", id, data })
      })
      pty.onExit(({ exitCode }) => {
        if (session.killTimer) clearTimeout(session.killTimer)
        session.killTimer = null
        session.status = "exited"
        session.exitCode = exitCode
        session.endedAt = Date.now()
        session.pty = null
        session.logStream?.end()
        session.logStream = null
        session.replayStream?.end()
        session.replayStream = null
        if (session.historyEnabled) {
          appendHistory({
            runId: session.runId,
            id: session.id,
            project: session.project,
            process: session.process,
            cmd: session.cmd,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationMs: session.endedAt - session.startedAt,
            exitCode,
            reason: session.stopRequested ? "stopped" : exitCode === 0 ? "completed" : "failed",
            peakCpuPercent: session.metrics.peakCpuPercent,
            peakMemoryBytes: session.metrics.peakMemoryBytes,
            totalOutputBytes: session.metrics.outputBytes,
            ...(session.historyMetrics.length > 0 ? { metricSamples: session.historyMetrics } : {}),
            ...(session.replayCaptured ? { hasReplay: true } : {}),
            ...(session.replayTruncated ? { replayTruncated: true } : {}),
            ...(session.logPath ? { logPath: session.logPath } : {}),
          }, this.getSettings())
        }
        this.broadcast({ type: "exit", id, exitCode })
        const restartAs = this.pendingRestarts.get(id)
        if (restartAs) {
          this.pendingRestarts.delete(id)
          try {
            this.start(restartAs, proc.name)
            return // start() already broadcast the new state
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.broadcast({ type: "error", message: `restart ${id}: ${message}` })
          }
        }
        this.notifyState()
      })
    }
    this.notifyState()
  }

  /**
   * Restart all (or one) of a project's processes: running sessions are stopped
   * and respawn when their exit lands; everything else just starts.
   */
  restart(project: Project, only?: string): void {
    const targets = only
      ? project.processes.filter((p) => p.name === only)
      : project.processes
    if (targets.length === 0) throw new Error(`no process named ${JSON.stringify(only)}`)
    for (const proc of targets) {
      const id = sessionId(project.name, proc.name)
      const session = this.sessions.get(id)
      if (session?.status === "running") {
        this.pendingRestarts.set(id, project)
        this.stopSession(session)
      } else {
        this.start(project, proc.name)
      }
    }
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
    this.pendingRestarts.clear()
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

  private async sampleMetrics(): Promise<void> {
    if (this.sampling) return
    const running = [...this.sessions.values()].filter(
      (session): session is Session & { pid: number } => session.status === "running" && session.pid !== undefined,
    )
    if (running.length === 0) return
    this.sampling = true
    this.sampleNumber += 1
    try {
      const output = await run("ps", ["-axo", "pid=,ppid=,%cpu=,rss="])
      const samples: ProcessSample[] = output.split("\n").flatMap((line) => {
        const [pid, ppid, cpu, rssKb] = line.trim().split(/\s+/).map(Number)
        return Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(cpu) && Number.isFinite(rssKb)
          ? [{ pid: pid!, ppid: ppid!, cpu: cpu!, rssKb: rssKb! }]
          : []
      })
      for (const session of running) {
        if (session.status !== "running") continue
        const tree = descendants(session.pid, samples)
        const cpuPercent = tree.reduce((sum, item) => sum + item.cpu, 0)
        const memoryBytes = tree.reduce((sum, item) => sum + item.rssKb * 1024, 0)
        const elapsed = Math.max(0.001, (Date.now() - session.metrics.sampledAt) / 1000)
        const outputBytesPerSecond = Math.round(
          (session.metrics.outputBytes - session.outputBytesAtLastSample) / elapsed,
        )
        session.outputBytesAtLastSample = session.metrics.outputBytes
        const ports = this.sampleNumber % 3 === 1
          ? await listeningPorts(tree.map((item) => item.pid))
          : session.metrics.ports
        session.metrics = {
          ...session.metrics,
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memoryBytes,
          processCount: tree.length,
          outputBytesPerSecond,
          ports,
          sampledAt: Date.now(),
          peakCpuPercent: Math.max(session.metrics.peakCpuPercent, cpuPercent),
          peakMemoryBytes: Math.max(session.metrics.peakMemoryBytes, memoryBytes),
        }
        if (
          session.historyEnabled &&
          session.metrics.sampledAt - session.lastHistoryMetricAt >= session.historyMetricIntervalMs
        ) {
          session.lastHistoryMetricAt = session.metrics.sampledAt
          session.historyMetrics.push({
            sampledAt: session.metrics.sampledAt,
            cpuPercent: session.metrics.cpuPercent,
            memoryBytes: session.metrics.memoryBytes,
            processCount: session.metrics.processCount,
            outputBytes: session.metrics.outputBytes,
            outputBytesPerSecond: session.metrics.outputBytesPerSecond,
          })
          if (session.historyMetrics.length >= MAX_HISTORY_METRIC_SAMPLES) {
            session.historyMetrics = session.historyMetrics.filter((_, index) => index % 2 === 0)
            session.historyMetricIntervalMs *= 2
          }
        }
        this.broadcast({ type: "metrics", id: session.id, runId: session.runId, metrics: session.metrics })
      }
    } catch {
      // Resource stats are best-effort and must never affect the managed process.
    } finally {
      this.sampling = false
    }
  }

  private stopSession(session: Session): void {
    if (session.status !== "running" || session.pid === undefined) return
    if (session.killTimer) return // escalation already in flight
    session.stopRequested = true
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
