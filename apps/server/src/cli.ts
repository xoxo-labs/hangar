#!/usr/bin/env node
import { spawn } from "node:child_process"
import { hostname, homedir } from "node:os"
import { resolve } from "node:path"
import { parseArgs, stripVTControlCharacters } from "node:util"
import type { CliResult, Project, ProjectProcess, ServerMsg, SessionInfo } from "@hangar/contracts"
import { WebSocket } from "ws"
import { ApiError, HangarApi } from "./api-client.ts"
import { expandHome, findProject, loadRegistry, registryPath, saveRegistry, validateProject } from "./registry.ts"
import { readRuntimeState } from "./runtime-state.ts"
import { startProject } from "./start.ts"
import { loadTargets, parseAddress, resolveTarget, saveTargets, targetBase, type CliTarget } from "./targets.ts"

const HELP = `hangar — supervise local or remote development servers

Usage:
  hangar [global options] ls [project] [--json]
  hangar [global options] add <name> <path> [--cmd "name=command[@cwd]"]
  hangar [global options] add --json '<project-json>' [--force]
  hangar [global options] rm <name>
  hangar [global options] path <name>
  hangar [global options] detect <path> [--json]
  hangar [global options] browse [path] [--json]
  hangar [global options] status [project[/process]] [--running] [--json]
  hangar [global options] start|stop|restart <project[/process]> [--wait-port[=<n>]] [--json]
  hangar [global options] logs <project/process> [--tail <n>] [--ansi] [--json]
  hangar [global options] ports [project[/process]] [--json]
  hangar [global options] target ls|add|rm|pair-code
  hangar run <project[/process]>       Legacy foreground runner
  hangar serve [--port <n>] [--host <addr>]   Run the Hangar server

Global options (before the command):
  -t, --target <name|host:port>  Target server; default local (env: HANGAR_TARGET)
  --json                         Stable JSON envelope on stdout
  --timeout <duration>           Request/wait timeout, e.g. 10s or 500ms
  --no-autostart                 Do not start a missing local server

Built-in targets: local (:4780), dev (:4781). Registry: ${registryPath()}
`

type GlobalOptions = {
  targetId: string
  json: boolean
  timeoutMs: number
  autostart: boolean
}

class CliFailure extends Error {
  code: string
  exitCode: number
  data?: unknown

  constructor(message: string, code = "command_failed", exitCode = 1, data?: unknown) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.data = data
  }
}

function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m)?$/.exec(value)
  if (!match) throw new CliFailure(`invalid duration: ${value}`, "invalid_usage", 2)
  const amount = Number(match[1])
  const multiplier = match[2] === "m" ? 60_000 : match[2] === "ms" ? 1 : 1_000
  if (amount <= 0) throw new CliFailure(`invalid duration: ${value}`, "invalid_usage", 2)
  return amount * multiplier
}

function parseGlobal(argv: string[]): { options: GlobalOptions; argv: string[] } {
  const options: GlobalOptions = {
    targetId: process.env.HANGAR_TARGET ?? "local",
    json: false,
    timeoutMs: 10_000,
    autostart: true,
  }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest[0]!
    if (arg === "--json") {
      options.json = true
      rest.shift()
    } else if (arg === "--no-autostart") {
      options.autostart = false
      rest.shift()
    } else if (arg === "-t" || arg === "--target") {
      rest.shift()
      const value = rest.shift()
      if (!value) throw new CliFailure(`${arg} needs a value`, "invalid_usage", 2)
      options.targetId = value
    } else if (arg.startsWith("--target=")) {
      options.targetId = arg.slice("--target=".length)
      rest.shift()
    } else if (arg === "--timeout") {
      rest.shift()
      const value = rest.shift()
      if (!value) throw new CliFailure("--timeout needs a value", "invalid_usage", 2)
      options.timeoutMs = parseDuration(value)
    } else if (arg.startsWith("--timeout=")) {
      options.timeoutMs = parseDuration(arg.slice("--timeout=".length))
      rest.shift()
    } else break
  }
  // Keep compatibility with the existing command-local --json spelling.
  const jsonIndex = rest.lastIndexOf("--json")
  // `add --json <project>` already owns this flag. A final value-less --json
  // remains accepted for compatibility with `ls --json` and friends.
  if (jsonIndex === rest.length - 1) {
    options.json = true
    rest.splice(jsonIndex, 1)
  }
  return { options, argv: rest }
}

