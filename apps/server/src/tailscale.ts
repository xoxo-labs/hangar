/**
 * Publishing a detected dev-server port through Tailscale — tailnet-only via
 * `tailscale serve`, or to the open internet via `tailscale funnel`.
 *
 * The serve config is shared mutable state: the user may have hand-built
 * entries in it that Hangar must survive. So this module never runs `reset`,
 * only ever turns off the single `--https=<port>` entry a share owns, and
 * refuses to claim an HTTPS port that already carries someone else's handler.
 * Every decision about that config is a pure function over its JSON, so the
 * rules are testable without a running tailscaled.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import type { PortShare, PortShareKind, SessionId, TailscaleState } from "@hangar/contracts"

/** A wedged tailscaled must not wedge the Hangar server with it. */
const EXEC_TIMEOUT_MS = 10_000

/**
 * Funnel terminates TLS only on these three ports — a protocol cap, and the
 * reason Hangar refuses a fourth public share instead of picking another port.
 */
const FUNNEL_PORTS = [443, 8443, 10000]
/**
 * Plain serve takes any port, but an unbounded scan helps nobody; a machine
 * with fifty tailnet shares has a different problem.
 */
const TAILNET_EXTRA_PORTS = { from: 10001, to: 10050 }

/** Where the CLI hides when it is not on PATH; the macOS app bundle first. */
const BIN_CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
]

let cachedBin: string | null | undefined

/** Cached lookup: TAILSCALE_BIN env, then the macOS app bundle, then homebrew/usr paths, then PATH. */
export function tailscaleBin(): string | null {
  // The env override is read fresh so a test (or a user fixing a bad cache)
  // can retarget without restarting the server.
  const env = process.env.TAILSCALE_BIN
  if (env) return existsSync(env) ? env : null
  if (cachedBin !== undefined) return cachedBin
  cachedBin =
    BIN_CANDIDATES.find((path) => existsSync(path)) ??
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((dir) => dir !== "")
      .map((dir) => join(dir, "tailscale"))
      .find((path) => existsSync(path)) ??
    null
  return cachedBin
}

/** Shape of `tailscale serve status --json`, only the parts we read. */
export type ServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean }>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
  AllowFunnel?: Record<string, boolean>
}

/** Shape of `tailscale status --json`, only the parts we read. */
export type BackendStatus = {
  BackendState?: string
  Self?: { DNSName?: string; HostName?: string }
}

/**
 * Local port behind a proxy target, or null for anything that is not a plain
 * loopback HTTP proxy. Non-loopback targets are someone's hand-built config —
 * not ours to describe, and never ours to touch.
 */
function loopbackPort(proxy: string | undefined): number | null {
  const match = proxy?.match(/^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})\/?$/)
  if (!match?.[1]) return null
  const port = Number(match[1])
  return port > 0 && port <= 65535 ? port : null
}

/**
 * The one shape Hangar creates and therefore the only one it may manage:
 * exactly one handler, at "/", proxying loopback. Anything else on the entry —
 * extra paths, other targets — marks it foreign.
 */
function shareTarget(entry: { Handlers?: Record<string, { Proxy?: string }> }): number | null {
  const handlers = Object.entries(entry.Handlers ?? {})
  if (handlers.length !== 1 || handlers[0]?.[0] !== "/") return null
  return loopbackPort(handlers[0]?.[1]?.Proxy)
}

function shareUrl(dnsName: string, servePort: number): string {
  return `https://${dnsName}` + (servePort === 443 ? "" : `:${servePort}`)
}

/**
 * PURE. Every share visible in a live serve config, Hangar's or not, lowest
 * HTTPS port first. Tailscale keeps no timestamps, so `createdAt` is 0 here;
 * listShares() overlays what it knows.
 */
export function readShares(config: ServeConfig, dnsName: string): PortShare[] {
  const shares: PortShare[] = []
  for (const [hostPort, entry] of Object.entries(config.Web ?? {})) {
    if (!hostPort.startsWith(`${dnsName}:`)) continue
    const servePort = Number(hostPort.slice(dnsName.length + 1))
    if (!Number.isInteger(servePort)) continue
    const port = shareTarget(entry)
    if (port === null) continue
    const kind: PortShareKind = config.AllowFunnel?.[hostPort] === true ? "public" : "tailnet"
    shares.push({ port, kind, url: shareUrl(dnsName, servePort), servePort, createdAt: 0 })
  }
  return shares.sort((a, b) => a.servePort - b.servePort)
}

/**
 * PURE. Is `servePort` free for us, or does someone else's handler hold it?
 * "hangar" means the entry has the exact shape Hangar creates; a TCP forwarder
 * or Web entry of any other shape is foreign and off limits.
 */
export function servePortOwner(config: ServeConfig, dnsName: string, servePort: number): "free" | "hangar" | "foreign" {
  const web = config.Web?.[`${dnsName}:${servePort}`]
  const tcp = config.TCP?.[String(servePort)]
  if (web === undefined && tcp === undefined) return "free"
  if (web !== undefined && shareTarget(web) !== null) return "hangar"
  return "foreign"
}

