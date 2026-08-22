import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { type Dirent, existsSync, globSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { hostname, networkInterfaces } from "node:os"
import { WebSocketServer, WebSocket } from "ws"
import type {
  AppSettings,
  BrowseEntry,
  BrowseResult,
  ClientMsg,
  PairResponse,
  PairingInfo,
  PortShare,
  Project,
  ServerMsg,
  TailscaleState,
  WsTicketResponse,
} from "@hangar/contracts"
import {
  consumeTicket,
  createPairingToken,
  issueTicket,
  listSessions,
  redeemPairingToken,
  revokeSession,
  verifyBearer,
} from "./auth.ts"
import { expandHome, findProject, hangarHome, loadRegistry, saveRegistry, validateProject } from "./registry.ts"
import { exportAppIntentsState, watchAppIntentsCommands } from "./appintents.ts"
import { gitRemoteFor } from "./git.ts"
import { loadHistory, loadHistoryReplay } from "./history.ts"
import { clearRuntimeState, writeRuntimeState } from "./runtime-state.ts"
import { SessionManager } from "./sessions.ts"
import { loadSettings, saveSettings } from "./settings.ts"
import { listShares, startShare, stopShare, stopOwnShares, tailscaleState } from "./tailscale.ts"
import { resolveWebRoot, serveWebUi } from "./webui.ts"

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
/** Auth (bearer or loopback) is the security boundary here, not the origin check. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, DELETE",
}
const MAX_BODY_BYTES = 64 * 1024
/** One keystroke should not stat a home directory's worth of candidates. */
const BROWSE_LIMIT = 500
/** How long a quit may spend withdrawing published ports before it gives up. */
const SHARE_TEARDOWN_MS = 3_000
/** How often Tailscale is re-read while a UI is watching. Two subprocesses a minute. */
const SHARE_POLL_MS = 30_000

function isLoopback(req: IncomingMessage): boolean {
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? "")
}

/** Loopback clients stay trusted; anyone else needs a paired session token. */
function authorize(req: IncomingMessage): string | null {
  if (isLoopback(req)) return "local"
  return verifyBearer(req.headers.authorization)
}

/** An explicit --host pins the bind; otherwise env, then the acceptRemote setting. */
function bindHost(settings: AppSettings, hostOverride?: string): string {
  return hostOverride ?? process.env.HANGAR_HOST ?? (settings.connections?.acceptRemote ? "0.0.0.0" : "127.0.0.1")
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error("body too large")
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS_HEADERS })
  res.end(JSON.stringify(body))
}

function networkInfo(): { lan: string[]; tailscale: string[] } {
  const lan: string[] = []
  const tailscale: string[] = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== "IPv4") continue
      const [first, second] = address.address.split(".").map(Number)
      if (first === 100 && second !== undefined && second >= 64 && second <= 127) tailscale.push(address.address)
      else if (
        first === 10 ||
        (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      )
        lan.push(address.address)
    }
  }
  return { lan: [...new Set(lan)], tailscale: [...new Set(tailscale)] }
}

type PackageJson = {
  name?: unknown
  packageManager?: unknown
  scripts?: unknown
  workspaces?: unknown
}