let globalOptions: GlobalOptions = {
  targetId: process.env.HANGAR_TARGET ?? "local",
  json: false,
  timeoutMs: 10_000,
  autostart: true,
}

function target(): CliTarget {
  const value = resolveTarget(globalOptions.targetId)
  if (!value) throw new CliFailure(`unknown target ${JSON.stringify(globalOptions.targetId)}`, "target_not_found", 3)
  return value
}

function success(data: unknown, changed?: boolean): void {
  if (globalOptions.json) {
    const result: CliResult = {
      ok: true,
      target: globalOptions.targetId,
      ...(changed === undefined ? {} : { changed }),
      data,
    }
    process.stdout.write(JSON.stringify(result) + "\n")
  }
}

function human(message: string): void {
  if (!globalOptions.json) process.stdout.write(message.endsWith("\n") ? message : message + "\n")
}

function selector(value: string | undefined, required = true): { project: string; process?: string } {
  if (!value) {
    if (required) throw new CliFailure("a project[/process] selector is required", "invalid_usage", 2)
    return { project: "" }
  }
  const slash = value.indexOf("/")
  if (slash === -1) return { project: value }
  const project = value.slice(0, slash)
  const processName = value.slice(slash + 1)
  if (!project || !processName) throw new CliFailure(`invalid selector: ${value}`, "invalid_usage", 2)
  return { project, process: processName }
}

function parseCmdFlag(value: string): ProjectProcess {
  const eq = value.indexOf("=")
  if (eq === -1) throw new CliFailure(`--cmd must look like "name=command[@cwd]", got: ${value}`, "invalid_usage", 2)
  const name = value.slice(0, eq).trim()
  const rest = value.slice(eq + 1)
  const at = rest.lastIndexOf("@")
  if (at === -1) return { name, cmd: rest.trim() }
  return { name, cmd: rest.slice(0, at).trim(), cwd: rest.slice(at + 1).trim() }
}

function isLocalTarget(): boolean {
  return globalOptions.targetId === "local" || globalOptions.targetId === "dev"
}

async function api(autostart = true): Promise<HangarApi> {
  const resolved = target()
  const client = new HangarApi(resolved, globalOptions.timeoutMs)
  try {
    await client.state()
    return client
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new CliFailure(
        `Hangar on ${targetBase(resolved)} does not support CLI control; update or restart that Hangar server`,
        "server_incompatible",
        3,
      )
    }
    if (
      !(error instanceof ApiError) ||
      error.code !== "target_unreachable" ||
      !autostart ||
      !globalOptions.autostart ||
      !isLocalTarget()
    )
      throw error
  }

  const cliEntry = process.argv[1]
  if (!cliEntry) throw new CliFailure("cannot locate the Hangar server entry point", "target_unreachable", 3)
  // A server that bound only a remote address is alive but invisible to our
  // loopback probe. Spawning a second one would double-supervise HANGAR_HOME,
  // so surface the situation instead.
  const existing = readRuntimeState()
  if (existing?.port === resolved.port) {
    if (!["127.0.0.1", "0.0.0.0", "::", "::1", "localhost"].includes(existing.host)) {
      throw new CliFailure(
        `a Hangar server (pid ${existing.pid}) is bound to ${existing.host}:${existing.port}, which is not reachable on 127.0.0.1 — try: hangar -t ${existing.host}:${existing.port} ...`,
        "target_unreachable",
        3,
      )
    }
    // Locally reachable but not answering yet (still booting, most likely):
    // fall through to the poll below without racing it with a second spawn.
  } else {
    const child = spawn(process.execPath, [cliEntry, "serve", "--port", String(resolved.port)], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        HANGAR_PORT: String(resolved.port),
        ...(globalOptions.targetId === "dev" && !process.env.HANGAR_HOME
          ? { HANGAR_HOME: `${homedir()}/.hangar-dev` }
          : {}),
      },
    })
    child.unref()
  }
  const deadline = Date.now() + globalOptions.timeoutMs
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 150))
    try {
      await client.state()
      if (!globalOptions.json) process.stderr.write(`started Hangar server on ${targetBase(resolved)}\n`)
      return client
    } catch {}
  }
  throw new CliFailure(`Hangar server did not start on ${targetBase(resolved)}`, "target_unreachable", 3)
}

