import { execFile } from "node:child_process"
import { chmodSync, createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { spawn as ptySpawn, type IPty } from "node-pty"
import {
  sessionId,
  type AppSettings,
  type ExitDiagnosis,
  type Project,
  type ServerMsg,
  type SessionId,
  type SessionInfo,
  type SessionMetrics,
  type SessionMetricSample,
} from "@hangar/contracts"
import {
  conflictPorts,
  DIAGNOSIS_TAIL_CHARS,
  mentionsPortConflict,
  parsePortHolder,
  portConflict,
  type PortHolder,
} from "./diagnose.ts"
import { appendHistory, ensureReplayDirectory, historyReplayPath } from "./history.ts"
import { expandHome } from "./registry.ts"

/** Keep at most this much scrollback per session for late-joining clients. */
const MAX_BUFFER_CHARS = 512 * 1024
const KILL_GRACE_MS = 1500
const METRICS_INTERVAL_MS = 2_000
/** Historical charts need much less resolution than the live inspector. */
const HISTORY_METRIC_INTERVAL_MS = METRICS_INTERVAL_MS
/** Compact older samples instead of letting a long-running process grow without bound. */
// Six hours at the two-second sampling interval; older runs remain bounded on disk.
const MAX_HISTORY_METRIC_SAMPLES = 10_800
const MAX_HISTORY_REPLAY_BYTES = 10 * 1024 * 1024
const RESTART_DIVIDER = "\r\n\x1b[2m— restarted —\x1b[0m\r\n"
/** A diagnosis costs one or two short probes; never let them outlive the answer. */
const DIAGNOSIS_TIMEOUT_MS = 2_000
function exitNotice(exitCode: number | null): string {
  const result = exitCode === null ? "after a signal" : `with code ${exitCode}`
  return `\r\n\x1b[90m[hangar] process exited ${result}\x1b[0m\r\n`
}
function diagnosisNotice(message: string): string {
  return `\x1b[90m[hangar] ${message}\x1b[0m\r\n`
}
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

type SessionLog = Pick<Session, "logPath" | "logStream" | "logBytes" | "logMaxBytes" | "logFormat">

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
  exitDiagnosis: ExitDiagnosis | undefined
  logPath: string | undefined
  logStream: WriteStream | null
  logBytes: number
  logMaxBytes: number
  logFormat: "plain" | "ansi"
}

type ProcessSample = { pid: number; ppid: number; cpu: number; rssKb: number }

const missingTools = new Set<string>()

function run(command: string, args: string[], timeoutMs = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: timeoutMs },
      (error, stdout) => {
        if (error) {
          // Port detection and metrics degrade silently when their tool is
          // absent (a bare Linux host, typically); say so once instead.
          if ((error as NodeJS.ErrnoException).code === "ENOENT" && !missingTools.has(command)) {
            missingTools.add(command)
            const feature = command === "lsof" ? "port detection" : "process metrics"
            process.stderr.write(`${command} not found; install it to enable ${feature}\n`)
          }
          reject(error)
        } else resolve(stdout)
      },
    )
  })
}

/** Daemons and containers often start without SHELL, and zsh is a macOS default only. */
function defaultShell(): string {
  if (process.platform === "darwin") return "/bin/zsh"
  return ["/bin/bash", "/bin/sh"].find((candidate) => existsSync(candidate)) ?? "/bin/sh"
}

/**
 * A login shell reads .zprofile but never .zshrc — and nvm, fnm, volta and asdf
 * all install themselves into .zshrc. So `npm run dev` works in the user's
 * terminal and dies here with "command not found", which is indistinguishable
 * from a broken project. Commands therefore run interactively as well, the way
 * a terminal would run them.
 *
 * Only for shells that document -i, though: $SHELL can be anything, and a shell
 * that rejects the flag would fail to start at all rather than merely missing a
 * PATH entry. The cost of -i on the shells we do opt in is that whatever their
 * .zshrc prints lands in the session output.
 */