/** PURE. Lowest usable HTTPS port for a new share of this kind, or null when none is left. */
export function pickServePort(config: ServeConfig, dnsName: string, kind: PortShareKind): number | null {
  const candidates = [...FUNNEL_PORTS]
  if (kind === "tailnet") {
    for (let port = TAILNET_EXTRA_PORTS.from; port <= TAILNET_EXTRA_PORTS.to; port++) candidates.push(port)
  }
  // Occupied is occupied, whether by Hangar or by a foreign handler — an HTTPS
  // port carries one config, and taking over a foreign one would destroy it.
  return candidates.find((port) => servePortOwner(config, dnsName, port) === "free") ?? null
}

/** PURE. Argument vector for turning a share on. `--yes` because there is no terminal to answer funnel's prompt. */
export function shareArgs(kind: PortShareKind, servePort: number, localPort: number): string[] {
  return [kind === "public" ? "funnel" : "serve", "--bg", "--yes", `--https=${servePort}`, String(localPort)]
}

/** PURE. Argument vector for turning a share off — always scoped to one `--https` entry, never `reset`. */
export function unshareArgs(kind: PortShareKind, servePort: number): string[] {
  return [kind === "public" ? "funnel" : "serve", `--https=${servePort}`, "off"]
}

/**
 * PURE. Which serve entry an unshare of `localPort` may touch. Prefers the
 * entry Hangar itself created (its recorded HTTPS port), so a hand-built share
 * of the same local port on another HTTPS port survives. Null when the port is
 * not shared at all — unsharing it is then a no-op, not an error.
 */
export function stopTarget(
  config: ServeConfig,
  dnsName: string,
  localPort: number,
  preferredServePort?: number,
): { kind: PortShareKind; servePort: number } | null {
  const candidates = readShares(config, dnsName).filter((share) => share.port === localPort)
  const share = candidates.find((entry) => entry.servePort === preferredServePort) ?? candidates[0]
  return share === undefined ? null : { kind: share.kind, servePort: share.servePort }
}

/**
 * PURE. When funnel is refused because the tailnet policy lacks the `funnel`
 * node attribute, Tailscale prints the admin-console link that grants it —
 * that stderr must reach the user verbatim.
 */
export function funnelDenied(stderr: string): boolean {
  return /funnel not available|node attribute|login\.tailscale\.com/i.test(stderr)
}

/** PURE. `tailscale status --json` distilled to whether sharing can work, and why not. */
export function stateFromStatus(status: BackendStatus): Omit<TailscaleState, "installed"> {
  const backend = status.BackendState
  if (backend === "Running") {
    // MagicDNS names arrive fully qualified — "host.tailnet.ts.net." — but
    // browsers want them bare.
    const dnsName = status.Self?.DNSName?.replace(/\.$/, "")
    return { running: true, ...(dnsName ? { dnsName } : {}) }
  }
  if (backend === "Stopped") return { running: false, message: "Tailscale is stopped" }
  if (backend === "NeedsLogin") return { running: false, message: "Tailscale is not logged in" }
  if (backend === "NeedsMachineAuth") return { running: false, message: "Tailscale is waiting for admin approval" }
  return { running: false, message: `Tailscale is not running (${backend ?? "unknown state"})` }
}

type RunFailure = Error & { stdout?: string; stderr?: string }

function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = tailscaleBin()
  if (bin === null) return Promise.reject(new Error("Tailscale is not installed on this machine"))
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: "utf8", timeout: EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }) as RunFailure)
      else resolve({ stdout, stderr })
    })
  })
}

/** Trimmed stderr of a failed spawn, falling back to the error's own message. */
function failureText(error: unknown): string {
  const failure = error as RunFailure
  const stderr = failure.stderr?.trim()
  return stderr !== undefined && stderr !== "" ? stderr : (failure.message ?? String(error))
}

export async function tailscaleState(): Promise<TailscaleState> {
  if (tailscaleBin() === null) {
    return { installed: false, running: false, message: "Tailscale is not installed on this machine" }
  }
  try {
    const { stdout } = await run(["status", "--json"])
    return { installed: true, ...stateFromStatus(JSON.parse(stdout) as BackendStatus) }
  } catch (error) {
    // Some versions exit non-zero for a stopped backend but still print the
    // status JSON; read it before giving up.
    try {
      const stdout = (error as RunFailure).stdout
      if (stdout) return { installed: true, ...stateFromStatus(JSON.parse(stdout) as BackendStatus) }
    } catch {
      // Not JSON either — fall through.
    }
    return { installed: true, running: false, message: "Tailscale is not responding" }
  }
}

async function serveConfig(): Promise<ServeConfig> {
  const { stdout } = await run(["serve", "status", "--json"])
  const text = stdout.trim()
  if (text === "" || text === "null") return {}
  return JSON.parse(text) as ServeConfig
}