async function projects(): Promise<Project[]> {
  if (isLocalTarget()) return loadRegistry().projects
  return (await (await api(false)).state()).projects
}

async function cmdLs(argv: string[]): Promise<void> {
  const name = argv[0]
  let list = await projects()
  if (name) list = list.filter((project) => project.name === name)
  if (name && list.length === 0) throw new CliFailure(`no project named ${JSON.stringify(name)}`, "project_not_found")
  if (globalOptions.json) return success(list)
  if (list.length === 0) return human("no projects yet — try: hangar add <name> <path>")
  const width = Math.max(...list.map((project) => project.name.length))
  for (const project of list)
    human(`${project.name.padEnd(width)}  ${project.path}  [${project.processes.map((proc) => proc.name).join(", ")}]`)
}

function readProject(argv: string[]): { project: Project; force: boolean } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: "string" }, cmd: { type: "string", multiple: true }, force: { type: "boolean" } },
  })
  let project: Project
  if (values.json !== undefined) {
    try {
      project = JSON.parse(values.json) as Project
    } catch (error) {
      throw new CliFailure(
        `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        "invalid_usage",
        2,
      )
    }
  } else {
    const [name, path] = positionals
    if (!name || !path) throw new CliFailure("usage: hangar add <name> <path>", "invalid_usage", 2)
    const processes = (values.cmd ?? []).map(parseCmdFlag)
    project = {
      name,
      path: path.startsWith("~") ? path : resolve(path),
      processes: processes.length > 0 ? processes : [{ name: "dev", cmd: "pnpm dev" }],
    }
  }
  const errors = validateProject(project)
  if (errors.length > 0) throw new CliFailure(errors.join("; "), "invalid_project")
  return { project, force: values.force ?? false }
}

async function cmdAdd(argv: string[]): Promise<void> {
  const { project, force } = readProject(argv)
  if (isLocalTarget()) {
    const registry = loadRegistry()
    const index = registry.projects.findIndex((item) => item.name === project.name)
    if (index !== -1 && !force)
      throw new CliFailure(`project ${JSON.stringify(project.name)} already exists (use --force)`, "project_exists")
    if (index === -1) registry.projects.push(project)
    else registry.projects[index] = project
    saveRegistry(registry)
    success(project, true)
    human(`${index === -1 ? "added" : "updated"} ${project.name}`)
    return
  }
  const existing = (await projects()).some((item) => item.name === project.name)
  if (existing && !force)
    throw new CliFailure(`project ${JSON.stringify(project.name)} already exists (use --force)`, "project_exists")
  const result = await (await api(false)).upsertProject(project)
  success(result.project, result.changed)
  human(`${existing ? "updated" : "added"} ${project.name} on ${globalOptions.targetId}`)
}

async function cmdRm(argv: string[]): Promise<void> {
  const name = argv[0]
  if (!name) throw new CliFailure("usage: hangar rm <name>", "invalid_usage", 2)
  if (isLocalTarget()) {
    const registry = loadRegistry()
    if (!findProject(registry, name))
      throw new CliFailure(`no project named ${JSON.stringify(name)}`, "project_not_found")
    registry.projects = registry.projects.filter((project) => project.name !== name)
    saveRegistry(registry)
  } else await (await api(false)).removeProject(name)
  success({ project: name }, true)
  human(`removed ${name}${isLocalTarget() ? "" : ` from ${globalOptions.targetId}`}`)
}

async function cmdPath(argv: string[]): Promise<void> {
  const name = argv[0]
  if (!name) throw new CliFailure("usage: hangar path <name>", "invalid_usage", 2)
  const project = (await projects()).find((item) => item.name === name)
  if (!project) throw new CliFailure(`no project named ${JSON.stringify(name)}`, "project_not_found")
  const path = isLocalTarget() ? expandHome(project.path) : project.path
  success({ path })
  human(path)
}

function matchingSessions(sessions: SessionInfo[], value?: string): SessionInfo[] {
  if (!value) return sessions
  const selected = selector(value)
  return sessions.filter(
    (session) => session.project === selected.project && (!selected.process || session.process === selected.process),
  )
}

async function cmdStatus(argv: string[]): Promise<void> {
  const runningIndex = argv.indexOf("--running")
  const runningOnly = runningIndex !== -1
  if (runningIndex !== -1) argv.splice(runningIndex, 1)
  let sessions = matchingSessions((await (await api()).sessions()).sessions, argv[0])
  if (runningOnly) sessions = sessions.filter((session) => session.status === "running")
  success({ sessions })
  if (!globalOptions.json) {
    if (sessions.length === 0) return human("no matching sessions")
    for (const session of sessions) {
      const ports = session.metrics?.ports.length ? ` ports:${session.metrics.ports.join(",")}` : ""
      // The reason belongs on the line that reports the failure, not one `logs`
      // call away.
      const why = session.exitDiagnosis ? `  ${session.exitDiagnosis.message}` : ""
      human(
        `${session.id}  ${session.status}${session.pid ? ` pid:${session.pid}` : ""}${ports}${session.exitCode !== null && session.exitCode !== undefined ? ` exit:${session.exitCode}` : ""}${why}`,
      )
    }
  }
}

function readWaitPort(argv: string[]): number | null | undefined {
  const index = argv.findIndex((arg) => arg === "--wait-port" || arg.startsWith("--wait-port="))
  if (index === -1) return undefined
  const value = argv[index]!
  argv.splice(index, 1)
  if (value === "--wait-port") return null
  const port = Number(value.slice("--wait-port=".length))
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new CliFailure(`invalid wait port: ${port}`, "invalid_usage", 2)
  return port
}

/** One short re-read, in case the exit arrived before its diagnosis did. */
async function settledExit(client: HangarApi, exited: SessionInfo): Promise<SessionInfo> {
  await new Promise((done) => setTimeout(done, 400))
  const again = await client
    .sessions()
    .then(({ sessions }) => sessions.find((session) => session.runId === exited.runId))
    .catch(() => undefined)
  return again ?? exited
}

async function waitForPort(
  client: HangarApi,
  selected: { project: string; process?: string },
  wanted: number | null,
  previousRunIds = new Set<string>(),
): Promise<SessionInfo[]> {
  const deadline = Date.now() + globalOptions.timeoutMs
  while (Date.now() < deadline) {
    const sessions = (await client.probe()).sessions.filter(
      (session) => session.project === selected.project && (!selected.process || session.process === selected.process),
    )
    const currentRuns = sessions.filter((session) => !previousRunIds.has(session.runId))
    const opened = currentRuns.filter((session) =>
      wanted === null ? (session.metrics?.ports.length ?? 0) > 0 : session.metrics?.ports.includes(wanted),
    )
    if (opened.length > 0) return opened
    const exited = currentRuns.find((session) => session.status === "exited")
    if (exited && currentRuns.length > 0 && !currentRuns.some((session) => session.status === "running")) {
      // The server diagnoses a failure just after the exit lands, so a probe
      // that caught the exit first is worth repeating once for the reason.
      const failed = exited.exitDiagnosis ? exited : await settledExit(client, exited)
      const log = await client.logs(failed.id).catch(() => ({ data: "" }))
      throw new CliFailure(
        `${failed.id} exited before opening ${wanted === null ? "a port" : `port ${wanted}`}${
          failed.exitDiagnosis ? `: ${failed.exitDiagnosis.message}` : ""
        }`,
        "process_exited",
        1,
        {
          sessions,
          ...(failed.exitDiagnosis ? { exitDiagnosis: failed.exitDiagnosis } : {}),
          logTail: tailLines(stripVTControlCharacters(log.data), 40),
        },
      )
    }
    await new Promise((done) => setTimeout(done, 750))
  }
  throw new CliFailure(`timed out waiting for ${wanted === null ? "a port" : `port ${wanted}`}`, "wait_timeout", 4)
}

async function cmdLifecycle(action: "start" | "stop" | "restart", argv: string[]): Promise<void> {
  const waitPort = readWaitPort(argv)
  if (waitPort !== undefined && action === "stop")
    throw new CliFailure("--wait-port is only valid with start or restart", "invalid_usage", 2)
  const selected = selector(argv[0])
  const client = await api()
  const previousRunIds =
    action === "restart" && waitPort !== undefined
      ? new Set(
          matchingSessions((await client.sessions()).sessions, argv[0])
            .filter((session) => session.status === "running")
            .map((session) => session.runId),
        )
      : new Set<string>()
  const result = await client.session(action, selected.project, selected.process)
  const sessions =
    waitPort === undefined ? result.sessions : await waitForPort(client, selected, waitPort, previousRunIds)
  success({ sessions }, result.changed)
  const pastTense = action === "start" ? "started" : action === "stop" ? "stopped" : "restarted"
  human(`${pastTense} ${argv[0]}${globalOptions.targetId === "local" ? "" : ` on ${globalOptions.targetId}`}`)
}

function tailLines(data: string, count: number): string[] {
  if (count === 0) return []
  return data.replace(/\r\n/g, "\n").split("\n").slice(-count)
}

async function followLogs(client: HangarApi, id: string, ansi: boolean): Promise<void> {
  const ticket = client.target.token ? await client.ticket() : null
  const base = targetBase(client.target).replace(/^http/, "ws")
  const url = `${base}/ws${ticket ? `?ticket=${encodeURIComponent(ticket.ticket)}` : ""}`
  await new Promise<void>((resolvePromise, reject) => {
    const socket = new WebSocket(url)
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      socket.close()
      if (error) reject(error)
      else resolvePromise()
    }
    socket.on("message", (raw) => {
      let message: ServerMsg
      try {
        message = JSON.parse(String(raw)) as ServerMsg
      } catch {
        return
      }
      if ((message.type === "snapshot" || message.type === "output") && message.id === id) {
        const data = ansi ? message.data : stripVTControlCharacters(message.data)
        if (globalOptions.json) process.stdout.write(JSON.stringify({ id, data }) + "\n")
        else process.stdout.write(data)
      } else if (message.type === "exit" && message.id === id) finish()
      else if (message.type === "error") finish(new CliFailure(message.message, "stream_error"))
    })
    socket.on("error", (error) => finish(error))
    socket.on("close", () => finish())
    const shutdown = () => finish()
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  })
}

async function cmdLogs(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { tail: { type: "string" }, ansi: { type: "boolean" }, follow: { type: "boolean" } },
  })
  const id = positionals[0]
  const selected = selector(id)
  if (!selected.process) throw new CliFailure("logs needs a project/process selector", "invalid_usage", 2)
  const client = await api()
  if (values.follow) {
    await followLogs(client, id!, values.ansi ?? false)
    return
  }
  const count = Number(values.tail ?? 200)
  if (!Number.isInteger(count) || count < 0)
    throw new CliFailure("--tail must be a non-negative integer", "invalid_usage", 2)
  const result = await client.logs(id!)
  const text = values.ansi ? result.data : stripVTControlCharacters(result.data)
  const lines = tailLines(text, count)
  success({ id, lines, truncated: lines.join("\n").length < text.length })
  if (!globalOptions.json) process.stdout.write(lines.join("\n") + (lines.length ? "\n" : ""))
}

async function cmdPorts(argv: string[]): Promise<void> {
  const sessions = matchingSessions((await (await api()).sessions()).sessions, argv[0])
  const selectedTarget = target()
  const remoteHost = selectedTarget.host.includes(":") ? `[${selectedTarget.host}]` : selectedTarget.host
  const targetIsLoopback =
    selectedTarget.host === "127.0.0.1" || selectedTarget.host === "::1" || selectedTarget.host === "localhost"
  const data = sessions.flatMap((session) =>
    (session.metrics?.ports ?? []).map((port) => {
      const bindings = session.metrics?.portBindings?.[port] ?? []
      const loopbackOnly =
        bindings.length > 0 && bindings.every((binding) => /^(?:127(?:\.\d+){3}|localhost|\[?::1\]?)$/.test(binding))
      const reachable = targetIsLoopback || !loopbackOnly
      return {
        session: session.id,
        port,
        bindings,
        listenUrl: `http://127.0.0.1:${port}`,
        remoteUrl: reachable ? `http://${remoteHost}:${port}` : null,
        reachable,
        ...(reachable ? {} : { note: "process is bound to loopback on the target" }),
      }
    }),
  )
  success({ ports: data })
  for (const item of data) human(`${item.session}  ${item.port}  ${item.bindings.join(", ") || "binding unknown"}`)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8").trim()
}

