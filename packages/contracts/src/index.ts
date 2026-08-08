/** Shared types for the hangar registry and the client<->server WebSocket protocol. */

export type ProjectProcess = {
  /** Short label shown in prefixes and used to target a single process, e.g. "web" */
  name: string
  /** Shell command run in the process's cwd, e.g. "pnpm dev". Empty for interactive shells. */
  cmd: string
  /** Start an interactive login shell instead of running `cmd`. */
  shell?: boolean
  /** Working directory relative to the project path; defaults to the project root */
  cwd?: string
}

export type Project = {
  name: string
  /** Absolute path; "~" is expanded on use */
  path: string
  processes: ProjectProcess[]
  /** Extra environment variables applied to every process of this project */
  env?: Record<string, string>
}

export type Registry = {
  version: 1
  projects: Project[]
}

export type BrowserChoice = "system" | "safari" | "chrome" | "arc" | "firefox" | "brave" | "edge"
export type ShareHostChoice = "auto" | "lan" | "tailscale" | "custom"

export type ThemeSetting = "system" | "light" | "dark"

export type AppSettings = {
  appearance: {
    /** "system" follows the OS light/dark preference live. */
    theme: ThemeSetting
    /** Reveal keycaps on shortcut-bearing controls while ⌘/Ctrl is held. */
    shortcutHints: boolean
  }
  links: {
    /** Browser used for detected localhost ports. */
    browser: BrowserChoice
    /** Address used when copying a detected-port link. */
    shareHost: ShareHostChoice
    customHost: string
  }
  terminal: {
    copyOnSelect: boolean
    fontFamily: string
    fontSize: number
  }
  terminalLogging: {
    enabled: boolean
    directory: string
    retentionDays: 7 | 30 | null
    maxFileSizeMb: number
    format: "plain" | "ansi"
  }
  sessionHistory: {
    /** Persist run metadata and resource summaries. Terminal output is controlled separately. */
    enabled: boolean
    retentionDays: 7 | 30 | 90 | null
  }
  onboarding: {
    /** The first-run tutorial was dismissed or finished; it can be replayed from Settings. */
    tutorialSeen: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: "system",
    shortcutHints: true,
  },
  links: {
    browser: "system",
    shareHost: "auto",
    customHost: "",
  },
  terminal: {
    copyOnSelect: true,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
  },
  terminalLogging: {
    enabled: false,
    directory: "~/.hangar/logs",
    retentionDays: 30,
    maxFileSizeMb: 50,
    format: "plain",
  },
  sessionHistory: {
    enabled: false,
    retentionDays: 30,
  },
  onboarding: {
    tutorialSeen: false,
  },
}

/** The hangar server listens on this port unless HANGAR_PORT overrides it. */
export const DEFAULT_PORT = 4780

/** Session id is `${projectName}/${processName}`. */
export type SessionId = string

export type SessionStatus = "running" | "exited"

export type SessionMetrics = {
  cpuPercent: number
  memoryBytes: number
  processCount: number
  outputBytes: number
  outputBytesPerSecond: number
  ports: number[]
  /** Listening addresses reported by lsof, keyed by port. */
  portBindings?: Record<number, string[]>
  sampledAt: number
  peakCpuPercent: number
  peakMemoryBytes: number
}

export type SessionInfo = {
  id: SessionId
  /** Unique for every launch; unlike id, changes after a restart. */
  runId: string
  project: string
  process: string
  status: SessionStatus
  pid?: number
  exitCode?: number | null
  startedAt: number
  endedAt?: number
  /** The command the session is running */
  cmd: string
  metrics?: SessionMetrics
  /** Current on-disk output log, when logging was enabled at session start. */
  logPath?: string
}

export type SessionMetricSample = {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  outputBytes: number
  outputBytesPerSecond: number
}

export type HistoryOutputEvent = {
  /** Absolute timestamp, shared with resource samples for synchronized replay. */
  timestamp: number
  /** Raw terminal output, including ANSI control sequences. */
  data: string
}

export type SessionHistoryEntry = {
  runId: string
  id: SessionId
  project: string
  process: string
  cmd: string
  startedAt: number
  endedAt: number
  durationMs: number
  exitCode: number | null
  reason: "completed" | "failed" | "stopped"
  peakCpuPercent: number
  peakMemoryBytes: number
  totalOutputBytes: number
  /** Downsampled resource timeline retained for historical inspection. */
  metricSamples?: SessionMetricSample[]
  /** A timestamped ANSI replay was captured in Hangar's private history store. */
  hasReplay?: boolean
  replayTruncated?: boolean
  logPath?: string
}

/** Messages the UI sends to the server. */
export type ClientMsg =
  | { type: "start"; project: string; process?: string }
  | { type: "stop"; project: string; process?: string }
  | { type: "write"; id: SessionId; data: string }
  | { type: "resize"; id: SessionId; cols: number; rows: number }
  /** Stop then start again all (or one) of a project's processes. Not-running targets just start. */
  | { type: "restart"; project: string; process?: string }
  /** Remove an exited session (clears its buffer and drops it from state). */
  | { type: "dismiss"; id: SessionId }
  /** Create a project, or replace the one with the same name. */
  | { type: "upsertProject"; project: Project }
  /** Remove a project from the registry. Refused while it has running sessions. */
  | { type: "removeProject"; project: string }
  /** Persist the project order used by the sidebar. */
  | { type: "reorderProjects"; projects: string[] }
  | { type: "updateSettings"; settings: AppSettings }
  /** Load timestamped output for one retained historical run. */
  | { type: "getHistoryReplay"; runId: string }

/** Messages the server broadcasts to every connected UI. */
export type ServerMsg =
  /** Full picture: registry projects + all sessions. Sent on connect and after any change. */
  | { type: "state"; projects: Project[]; sessions: SessionInfo[]; history: SessionHistoryEntry[]; settings: AppSettings }
  /** Lightweight resource updates, kept out of full state broadcasts. */
  | { type: "metrics"; id: SessionId; runId: string; metrics: SessionMetrics }
  /** Full scrollback of one session. Sent to a client right after connect, before live output. */
  | { type: "snapshot"; id: SessionId; data: string }
  | { type: "output"; id: SessionId; data: string }
  | { type: "exit"; id: SessionId; exitCode: number | null }
  | { type: "historyReplay"; runId: string; events: HistoryOutputEvent[]; truncated: boolean }
  | { type: "error"; message: string }

export function sessionId(project: string, process: string): SessionId {
  return `${project}/${process}`
}