/**
 * What Hangar knows about a share beyond what Tailscale stores: which session
 * asked for it, when, and which HTTPS port Hangar itself claimed for it (so an
 * unshare never reaches for a hand-built entry of the same local port).
 * `created` separates entries this process wrote into the serve config from
 * ones it merely adopted — only the former are Hangar's to withdraw unasked.
 */
type ShareRecord = { session?: SessionId; createdAt: number; servePort?: number; created?: true }

const records = new Map<number, ShareRecord>()

export async function listShares(): Promise<PortShare[]> {
  const state = await tailscaleState()
  if (!state.running || state.dnsName === undefined) return []
  const dnsName = state.dnsName
  let config: ServeConfig
  try {
    config = await serveConfig()
  } catch {
    // A broadcast must not fail because tailscaled hiccupped; report nothing
    // and let the next poll catch up.
    return []
  }
  const shares = readShares(config, dnsName)
  const live = new Set(shares.map((share) => share.port))
  for (const port of records.keys()) if (!live.has(port)) records.delete(port)
  return shares.map((share) => {
    let record = records.get(share.port)
    if (record === undefined) {
      // Adopted, not created: the best birth date we can give it is first sight.
      record = { createdAt: Date.now() }
      records.set(share.port, record)
    }
    return { ...share, createdAt: record.createdAt, ...(record.session ? { session: record.session } : {}) }
  })
}

/** Throws an Error whose message is ready to show a user. */
export async function startShare(port: number, kind: PortShareKind, session?: SessionId): Promise<PortShare> {
  const state = await tailscaleState()
  if (!state.installed) throw new Error("Tailscale is not installed on this machine")
  if (!state.running || state.dnsName === undefined) throw new Error(state.message ?? "Tailscale is not running")
  const dnsName = state.dnsName

  let config: ServeConfig
  try {
    config = await serveConfig()
  } catch (error) {
    throw new Error(`Tailscale could not report its serve configuration: ${failureText(error)}`)
  }

  const existing = readShares(config, dnsName).filter((share) => share.port === port)
  const match = existing.find((share) => share.kind === kind)
  if (match !== undefined) {
    // Already published the way the caller wants — adopt it rather than stack
    // a second entry on another HTTPS port.
    const record = records.get(port) ?? { createdAt: Date.now() }
    records.set(port, { ...record, session, servePort: match.servePort })
    return { ...match, createdAt: record.createdAt, ...(session ? { session } : {}) }
  }
  // Flipping a share's reach must not leave the old entry behind: a port that
  // just went tailnet-only must stop being public, and vice versa.
  const flipped = existing.find((share) => share.servePort === records.get(port)?.servePort) ?? existing[0]
  if (flipped !== undefined) await run(unshareArgs(flipped.kind, flipped.servePort))

  const servePort = pickServePort(config, dnsName, kind)
  if (servePort === null) {
    throw new Error(
      kind === "public"
        ? "Tailscale can publish at most 3 ports at once"
        : "Every HTTPS port Tailscale can publish on is already taken",
    )
  }
  // pickServePort only returns free ports, but this is the line that guards a
  // hand-built serve config, so it does not trust its caller.
  if (servePortOwner(config, dnsName, servePort) === "foreign") {
    throw new Error(`HTTPS port ${servePort} already carries a serve config Hangar did not create`)
  }

  try {
    await run(shareArgs(kind, servePort, port))
  } catch (error) {
    const stderr = (error as RunFailure).stderr ?? ""
    // The stderr carries the admin-console link that enables funnel; the user
    // must see it, not a paraphrase.
    if (kind === "public" && funnelDenied(stderr)) throw new Error(stderr.trim())
    throw new Error(`Tailscale could not publish port ${port}: ${failureText(error)}`)
  }

  const createdAt = Date.now()
  records.set(port, { ...(session ? { session } : {}), createdAt, servePort, created: true })
  return {
    port,
    kind,
    url: shareUrl(dnsName, servePort),
    servePort,
    ...(session ? { session } : {}),
    createdAt,
  }
}

/**
 * Withdraws every share this process itself created, for shutdown: the serve
 * config outlives Hangar, and a funnel with no UI behind it must not linger.
 * Adopted and hand-made entries existed before Hangar and are left standing.
 */
export async function stopOwnShares(): Promise<void> {
  for (const [port, record] of [...records]) {
    if (record.created === true) await stopShare(port).catch(() => undefined)
  }
}

export async function stopShare(port: number): Promise<void> {
  const state = await tailscaleState()
  if (!state.running || state.dnsName === undefined) {
    // Nothing can be shared while the backend is down; treat like "not shared".
    records.delete(port)
    return
  }
  let config: ServeConfig
  try {
    config = await serveConfig()
  } catch (error) {
    throw new Error(`Tailscale could not report its serve configuration: ${failureText(error)}`)
  }
  const target = stopTarget(config, state.dnsName, port, records.get(port)?.servePort)
  records.delete(port)
  if (target === null) return
  try {
    await run(unshareArgs(target.kind, target.servePort))
  } catch (error) {
    throw new Error(`Tailscale could not stop sharing port ${port}: ${failureText(error)}`)
  }
}