async function cmdTarget(argv: string[]): Promise<void> {
  const [action, ...rest] = argv
  if (action === "ls") {
    const targets = [resolveTarget("local")!, resolveTarget("dev")!, ...loadTargets()].map(
      ({ token: _token, ...item }) => item,
    )
    success({ targets })
    for (const item of targets) human(`${item.id.padEnd(12)} ${targetBase(item)}`)
    return
  }
  if (action === "pair-code") {
    const pairing = await (await api()).pairingCode()
    // A loopback-bound server would mint a code no remote device could ever
    // redeem; refuse with the remedy instead of printing a dead QR. An
    // advertised address means something out there dials in via NAT — allow it.
    if (pairing.advertiseHost === undefined && ["127.0.0.1", "::1", "localhost"].includes(pairing.bindHost ?? "")) {
      throw new CliFailure(
        `the server on ${targetBase(target())} only listens on loopback — restart it with: hangar serve --host <addr> (or enable remote connections in settings)`,
        "server_loopback",
      )
    }
    // A pinned non-wildcard bind is the one address that is certainly right.
    const pinned =
      pairing.bindHost !== undefined && pairing.bindHost !== "0.0.0.0" && pairing.bindHost !== "::"
        ? pairing.bindHost
        : undefined
    const host = pairing.advertiseHost ?? pinned ?? pairing.hosts.tailscale[0] ?? pairing.hosts.lan[0] ?? target().host
    const value = `${host}:${pairing.port}#${pairing.token}`
    success({ pairing: { ...pairing, value } })
    human(`${value}  expires in 5:00`)
    // The QR carries the same pairing string the mobile scanner expects.
    // TTY-only: piped output keeps the single-line form.
    if (!globalOptions.json && process.stdout.isTTY) {
      const qrcode = await import("qrcode")
      human(await qrcode.toString(value, { type: "terminal", small: true }))
    }
    return
  }
  if (action === "add") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { code: { type: "string" } },
    })
    const [id, address] = positionals
    if (!id || !address || values.code === undefined)
      throw new CliFailure("usage: hangar target add <name> <host:port> --code -", "invalid_usage", 2)
    if (id === "local" || id === "dev") throw new CliFailure(`${id} is a built-in target`, "invalid_usage", 2)
    if (loadTargets().some((item) => item.id === id))
      throw new CliFailure(`target ${JSON.stringify(id)} already exists`, "target_exists")
    const code = values.code === "-" ? await readStdin() : values.code
    const added: CliTarget = { id, ...parseAddress(address) }
    const pair = await new HangarApi(added, globalOptions.timeoutMs).pair(code, `cli@${hostname()}`)
    added.token = pair.sessionToken
    added.serverName = pair.serverName
    saveTargets([...loadTargets(), added])
    success({ target: { ...added, token: undefined } }, true)
    human(`paired ${id} with ${pair.serverName}`)
    return
  }
  if (action === "rm") {
    const id = rest[0]
    if (!id) throw new CliFailure("usage: hangar target rm <name>", "invalid_usage", 2)
    const stored = loadTargets()
    const removed = stored.find((item) => item.id === id)
    if (!removed) throw new CliFailure(`unknown target ${JSON.stringify(id)}`, "target_not_found")
    let revoked = false
    try {
      revoked = (await new HangarApi(removed, globalOptions.timeoutMs).revokeSelf()).revoked
    } catch {}
    saveTargets(stored.filter((item) => item.id !== id))
    success({ target: id, revoked }, true)
    human(`removed ${id}${revoked ? " and revoked its token" : " (server-side revocation unavailable)"}`)
    return
  }
  throw new CliFailure("usage: hangar target ls|add|rm|pair-code", "invalid_usage", 2)
}