type DetectedScript = {
  name: string
  value: string
  cmd: string
  cwd?: string
  workspace?: string
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function packageScripts(parsed: PackageJson, manager: string, prefix?: string, cwd?: string): DetectedScript[] {
  if (!parsed.scripts || typeof parsed.scripts !== "object") return []
  return Object.entries(parsed.scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => ({
      name: prefix ? `${prefix}/${name}` : name,
      value,
      cmd: `${manager} run ${shellArg(name)}`,
      ...(cwd ? { cwd } : {}),
      ...(prefix ? { workspace: prefix } : {}),
    }))
}

/** Handles package.json workspaces plus the common, intentionally small pnpm-workspace.yaml form. */
function workspacePatterns(path: string, parsed: PackageJson): string[] {
  const declared = Array.isArray(parsed.workspaces)
    ? parsed.workspaces
    : parsed.workspaces &&
        typeof parsed.workspaces === "object" &&
        Array.isArray((parsed.workspaces as { packages?: unknown }).packages)
      ? (parsed.workspaces as { packages: unknown[] }).packages
      : []
  const fromPackage = declared.filter((entry): entry is string => typeof entry === "string")
  if (fromPackage.length > 0) return fromPackage

  const workspaceFile = join(path, "pnpm-workspace.yaml")
  if (!existsSync(workspaceFile)) return []
  const patterns: string[] = []
  let inPackages = false
  for (const line of readFileSync(workspaceFile, "utf8").split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages && /^\S/.test(line)) break
    if (!inPackages) continue
    const match = line.match(/^\s+-\s+["']?([^"'#]+?)["']?\s*(?:#.*)?$/)
    if (match?.[1]) patterns.push(match[1].trim())
  }
  return patterns
}

function workspaceScripts(path: string, parsed: PackageJson, manager: string): DetectedScript[] {
  const patterns = workspacePatterns(path, parsed)
    .map((pattern) => pattern.replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((pattern) => pattern !== "" && !pattern.startsWith("/") && !pattern.startsWith("../"))
  const included = patterns.filter((pattern) => !pattern.startsWith("!"))
  if (included.length === 0) return []
  const excluded = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => `${pattern.slice(1)}/package.json`)

  const packageFiles = globSync(
    included.map((pattern) => `${pattern}/package.json`),
    {
      cwd: path,
      exclude: ["**/node_modules/**", ...excluded],
    },
  ).sort()

  return packageFiles.flatMap((packageFile) => {
    const workspace = JSON.parse(readFileSync(join(path, packageFile), "utf8")) as PackageJson
    const cwd = dirname(packageFile).replaceAll("\\", "/")
    const packageName = typeof workspace.name === "string" ? workspace.name.split("/").pop() : null
    const label = packageName || basename(cwd)
    return packageScripts(workspace, manager, label, cwd)
  })
}

function inspectProject(inputPath: string): object {
  const path = resolve(expandHome(inputPath))
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { path, exists: false, package: null }
  }

  const packagePath = join(path, "package.json")
  if (!existsSync(packagePath)) return { path, exists: true, package: null }

  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson
  const declaredManager = typeof parsed.packageManager === "string" ? parsed.packageManager.split("@")[0] : null
  const manager =
    declaredManager === "pnpm" || declaredManager === "yarn" || declaredManager === "bun" || declaredManager === "npm"
      ? declaredManager
      : existsSync(join(path, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(path, "yarn.lock"))
          ? "yarn"
          : existsSync(join(path, "bun.lock")) || existsSync(join(path, "bun.lockb"))
            ? "bun"
            : "npm"
  const rootScripts = packageScripts(parsed, manager)
  const childScripts = workspaceScripts(path, parsed, manager)

  return {
    path,
    exists: true,
    package: {
      name: typeof parsed.name === "string" ? parsed.name : null,
      manager,
      scripts: [...rootScripts, ...childScripts],
      workspaceScriptCount: childScripts.length,
    },
  }
}

/**
 * Completes a path the way someone types one, not the way a shell resolves one:
 * unless the input ends in a separator, its last segment is a filter over the
 * directory above it rather than a directory of its own.
 */
export function browseDirectories(inputPath: string): BrowseResult {
  const raw = inputPath.trim()
  // A bare "~" names a directory as surely as a trailing slash does.
  const whole = raw === "" || raw === "~" || /[\\/]$/.test(raw)
  const resolved = resolve(expandHome(raw === "" ? "~" : raw))
  const parent = whole ? resolved : dirname(resolved)
  const prefix = whole ? "" : basename(resolved)
  const lowered = prefix.toLowerCase()

  let dirents: Dirent[]
  try {
    dirents = readdirSync(parent, { withFileTypes: true })
  } catch {
    // A directory we cannot read is a dead end, not a failure: typing past a
    // permission wall should simply offer nothing to pick.
    return { parent, prefix, entries: [], truncated: false }
  }

  const matches = dirents
    .filter((dirent) => {
      if (!dirent.name.toLowerCase().startsWith(lowered)) return false
      // Dotfiles stay out of every listing until the dot is typed on purpose.
      if (dirent.name.startsWith(".") && !prefix.startsWith(".")) return false
      if (dirent.isDirectory()) return true
      // ~/code is full of symlinked checkouts, and isDirectory() is false for
      // each of them; a broken link resolves to nothing and drops out here.
      if (!dirent.isSymbolicLink()) return false
      try {
        return statSync(join(parent, dirent.name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // Stat only what is returned, so a huge directory costs one readdir and not
  // thousands of existsSync calls nobody will see the answers to.
  const entries = matches.slice(0, BROWSE_LIMIT).map((dirent): BrowseEntry => {
    const full = join(parent, dirent.name)
    return {
      name: dirent.name,
      path: full,
      git: existsSync(join(full, ".git")),
      pkg: existsSync(join(full, "package.json")),
    }
  })
  return { parent, prefix, entries, truncated: matches.length > BROWSE_LIMIT }
}

export function serve(port: number, hostOverride?: string): void {
  const clients = new Set<WebSocket>()
  let host = bindHost(loadSettings(), hostOverride)
  const webRoot = resolveWebRoot()
  // Behind NAT or Docker port publishing, the reachable address is one the
  // server cannot discover from its own interfaces; the operator supplies it.
  const advertiseHost = process.env.HANGAR_ADVERTISE_HOST
  const advertisePort = Number(process.env.HANGAR_ADVERTISE_PORT ?? "") || port

  /** The bind address is what we listen on; the banner needs one a phone can reach. */
  const displayHost = (): string => {
    const preferred = advertiseHost ?? (host !== "0.0.0.0" && host !== "::" ? host : undefined)
    if (preferred) return preferred.includes(":") ? `[${preferred}]` : preferred
    const hosts = networkInfo()
    return hosts.tailscale[0] ?? hosts.lan[0] ?? "127.0.0.1"
  }

  /**
   * The addresses this machine hands out. An operator who set an advertise host
   * has said which one actually answers, and that has to hold everywhere a
   * client dials us — a client opens a detected port at one of these, so
   * reporting an interface address it cannot route (a container's docker bridge,
   * say) produces a dead link just as surely as a wrong pairing string would.
   */
  const advertisedHosts = (): { lan: string[]; tailscale: string[] } =>
    advertiseHost ? { lan: [advertiseHost], tailscale: [] } : networkInfo()

  const pairingInfo = (): PairingInfo => ({
    ...createPairingToken(),
    port: advertisePort,
    hosts: advertisedHosts(),
    bindHost: host,
    ...(advertiseHost === undefined ? {} : { advertiseHost }),
  })

  /** A wildcard bind already answers loopback; a pinned remote address does not. */
  const pinnedRemoteBind = (): boolean =>
    !LOOPBACK_ADDRESSES.has(host) && host !== "localhost" && host !== "0.0.0.0" && host !== "::"

  const listen = (): void => {
    // Two quick acceptRemote flips queue two close callbacks; only the first listen may run.
    if (httpServer.listening) return
    httpServer.listen(port, host, () => {
      writeRuntimeState(host, port)
      const shown = displayHost()
      process.stdout.write(`hangar server listening on http://${host}:${port} (ws: /ws)\n`)
      // Loopback trust is the local auth model: the CLI, desktop probe, and
      // pair-code minting all assume 127.0.0.1 answers, whatever the bind.
      if (pinnedRemoteBind()) {
        loopbackServer.listen(port, "127.0.0.1", () => {
          process.stdout.write(`also listening on http://127.0.0.1:${port} for local tools\n`)
        })
      }
      // No bundled UI is normal for the standalone CLI: clients connect to this
      // address instead of being served from it.
      if (webRoot === null) process.stdout.write(`api only: no web ui bundled — connect a client to this address\n`)
      else process.stdout.write(`web ui: http://${shown}:${advertisePort}\n`)
      if (!LOOPBACK_ADDRESSES.has(host) && host !== "localhost") {
        process.stdout.write(`pair a device: hangar target pair-code\n`)
      }
    })
  }

  /** Re-binds after the acceptRemote toggle. PTY sessions survive; UIs reconnect on their own. */
  const applyBindHost = (): void => {
    const next = bindHost(loadSettings(), hostOverride)
    if (next === host) return
    host = next
    for (const client of clients) client.close(1012, "rebinding")
    clients.clear()
    // Both listeners must be down before listen() may run again.
    let pending = 1 + (loopbackServer.listening ? 1 : 0)
    const closed = (): void => {
      if (--pending === 0) listen()
    }
    if (loopbackServer.listening) {
      loopbackServer.close(closed)
      loopbackServer.closeAllConnections()
    }
    httpServer.close(closed)
    httpServer.closeAllConnections()
  }

  /*
   * Published ports are machine state, not session state, so they are cached
   * here and refreshed around every mutation: `stateMsg` is called from a dozen
   * synchronous places and cannot wait on a `tailscale` subprocess.
   */
  let shares: PortShare[] = []
  let tailscale: TailscaleState = { installed: false, running: false }

  const refreshShares = async (): Promise<void> => {
    tailscale = await tailscaleState()
    shares = tailscale.running ? await listShares() : []
  }

  /**
   * Re-reads Tailscale and broadcasts only when the answer moved. Without this
   * the state is only ever sampled at startup, so a user who launches Tailscale
   * after Hangar would be told it is stopped until they restarted the app — and
   * a share withdrawn from the Tailscale UI would linger in ours.
   */
  const syncShares = async (): Promise<void> => {
    const before = JSON.stringify([shares, tailscale])
    await refreshShares().catch(() => undefined)
    if (JSON.stringify([shares, tailscale]) !== before) broadcastState()
  }

  const broadcast = (msg: ServerMsg): void => {
    const json = JSON.stringify(msg)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json)
    }
    // A share survives a restart, because the port comes back. It must not
    // survive an ending: a funnel aimed at a dead port hands a stranger an
    // error page from a machine they were told was ours.
    if (msg.type === "exit" && !manager.restarting(msg.id) && shares.some((share) => share.session === msg.id)) {
      void releaseSessionShares(msg.id)
    }
  }

  const releaseSessionShares = async (id: string): Promise<void> => {
    for (const share of shares.filter((entry) => entry.session === id)) {
      await stopShare(share.port).catch(() => undefined)
    }
    await refreshShares()
    broadcastState()
  }

  const stateMsg = (): ServerMsg => {
    let projects: Project[]
    let settings: AppSettings
    try {
      projects = loadRegistry().projects
      settings = loadSettings()
    } catch (error) {
      broadcast({ type: "error", message: String(error) })
      projects = []
      settings = loadSettings()
    }
    return {
      type: "state",
      // Git identity is computed for the wire only; the registry objects stay untouched.
      projects: projects.map((project) => ({ ...project, gitRemote: gitRemoteFor(project.path) })),
      sessions: manager.list(),
      history: loadHistory(settings),
      settings,
      serverName: hostname(),
      authSessions: listSessions(),
      shares,
      tailscale,
    }
  }
  const broadcastState = (): void => {
    broadcast(stateMsg())
    try {
      exportAppIntentsState(loadRegistry().projects, manager.list())
    } catch {
      // The Spotlight snapshot must never break state broadcasting.
    }
  }

  const manager = new SessionManager(broadcast, broadcastState, loadSettings)

  // Adopt whatever Tailscale is already publishing rather than assuming a clean
  // slate: a share that outlived a crash is still live, and the only thing worse
  // than an exposed port is an exposed port no UI admits to.
  void refreshShares().then(broadcastState, () => undefined)
  // Tailscale is driven from outside Hangar as much as from inside it, so its
  // state is polled rather than assumed. Idle when nobody is watching.
  setInterval(() => {
    if (clients.size > 0) void syncShares()
  }, SHARE_POLL_MS).unref()

  // Spotlight/Shortcuts bridge: export the current state, then drain any
  // commands queued while no server was running and keep watching.
  try {
    exportAppIntentsState(loadRegistry().projects, manager.list())
  } catch {
    // Same policy as above: the bridge is best-effort.
  }
  watchAppIntentsCommands((command) => {
    try {
      if (command.kind === "start-process") {
        const slash = command.targetId.indexOf("/")
        if (slash === -1) return
        const project = findProject(loadRegistry(), command.targetId.slice(0, slash))
        if (project) manager.start(project, command.targetId.slice(slash + 1))
      } else if (command.kind === "start-project") {
        const project = findProject(loadRegistry(), command.targetId)
        if (project) manager.start(project)
      }
    } catch (error) {
      broadcast({ type: "error", message: `App Intents command failed: ${String(error)}` })
    }
  })

  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" })
      res.end("ok")
      return
    }
    if (req.method === "POST" && url.pathname === "/api/auth/pair") {
      let body: { token?: unknown; label?: unknown }
      try {
        body = ((await readJsonBody(req)) ?? {}) as { token?: unknown; label?: unknown }
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" })
        return
      }
      const result = redeemPairingToken(body.token, body.label)
      if (!result.ok) {
        if (result.reason === "locked") sendJson(res, 429, { error: "too many pairing attempts" })
        else sendJson(res, 401, { error: "invalid or expired pairing code" })
        return
      }
      sendJson(res, 200, {
        sessionToken: result.sessionToken,
        sessionId: result.sessionId,
        serverName: hostname(),
      } satisfies PairResponse)
      broadcastState()
      return
    }
    if (req.method === "POST" && url.pathname === "/api/auth/ws-ticket") {
      const sessionId = authorize(req)
      if (!sessionId) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      sendJson(res, 200, issueTicket(sessionId) satisfies WsTicketResponse)
      return
    }
    if (req.method === "POST" && url.pathname === "/api/auth/pairing-code") {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      sendJson(res, 200, pairingInfo())
      return
    }
    if (req.method === "POST" && url.pathname === "/api/auth/revoke-self") {
      // Prefer the bearer even on loopback: a paired CLI may be removing a
      // target that happens to point back at this Mac.
      const sessionId = verifyBearer(req.headers.authorization)
      if (!sessionId) {
        sendJson(res, 401, { error: "a paired session token is required" })
        return
      }
      revokeSession(sessionId)
      sendJson(res, 200, { revoked: true })
      broadcastState()
      return
    }
    if (req.method === "GET" && url.pathname === "/network-info") {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      sendJson(res, 200, advertisedHosts())
      return
    }
    if (req.method === "GET" && url.pathname === "/project-info") {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      try {
        const path = url.searchParams.get("path") ?? ""
        if (path.trim() === "") throw new Error("path is required")
        sendJson(res, 200, inspectProject(path))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    // A native folder picker only ever sees the machine it opened on, so it
    // cannot name a directory on a paired Mac or a headless Linux box. Every
    // client picks a project folder through this listing instead.
    if (req.method === "GET" && url.pathname === "/browse") {
      if (!authorize(req)) {
        sendJson(res, 401, { error: "unauthorized" })
        return
      }
      try {
        sendJson(res, 200, browseDirectories(url.searchParams.get("path") ?? ""))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    // The CLI uses HTTP for correlated request/reply control. WebSocket remains
    // the event and terminal-stream transport used by interactive clients.
    if (url.pathname.startsWith("/api/") && !authorize(req)) {
      sendJson(res, 401, { error: "unauthorized", code: "unauthorized" })
      return
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, stateMsg())
        return
      }
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        sendJson(res, 200, { sessions: manager.list() })
        return
      }
      if (req.method === "GET" && url.pathname === "/api/logs") {
        const id = url.searchParams.get("id") ?? ""
        const data = manager.snapshot(id)
        if (data === undefined) {
          sendJson(res, 404, { error: `no session named ${JSON.stringify(id)}`, code: "session_not_found" })
          return
        }
        sendJson(res, 200, { id, data })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/sessions/probe") {
        await manager.sampleMetrics(true)
        sendJson(res, 200, { sessions: manager.list() })
        return
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/sessions/")) {
        const action = url.pathname.slice("/api/sessions/".length)
        const body = (await readJsonBody(req)) as { project?: unknown; process?: unknown }
        if (typeof body.project !== "string" || body.project === "") throw new Error("project is required")
        const processName = typeof body.process === "string" && body.process !== "" ? body.process : undefined
        if (action !== "start" && action !== "stop" && action !== "restart") {
          sendJson(res, 404, { error: "unknown session action", code: "not_found" })
          return
        }
        const project = findProject(loadRegistry(), body.project)
        if (!project) {
          sendJson(res, 404, { error: `no project named ${JSON.stringify(body.project)}`, code: "project_not_found" })
          return
        }
        const processNames = processName
          ? project.processes.filter((proc) => proc.name === processName).map((proc) => proc.name)
          : project.processes.map((proc) => proc.name)
        if (processNames.length === 0) {
          sendJson(res, 404, { error: `no process named ${JSON.stringify(processName)}`, code: "process_not_found" })
          return
        }
        const runningBefore = new Set(
          manager
            .list()
            .filter((session) => session.project === project.name && session.status === "running")
            .map((session) => session.process),
        )
        const changed =
          action === "start"
            ? processNames.some((name) => !runningBefore.has(name))
            : action === "stop"
              ? processNames.some((name) => runningBefore.has(name))
              : true
        if (action === "start") manager.start(project, processName)
        else if (action === "stop") manager.stop(project.name, processName)
        else manager.restart(project, processName)
        const sessions = manager
          .list()
          .filter((session) => session.project === body.project && (!processName || session.process === processName))
        sendJson(res, 200, { changed, sessions })
        return
      }
      if (req.method === "POST" && url.pathname === "/api/projects") {
        const body = (await readJsonBody(req)) as { project?: Project }
        if (!body.project) throw new Error("project is required")
        const { gitRemote: _computed, ...project } = body.project
        const errors = validateProject(project)
        if (errors.length > 0) throw new Error(errors.join("; "))
        const registry = loadRegistry()
        const existingIndex = registry.projects.findIndex((item) => item.name === project.name)
        if (existingIndex === -1) registry.projects.push(project)
        else registry.projects[existingIndex] = project
        saveRegistry(registry)
        broadcastState()
        sendJson(res, 200, { changed: true, project })
        return
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/projects/")) {
        const name = decodeURIComponent(url.pathname.slice("/api/projects/".length))
        const registry = loadRegistry()
        if (!findProject(registry, name)) {
          sendJson(res, 404, { error: `no project named ${JSON.stringify(name)}`, code: "project_not_found" })
          return
        }
        if (manager.list().some((session) => session.project === name && session.status === "running")) {
          sendJson(res, 409, { error: `stop ${name}'s processes before removing it`, code: "project_running" })
          return
        }
        registry.projects = registry.projects.filter((project) => project.name !== name)
        saveRegistry(registry)
        for (const session of manager.list().filter((session) => session.project === name)) manager.dismiss(session.id)
        sendJson(res, 200, { changed: true, project: name })
        return
      }
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error), code: "invalid_request" })
      return
    }
    // Everything else is the web UI. API misses stay JSON 404s so clients
    // never mistake the SPA shell for an API response.
    if ((req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      serveWebUi(url.pathname, res, webRoot, req.method === "HEAD")
      return
    }
    res.writeHead(404)
    res.end()
  }

  const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
    handleHttp(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" })
      else res.end()
    })
  }
  const httpServer = createServer(requestHandler)
  /** Companion listener on 127.0.0.1, used only for pinned remote binds. */
  const loopbackServer = createServer(requestHandler)

  const wss = new WebSocketServer({ noServer: true })

  const handleUpgrade = (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    const ticket = url.searchParams.get("ticket")
    if (url.pathname !== "/ws" || (!isLoopback(req) && (!ticket || !consumeTicket(ticket)))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
  }
  httpServer.on("upgrade", handleUpgrade)
  loopbackServer.on("upgrade", handleUpgrade)

  wss.on("connection", (socket) => {
    clients.add(socket)
    socket.send(JSON.stringify(stateMsg()))
    // A UI opening is the moment its answer about Tailscale matters most, and
    // the cached one may be a poll old.
    void syncShares()
    for (const snapshot of manager.snapshots()) {
      socket.send(JSON.stringify({ type: "snapshot", ...snapshot } satisfies ServerMsg))
    }

    socket.on("message", (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "invalid JSON" }))
        return
      }
      try {
        handle(msg, socket)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        socket.send(JSON.stringify({ type: "error", message } satisfies ServerMsg))
      }
    })
    socket.on("close", () => clients.delete(socket))
    socket.on("error", () => clients.delete(socket))
  })

  const handle = (msg: ClientMsg, socket: WebSocket): void => {
    switch (msg.type) {
      case "start": {
        const project = findProject(loadRegistry(), msg.project)
        if (!project) throw new Error(`no project named ${JSON.stringify(msg.project)}`)
        manager.start(project, msg.process)
        return
      }
      case "stop":
        manager.stop(msg.project, msg.process)
        return
      case "restart": {
        const project = findProject(loadRegistry(), msg.project)
        if (!project) throw new Error(`no project named ${JSON.stringify(msg.project)}`)
        manager.restart(project, msg.process)
        return
      }
      case "write":
        manager.write(msg.id, msg.data)
        return
      case "resize":
        manager.resize(msg.id, msg.cols, msg.rows)
        return
      case "dismiss":
        manager.dismiss(msg.id)
        return
      case "upsertProject": {
        // gitRemote is a server-computed view; never let it round-trip into projects.json.
        const { gitRemote: _computed, ...project } = msg.project
        const errors = validateProject(project)
        if (errors.length > 0) throw new Error(errors.join("; "))
        const registry = loadRegistry()
        const existingIndex = registry.projects.findIndex((p) => p.name === project.name)
        if (existingIndex === -1) registry.projects.push(project)
        else registry.projects[existingIndex] = project
        saveRegistry(registry)
        broadcastState()
        return
      }
      case "reorderProjects": {
        const registry = loadRegistry()
        const currentNames = registry.projects.map((project) => project.name)
        if (
          msg.projects.length !== currentNames.length ||
          new Set(msg.projects).size !== msg.projects.length ||
          msg.projects.some((name) => !currentNames.includes(name))
        ) {
          throw new Error("project order must contain every project exactly once")
        }
        const byName = new Map(registry.projects.map((project) => [project.name, project]))
        registry.projects = msg.projects.map((name) => byName.get(name)!)
        saveRegistry(registry)
        broadcastState()
        return
      }
      case "updateSettings":
        saveSettings(msg.settings)
        broadcastState()
        applyBindHost()
        return
      case "createPairingToken": {
        socket.send(JSON.stringify({ type: "pairingToken", pairing: pairingInfo() } satisfies ServerMsg))
        return
      }
      case "revokeAuthSession":
        revokeSession(msg.id)
        broadcastState()
        return
      case "sharePort":
      case "unsharePort": {
        // Publishing shells out, so the reply cannot ride this synchronous
        // handler's throw path; a failure goes back to the asking client alone,
        // since nobody else's UI asked for it.
        void (async () => {
          try {
            if (msg.type === "sharePort") {
              if (msg.kind === "tailnet" && !loadSettings().links.tailnetSharing) {
                throw new Error("Tailnet HTTPS sharing is disabled in Settings")
              }
              await startShare(msg.port, msg.kind, msg.session)
            } else await stopShare(msg.port)
            await refreshShares()
            broadcastState()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "error", message } satisfies ServerMsg))
            }
          }
        })()
        return
      }
      case "getHistoryReplay": {
        const replay = loadHistoryReplay(msg.runId, loadSettings())
        socket.send(JSON.stringify({ type: "historyReplay", runId: msg.runId, ...replay } satisfies ServerMsg))
        return
      }
      case "removeProject": {
        const registry = loadRegistry()
        if (!findProject(registry, msg.project)) {
          throw new Error(`no project named ${JSON.stringify(msg.project)}`)
        }
        const sessions = manager.list().filter((s) => s.project === msg.project)
        if (sessions.some((s) => s.status === "running")) {
          throw new Error(`stop ${msg.project}'s processes before removing it`)
        }
        registry.projects = registry.projects.filter((p) => p.name !== msg.project)
        saveRegistry(registry)
        for (const session of sessions) manager.dismiss(session.id)
        broadcastState()
        return
      }
    }
  }

  // Push registry changes (e.g. an agent ran `hangar add`) to connected UIs.
  mkdirSync(hangarHome(), { recursive: true })
  let watchDebounce: NodeJS.Timeout | null = null
  watch(hangarHome(), () => {
    if (watchDebounce) clearTimeout(watchDebounce)
    watchDebounce = setTimeout(broadcastState, 200)
  })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    process.stdout.write("\nshutting down sessions...\n")
    // Serve config outlives this process, so a port Hangar published would stay
    // reachable with no UI left anywhere to show it. Only what this run created
    // is withdrawn: a serve entry the user made by hand is not ours to undo.
    // Bounded and run alongside the PTYs, because quitting must not wait on a
    // wedged tailscaled — an orphaned share is recovered at the next startup.
    await Promise.all([
      Promise.race([stopOwnShares(), new Promise((resolve) => setTimeout(resolve, SHARE_TEARDOWN_MS))]).catch(
        () => undefined,
      ),
      manager.stopAll(),
    ])
    clearRuntimeState()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())

  listen()
  httpServer.on("error", (error) => {
    process.stderr.write(`failed to listen on ${port}: ${error.message}\n`)
    clearRuntimeState()
    process.exit(1)
  })
  // Another process owning 127.0.0.1:port must not take down the remote bind.
  loopbackServer.on("error", (error) => {
    process.stderr.write(`loopback companion unavailable on 127.0.0.1:${port}: ${error.message}\n`)
  })
}