export function commandShellFlags(shell: string): string {
  const name = basename(shell)
  return name === "zsh" || name === "bash" ? "-ilc" : "-lc"
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

async function listeningPorts(pids: number[]): Promise<{ ports: number[]; bindings: Record<number, string[]> }> {
  if (pids.length === 0) return { ports: [], bindings: {} }
  try {
    const output = await run("lsof", ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", pids.join(","), "-Fn"])
    const byPort = new Map<number, Set<string>>()
    for (const line of output.split("\n")) {
      const match = line.match(/^n(.+):(\d+)(?: \(LISTEN\))?$/)
      if (!match) continue
      const port = Number(match[2])
      const hosts = byPort.get(port) ?? new Set<string>()
      hosts.add(match[1]!)
      byPort.set(port, hosts)
    }
    const ports = [...byPort.keys()].sort((a, b) => a - b)
    return { ports, bindings: Object.fromEntries(ports.map((port) => [port, [...byPort.get(port)!]])) }
  } catch {
    return { ports: [], bindings: {} }
  }
}

/**
 * Who is listening on one port right now, whether or not hangar started it.
 * `null` means nobody does; `undefined` means we could not look (no lsof on the
 * host, or it hung) — the two must not be confused into a claim about the port.
 */
async function portHolder(port: number): Promise<PortHolder | null | undefined> {
  try {
    return parsePortHolder(await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], DIAGNOSIS_TIMEOUT_MS))
  } catch (error) {
    // A match-less lsof exits 1 with no output, which is an answer, not a
    // failure. execFile reports that status as a number, unlike ENOENT.
    const { code, killed } = error as { code?: string | number; killed?: boolean }
    return code === 1 && killed !== true ? null : undefined
  }
}

export class SessionManager {
  private sessions = new Map<SessionId, Session>()
  /** Ports each session was last seen listening on, kept across its restarts. */
  private lastPorts = new Map<SessionId, number[]>()
  /** Sessions that should respawn (with this project config) when their exit lands. */
  private pendingRestarts = new Map<SessionId, Project>()
  private sampling = false
  private sampleNumber = 0

  /** Push a message to every connected client. */
  private broadcast: (msg: ServerMsg) => void
  /** Ask the server to re-broadcast the full state (registry + sessions). */
  private notifyState: () => void
  private getSettings: () => AppSettings