async function cmdDetect(argv: string[]): Promise<void> {
  const path = argv[0]
  if (!path) throw new CliFailure("usage: hangar detect <path>", "invalid_usage", 2)
  const result = await (await api()).detect(path)
  success(result)
  if (!globalOptions.json) human(JSON.stringify(result, null, 2))
}

async function cmdBrowse(argv: string[]): Promise<void> {
  // No path means the home directory: it is where picking a project starts.
  const result = await (await api()).browse(argv[0] ?? "")
  success(result)
  if (globalOptions.json) return
  human(result.parent)
  const width = Math.max(0, ...result.entries.map((entry) => entry.name.length + 1))
  for (const entry of result.entries) {
    const tags = [entry.git ? "git" : "", entry.pkg ? "pkg" : ""].filter(Boolean).join(" ")
    human(tags === "" ? `  ${entry.name}/` : `  ${`${entry.name}/`.padEnd(width)}  ${tags}`)
  }
  if (result.truncated) human(`  … capped at ${result.entries.length} entries; type more to narrow the listing`)
}

async function cmdRun(argv: string[]): Promise<void> {
  if (!isLocalTarget())
    throw new CliFailure("run is local-only; use start for supervised remote sessions", "invalid_usage", 2)
  const selected = selector(argv[0])
  const project = findProject(loadRegistry(), selected.project)
  if (!project) throw new CliFailure(`no project named ${JSON.stringify(selected.project)}`, "project_not_found")
  process.exitCode = await startProject(project, selected.process)
}

