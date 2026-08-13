/** Shared types for the hangar registry and the client<->server WebSocket protocol. */

export type ProjectProcess = {
  /** Short label shown in prefixes and used to target a single process, e.g. "web" */
  name: string
  /** Shell command run in the process's cwd, e.g. "pnpm dev". Empty for interactive shells. */
  cmd: string
  /** What the process does and where it lives, shown in tooltips and the inspector. */
  description?: string
  /** Start an interactive login shell instead of running `cmd`. */
  shell?: boolean
  /** Working directory relative to the project path; defaults to the project root */
  cwd?: string
  /** Browser override for ports opened from this process. */
  browser?: BrowserChoice
}

export type Project = {
  name: string
  /** Absolute path; "~" is expanded on use */
  path: string
  /**
   * Normalized git origin identity ("host/owner/repo"), computed by the server
   * at broadcast time so clients can match the same repo across machines.
   * Never persisted in the registry.
   */
  gitRemote?: string
  processes: ProjectProcess[]
  /** Extra environment variables applied to every process of this project */
  env?: Record<string, string>
  /** Browser override for ports opened from this project. */
  browser?: BrowserChoice
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
  connections: {
    /** Accept paired connections from other machines (LAN/Tailscale). Off = loopback only. */
    acceptRemote: boolean
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
  connections: {
    acceptRemote: false,
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

/** A client from another machine that holds a session token for this server. */
export type AuthSessionInfo = {
  id: string
  /** Human label chosen at pairing time, e.g. the connecting machine's hostname. */
  label: string
  createdAt: number
  lastSeenAt: number
}

/** One-time pairing code, minted on demand and shown as code, URL, and QR. */
export type PairingInfo = {
  token: string
  expiresAt: number
  port: number
  /** Candidate addresses another machine can reach this server on. */
  hosts: { lan: string[]; tailscale: string[] }
}

/** Body of POST /api/auth/pair — exchanges a pairing code for a session token. */
export type PairRequest = { token: string; label: string }
export type PairResponse = { sessionToken: string; sessionId: string; serverName: string }

/** Response of POST /api/auth/ws-ticket; the ticket goes in `/ws?ticket=`. */
export type WsTicketResponse = { ticket: string; expiresAt: number }

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
  /** Mint a one-time pairing code so a client on another machine can connect. */
  | { type: "createPairingToken" }
  /** Revoke a paired client's session token. */
  | { type: "revokeAuthSession"; id: string }

/** Messages the server broadcasts to every connected UI. */
export type ServerMsg =
  /** Full picture: registry projects + all sessions. Sent on connect and after any change. */
  | {
      type: "state"
      projects: Project[]
      sessions: SessionInfo[]
      history: SessionHistoryEntry[]
      settings: AppSettings
      /** This machine's hostname, shown when the server is a paired machine. Absent on older servers. */
      serverName?: string
      /** Paired clients, for the connections settings UI. Absent on older servers. */
      authSessions?: AuthSessionInfo[]
    }
  /** Lightweight resource updates, kept out of full state broadcasts. */
  | { type: "metrics"; id: SessionId; runId: string; metrics: SessionMetrics }
  /** Full scrollback of one session. Sent to a client right after connect, before live output. */
  | { type: "snapshot"; id: SessionId; data: string }
  | { type: "output"; id: SessionId; data: string }
  | { type: "exit"; id: SessionId; exitCode: number | null }
  | { type: "historyReplay"; runId: string; events: HistoryOutputEvent[]; truncated: boolean }
  /** Reply to createPairingToken, sent only to the requesting client. */
  | { type: "pairingToken"; pairing: PairingInfo }
  | { type: "error"; message: string }

export function sessionId(project: string, process: string): SessionId {
  return `${project}/${process}`
}

/** Desktop auto-update state, pushed from the Electron main process to the renderer. */
export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"

export type DesktopUpdateState = {
  status: DesktopUpdateStatus
  currentVersion: string
  /** Newer version found on the feed; survives a failed download so the UI can offer a retry. */
  availableVersion: string | null
  /** Version staged on disk, ready for "restart & install". */
  downloadedVersion: string | null
  /** 0–100 while downloading, null otherwise. */
  downloadPercent: number | null
  /** Why updates are disabled, or the last error. Null when everything is fine. */
  message: string | null
}