  constructor(broadcast: (msg: ServerMsg) => void, notifyState: () => void, getSettings: () => AppSettings) {
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
      ...(s.exitDiagnosis ? { exitDiagnosis: s.exitDiagnosis } : {}),
    }))
  }

  snapshots(): Array<{ id: SessionId; data: string }> {
    return [...this.sessions.values()].filter((s) => s.buffer.length > 0).map((s) => ({ id: s.id, data: s.buffer }))
  }

  /** Current in-memory scrollback for one session. Used by bounded CLI log reads. */
  snapshot(id: SessionId): string | undefined {
    return this.sessions.get(id)?.buffer
  }

  /** Start all (or one) of a project's processes. Running sessions are left alone. */
  start(project: Project, only?: string): void {
    ensureSpawnHelperExecutable()
    const root = expandHome(project.path)
    if (!existsSync(root)) throw new Error(`project path does not exist: ${root}`)
    const targets = only ? project.processes.filter((p) => p.name === only) : project.processes
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

      const shell = process.env.SHELL ?? defaultShell()
      // Interactive terminals stay in a login shell — a pty already makes those
      // interactive, so they read .zshrc anyway. Commands use -c and exit when
      // the command does; the flags carry -l for a GUI-launched server's PATH.
      const args = proc.shell ? ["-l"] : [commandShellFlags(shell), proc.cmd]
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
        exitDiagnosis: undefined,
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
        // This is part of the server buffer, not renderer-only chrome, so it is
        // visible immediately and still present in snapshots after reconnect.
        const notice = exitNotice(exitCode)
        session.buffer = (session.buffer + notice).slice(-MAX_BUFFER_CHARS)
        this.broadcast({ type: "output", id, data: notice })
        session.logStream?.end()
        session.logStream = null
        session.replayStream?.end()
        session.replayStream = null
        this.broadcast({ type: "exit", id, exitCode })
        // An unexpected failure gets one bounded probe before the run is
        // recorded, so the reason lands in history and in the next `status`.
        const diagnosing =
          exitCode !== 0 && !session.stopRequested
            ? this.diagnoseExit(session).catch(() => undefined)
            : Promise.resolve(undefined)
        void diagnosing.then((diagnosis) => this.finishExit(session, proc.name, diagnosis))
      })
    }
    this.notifyState()
  }

  /** The half of an exit that waits for a diagnosis: history, restart, state. */
  private finishExit(session: Session, processName: string, diagnosis: ExitDiagnosis | undefined): void {
    const id = session.id
    const exitCode = session.exitCode
    const endedAt = session.endedAt ?? Date.now()
    if (diagnosis) {
      session.exitDiagnosis = diagnosis
      const notice = diagnosisNotice(diagnosis.message)
      session.buffer = (session.buffer + notice).slice(-MAX_BUFFER_CHARS)
      this.broadcast({ type: "output", id, data: notice })
    }
    if (session.historyEnabled) {
      appendHistory(
        {
          runId: session.runId,
          id: session.id,
          project: session.project,
          process: session.process,
          cmd: session.cmd,
          startedAt: session.startedAt,
          endedAt,
          durationMs: endedAt - session.startedAt,
          exitCode,
          reason: session.stopRequested ? "stopped" : exitCode === 0 ? "completed" : "failed",
          peakCpuPercent: session.metrics.peakCpuPercent,
          peakMemoryBytes: session.metrics.peakMemoryBytes,
          totalOutputBytes: session.metrics.outputBytes,
          ...(session.historyMetrics.length > 0 ? { metricSamples: session.historyMetrics } : {}),
          ...(session.replayCaptured ? { hasReplay: true } : {}),
          ...(session.replayTruncated ? { replayTruncated: true } : {}),
          ...(session.logPath ? { logPath: session.logPath } : {}),
          ...(diagnosis ? { exitDiagnosis: diagnosis } : {}),
        },
        this.getSettings(),
      )
    }
    const restartAs = this.pendingRestarts.get(id)
    if (restartAs) {
      this.pendingRestarts.delete(id)
      try {
        this.start(restartAs, processName)
        return // start() already broadcast the new state
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.broadcast({ type: "error", message: `restart ${id}: ${message}` })
      }
    }
    this.notifyState()
  }

  /**
   * Why a process died, in the case Hangar can actually close on its own: it
   * complained about a port, and Hangar can see who is holding that port.
   * Undefined whenever the evidence runs out — a wrong reason is worse than
   * none.
   */
  private async diagnoseExit(session: Session): Promise<ExitDiagnosis | undefined> {
    const tail = session.buffer.slice(-DIAGNOSIS_TAIL_CHARS)
    const named = conflictPorts(tail)
    // Python and Django say "address already in use" without ever naming the
    // port; the ports Hangar watched this session open answer for it.
    const remembered = named.length > 0 || !mentionsPortConflict(tail) ? [] : (this.lastPorts.get(session.id) ?? [])
    let looked = false
    for (const port of [...named, ...remembered]) {
      const holder = await portHolder(port)
      if (holder === undefined) continue // could not look; say nothing about this port
      looked = true
      if (holder === null || holder.pid === session.pid) continue
      const owner = this.sessionOwning(holder.pid, await this.processSamples().catch(() => []))
      return portConflict(port, { ...holder, ...(owner ? { session: owner } : {}) })
    }
    // Named by the process itself, and free again by the time we looked: still
    // the reason it died, and it says a plain retry is likely to work.
    return looked && named.length > 0 ? portConflict(named[0]!) : undefined
  }

  /** The running session whose process tree contains `pid`, if any. */
  private sessionOwning(pid: number, samples: ProcessSample[]): SessionId | undefined {
    for (const session of this.sessions.values()) {
      if (session.status !== "running" || session.pid === undefined) continue
      if (session.pid === pid) return session.id
      if (descendants(session.pid, samples).some((sample) => sample.pid === pid)) return session.id
    }
    return undefined
  }

  private async processSamples(): Promise<ProcessSample[]> {
    const output = await run("ps", ["-axo", "pid=,ppid=,%cpu=,rss="])
    return output.split("\n").flatMap((line) => {
      const [pid, ppid, cpu, rssKb] = line.trim().split(/\s+/).map(Number)
      return Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(cpu) && Number.isFinite(rssKb)
        ? [{ pid: pid!, ppid: ppid!, cpu: cpu!, rssKb: rssKb! }]
        : []
    })
  }

  /**
   * Restart all (or one) of a project's processes: running sessions are stopped
   * and respawn when their exit lands; everything else just starts.
   */
  restart(project: Project, only?: string): void {
    const targets = only ? project.processes.filter((p) => p.name === only) : project.processes
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

  /** Refresh resource data immediately; CLI readiness waits can force a port probe. */
  async sampleMetrics(forcePorts = false): Promise<void> {
    if (this.sampling) return
    const running = [...this.sessions.values()].filter(
      (session): session is Session & { pid: number } => session.status === "running" && session.pid !== undefined,
    )
    if (running.length === 0) return
    this.sampling = true
    this.sampleNumber += 1
    try {
      const samples = await this.processSamples()
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
        const listening =
          forcePorts || this.sampleNumber % 3 === 1
            ? await listeningPorts(tree.map((item) => item.pid))
            : { ports: session.metrics.ports, bindings: session.metrics.portBindings ?? {} }
        // Remembered past this run: a process that dies on a port conflict never
        // gets to open a port, so its predecessor's ports are the only lead.
        if (listening.ports.length > 0) this.lastPorts.set(session.id, listening.ports)
        session.metrics = {
          ...session.metrics,
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memoryBytes,
          processCount: tree.length,
          outputBytesPerSecond,
          ports: listening.ports,
          portBindings: listening.bindings,
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