async function cmdServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, host: { type: "string" } } })
  const port = Number(values.port ?? process.env.HANGAR_PORT ?? 4780)
  if (!Number.isInteger(port) || port <= 0) throw new CliFailure(`invalid port: ${values.port}`, "invalid_usage", 2)
  const { serve } = await import("./serve.ts")
  serve(port, values.host)
}

async function main(): Promise<void> {
  const parsed = parseGlobal(process.argv.slice(2))
  globalOptions = parsed.options
  if (globalOptions.targetId === "dev" && process.env.HANGAR_HOME === undefined) {
    process.env.HANGAR_HOME = `${homedir()}/.hangar-dev`
  }
  const [command, ...rest] = parsed.argv
  switch (command) {
    case "ls":
      return cmdLs(rest)
    case "add":
      return cmdAdd(rest)
    case "rm":
      return cmdRm(rest)
    case "path":
      return cmdPath(rest)
    case "detect":
      return cmdDetect(rest)
    case "browse":
      return cmdBrowse(rest)
    case "status":
      return cmdStatus(rest)
    case "start":
      return cmdLifecycle("start", rest)
    case "stop":
      return cmdLifecycle("stop", rest)
    case "restart":
      return cmdLifecycle("restart", rest)
    case "logs":
      return cmdLogs(rest)
    case "ports":
      return cmdPorts(rest)
    case "target":
      return cmdTarget(rest)
    case "run":
      return cmdRun(rest)
    case "serve":
      return cmdServe(rest)
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP)
      return
    default:
      throw new CliFailure(`unknown command: ${command}`, "invalid_usage", 2)
  }
}

try {
  await main()
} catch (error) {
  const parseArgsError =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("ERR_PARSE_ARGS")
  const failure =
    error instanceof CliFailure
      ? error
      : error instanceof ApiError
        ? new CliFailure(
            error.message,
            error.code,
            error.code === "target_unreachable" || error.code === "unauthorized" ? 3 : 1,
          )
        : parseArgsError
          ? new CliFailure(error instanceof Error ? error.message : String(error), "invalid_usage", 2)
          : new CliFailure(error instanceof Error ? error.message : String(error))
  if (globalOptions?.json) {
    const result: CliResult = {
      ok: false,
      target: globalOptions.targetId,
      error: { code: failure.code, message: failure.message },
      ...(failure.data === undefined ? {} : { data: failure.data }),
    }
    process.stdout.write(JSON.stringify(result) + "\n")
  } else process.stderr.write(failure.message + "\n")
  process.exitCode = failure.exitCode
}
