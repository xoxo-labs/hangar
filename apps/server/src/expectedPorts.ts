/**
 * Where a command is expected to listen, guessed without running anything.
 *
 * The sampler in sessions.ts reports the ports a live process actually opened;
 * this module answers the same question for a process that is stopped or still
 * booting: where will it land? Every heuristic Hangar has about reading ports
 * out of commands lives here and only here — callers hand in the command plus
 * context Hangar already holds (package.json scripts, the project's configured
 * env) and get ranked guesses back. Pure by design: reading next.config,
 * vite.config or .env files off disk was rejected, because a config format we
 * half-parse produces wrong ports, and a wrong port is worse than a missing one.
 *
 * Fan-out runners (`turbo run dev`, `pnpm -r dev`, `pnpm --filter … dev`) start
 * many packages whose scripts this module was not given, so they yield nothing
 * at all — even an explicit flag on them may reach several packages at once. A
 * caller that knows which package runs resolves it and calls once per package.
 *
 * diagnose.ts is the other half of the port story: it parses ports out of a
 * failed process's *output*, this module parses *commands*. They share only
 * the notion of what a valid port is.
 */
import type { PortGuess } from "@hangar/contracts"
import { validPort } from "./diagnose.ts"

export type { PortGuess }

export type ExpectedPortsContext = {
  /** package.json scripts of the directory the command runs in. */
  scripts?: Record<string, string>
  /** Environment Hangar itself will add (the project's env), not the whole shell env. */
  env?: Record<string, string>
}

/** Managers that run package.json scripts; `pnpm dev` and `pnpm run dev` both resolve. */
const SCRIPT_RUNNERS = new Set(["pnpm", "npm", "yarn", "bun"])

/** Wrappers that vanish at exec time; the real binary is whatever follows them. */
const TRANSPARENT_WRAPPERS = new Set(["npx", "pnpx", "bunx", "cross-env", "env"])

/** Runners that always fan out across workspace packages, whatever their flags. */
const FANOUT_RUNNERS = new Set(["turbo", "lerna"])

/**
 * Manager subcommands that are commands of the manager itself, so a script of
 * the same name must not be resolved: `pnpm install` never means scripts.install.
 */
const MANAGER_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "upgrade",
  "exec",
  "dlx",
  "create",
  "init",
  "link",
  "unlink",
  "publish",
  "pack",
  "patch",
  "audit",
  "outdated",
  "list",
  "ls",
  "why",
  "config",
  "store",
  "setup",
  "import",
  "rebuild",
  "prune",
  "workspace",
  "cache",
  "info",
  "login",
  "logout",
])

/** Subcommands that build or check instead of serving; a port for these would be confidently wrong. */
const NON_SERVING = new Set(["build", "export", "test", "lint", "typecheck", "check", "compile", "generate"])

/**
 * Ports these tools pick when nobody says otherwise — the honest-guess layer,
 * which is why every hit comes out `certain: false`: any entry can be moved by
 * a config file this module deliberately does not read. Keyed by binary, or by
 * "binary subcommand(s)" where the bare binary would be ambiguous; the longest
 * key wins. Extend freely, but only with defaults that are actually documented.
 */
const FRAMEWORK_DEFAULTS: Record<string, number> = {
  next: 3000,
  "vite preview": 4173,
  vite: 5173,
  astro: 4321,
  nuxt: 3000,
  "ng serve": 4200,
  storybook: 6006,
  expo: 8081,
  wrangler: 8787,
  "gatsby serve": 9000,
  gatsby: 8000,
  docusaurus: 3000,
  remix: 3000,
  "react-router": 3000,
  uvicorn: 8000,
  "manage.py runserver": 8000,
  flask: 5000,
  "rails server": 3000,
  "rails s": 3000,
  "php artisan serve": 8000,
}

/**
 * Tools that read PORT from the environment when no flag names one. The node
 * runtimes are here because a hand-written server.js almost always does; vite,
 * uvicorn and friends are not, because they genuinely ignore PORT and claiming
 * otherwise would be a certain-looking lie.
 */
const READS_PORT_ENV = new Set([
  "node",
  "tsx",
  "ts-node",
  "deno",
  "next",
  "nuxt",
  "remix",
  "react-router",
  "gatsby",
  "rails",
])

/** Binaries whose `-p` means something other than a port (`pnpm -p`, `npm i -p`). */
const P_IS_NOT_PORT = new Set([...SCRIPT_RUNNERS, "npx", "pnpx", "bunx", "corepack"])

const SOURCE_RANK: Record<PortGuess["source"], number> = { explicit: 0, env: 1, default: 2 }

/** "node_modules/.bin/next" and "./manage.py" both go by their last segment. */
function base(token: string): string {
  return token.split(/[\\/]/).pop() ?? token
}

/** A value is only a port when it is nothing but one: "8080:80" and "3000x" are not. */
function numericPort(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const port = Number(value)
  return validPort(port) ? port : undefined
}

/**
 * Splits a command the way a reader does: quotes group, whitespace separates,
 * and `&&`, `||`, `;`, `|`, `&` end one command and start the next. A full
 * shell grammar was rejected — registry commands are one-liners, and
 * mis-tokenizing an exotic one merely yields no guess.
 */
function commandSegments(cmd: string): string[][] {
  const segs: string[][] = []
  let current: string[] = []
  let token = ""
  let started = false
  let quote: '"' | "'" | null = null
  const endToken = (): void => {
    if (started) current.push(token)
    token = ""
    started = false
  }
  const endSegment = (): void => {
    endToken()
    if (current.length > 0) segs.push(current)
    current = []
  }
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!
    if (quote !== null) {
      if (ch === quote) quote = null
      else token += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (ch === "&" || ch === "|" || ch === ";") {
      endSegment()
      if (ch !== ";" && cmd[i + 1] === ch) i++
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n") {
      endToken()
      continue
    }
    token += ch
    started = true
  }
  endSegment()
  return segs
}

function explicitGuess(port: number, evidence: string): PortGuess {
  return { port, source: "explicit", evidence, certain: true }
}

/**
 * The host side of docker's `-p [ip:]host:container[/proto]`. A bare container
 * port publishes to a random host port — exactly the case with nothing to predict.
 */
function dockerPublishHostPort(value: string): number | undefined {
  const parts = value.split("/")[0]!.split(":")
  if (parts.length < 2) return undefined
  return numericPort(parts[parts.length - 2])
}

/**
 * `guesses` may be empty while `sawPortFlag` is true: the command named a port
 * we could not read (`--port $PORT`, `--port 99999`). The caller then guesses
 * nothing at all — the user overrode the default, so offering it back is wrong.
 */
type ExplicitScan = { guesses: PortGuess[]; sawPortFlag: boolean }

function explicitGuesses(binary: string, args: string[]): ExplicitScan {
  const guesses: PortGuess[] = []
  let sawPortFlag = false
  if (binary === "docker") {
    // Only `docker run`/`docker create` publish ports with -p; on
    // `docker compose`, -p names the project.
    const sub = args.find((arg) => !arg.startsWith("-"))
    if (sub !== "run" && sub !== "create") return { guesses, sawPortFlag }
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      const value =
        arg === "-p" || arg === "--publish"
          ? args[i + 1]
          : arg.startsWith("-p=")
            ? arg.slice("-p=".length)
            : arg.startsWith("--publish=")
              ? arg.slice("--publish=".length)
              : undefined
      if (value === undefined) continue
      // A -p that only names the container side is not "unreadable": it is a
      // random host port by design, so it does not poison the other guesses.
      const port = dockerPublishHostPort(value)
      if (port !== undefined) guesses.push(explicitGuess(port, `-p ${value}`))
    }
    return { guesses, sawPortFlag }
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "--port") {
      sawPortFlag = true
      const port = numericPort(args[i + 1])
      if (port !== undefined) guesses.push(explicitGuess(port, `--port ${port}`))
    } else if (arg.startsWith("--port=")) {
      sawPortFlag = true
      const port = numericPort(arg.slice("--port=".length))
      if (port !== undefined) guesses.push(explicitGuess(port, `--port=${port}`))
    } else if (!P_IS_NOT_PORT.has(binary)) {
      // Glued forms like `-p8080` are skipped on purpose: too many tools pack
      // something other than a port after -p, and precision beats coverage.
      if (arg === "-p") {
        sawPortFlag = true
        const port = numericPort(args[i + 1])
        if (port !== undefined) guesses.push(explicitGuess(port, `-p ${port}`))
      } else if (arg.startsWith("-p=")) {
        sawPortFlag = true
        const port = numericPort(arg.slice("-p=".length))
        if (port !== undefined) guesses.push(explicitGuess(port, `-p=${port}`))
      }
    }
  }
  return { guesses, sawPortFlag }
}

/** Whether a manager invocation runs a script in many workspace packages at once. */
function fansOut(args: string[]): boolean {
  const boundary = args.indexOf("--")
  const own = boundary === -1 ? args : args.slice(0, boundary)
  return own.some(
    (arg) =>
      arg === "-r" ||
      arg === "--recursive" ||
      arg === "--parallel" ||
      arg === "--filter" ||
      arg.startsWith("--filter="),
  )
}

/**
 * The script a manager command runs, if the given scripts actually define it.
 * `extra` is whatever follows the script name — managers pass those args to
 * the script itself, so `pnpm dev -p 3001` re-parses as `<dev script> -p 3001`.
 */
function scriptInvocation(
  binary: string,
  args: string[],
  scripts: Record<string, string> | undefined,
): { script: string; extra: string[] } | undefined {
  const boundary = args.indexOf("--")
  const own = boundary === -1 ? args : args.slice(0, boundary)
  const positionals = own.filter((arg) => !arg.startsWith("-"))
  const first = positionals[0]
  if (first === undefined) return undefined
  const script =
    first === "run" || first === "run-script"
      ? positionals[1]
      : binary === "npm"
        ? // npm runs only its lifecycle scripts without `run`; `npm dev` is an error.
          first === "start" || first === "test"
          ? first
          : undefined
        : MANAGER_BUILTINS.has(first)
          ? undefined
          : first
  if (script === undefined || scripts?.[script] === undefined) return undefined
  const at = args.indexOf(script)
  return { script, extra: args.slice(at + 1).filter((arg) => arg !== "--") }
}

/** Longest-match lookup into FRAMEWORK_DEFAULTS over the command's head tokens. */
function defaultGuess(binary: string, args: string[]): PortGuess | undefined {
  const head = [binary, ...args.filter((arg) => !arg.startsWith("-")).map(base)]
  for (let len = Math.min(3, head.length); len >= 1; len--) {
    const port = FRAMEWORK_DEFAULTS[head.slice(0, len).join(" ")]
    if (port === undefined) continue
    // Evidence reads like the command ("next dev", not "next") — but the second
    // token joins only when it looks like a subcommand, not an app path.
    const second = head[1]
    const shown = Math.max(len, second !== undefined && /^[A-Za-z][\w.-]*$/.test(second) ? 2 : 1)
    return { port, source: "default", evidence: head.slice(0, shown).join(" "), certain: false }
  }
  return undefined
}

/**
 * One command's guesses, layered so that nothing weak shadows anything strong:
 * an explicit flag, then an inline PORT=, then script resolution, then the
 * project's configured PORT (only for tools that read it), then the framework
 * default. `seen` carries the script names already resolved on this chain, so
 * a script that names itself cannot recurse forever.
 */
function segmentGuesses(tokens: string[], ctx: ExpectedPortsContext | undefined, seen: Set<string>): PortGuess[] {
  let inlinePort: number | undefined
  let i = 0
  while (i < tokens.length) {
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(tokens[i]!)
    if (assignment !== null) {
      if (assignment[1] === "PORT") inlinePort = numericPort(assignment[2])
      i++
      continue
    }
    if (TRANSPARENT_WRAPPERS.has(base(tokens[i]!))) {
      i++
      // The wrapper's own flags (`npx -y next`) are not the binary either.
      while (i < tokens.length && tokens[i]!.startsWith("-")) i++
      continue
    }
    break
  }
  let binary = base(tokens[i] ?? "")
  let args = tokens.slice(i + 1)
  if (binary === "") return []
  // `python -m uvicorn` and `python manage.py` serve as the module or script, not as python.
  if (binary === "python" || binary === "python3" || binary === "python2") {
    if (args[0] === "-m" && args[1] !== undefined) {
      binary = base(args[1])
      args = args.slice(2)
    } else if (args[0] !== undefined && args[0].endsWith(".py")) {
      binary = base(args[0])
      args = args.slice(1)
    }
  }

  const explicit = explicitGuesses(binary, args)
  if (explicit.guesses.length > 0) return explicit.guesses
  if (explicit.sawPortFlag) return []
  if (inlinePort !== undefined) {
    return [{ port: inlinePort, source: "env", evidence: `PORT=${inlinePort}`, certain: true }]
  }
  if (FANOUT_RUNNERS.has(binary)) return []

  if (SCRIPT_RUNNERS.has(binary)) {
    if (fansOut(args)) return []
    const invocation = scriptInvocation(binary, args, ctx?.scripts)
    if (invocation === undefined || seen.has(invocation.script)) return []
    seen.add(invocation.script)
    const resolved = ctx?.scripts?.[invocation.script] ?? ""
    return commandSegments(`${resolved} ${invocation.extra.join(" ")}`).flatMap((segment) =>
      segmentGuesses(segment, ctx, seen),
    )
  }

  const sub = args.find((arg) => !arg.startsWith("-"))
  if (sub !== undefined && NON_SERVING.has(sub)) return []
  const configuredPort = numericPort(ctx?.env?.PORT)
  if (configuredPort !== undefined && READS_PORT_ENV.has(binary)) {
    return [{ port: configuredPort, source: "env", evidence: `PORT=${configuredPort}`, certain: true }]
  }
  const guess = defaultGuess(binary, args)
  return guess === undefined ? [] : [guess]
}

/**
 * Every port `cmd` is expected to open, deduped by port with the strongest
 * evidence kept, certain guesses first and then ascending. An empty answer
 * means "no idea", never "no ports" — absence of a guess is the designed
 * failure mode for everything this module cannot read with confidence.
 */
export function expectedPorts(cmd: string, ctx?: ExpectedPortsContext): PortGuess[] {
  const byPort = new Map<number, PortGuess>()
  for (const tokens of commandSegments(cmd)) {
    for (const guess of segmentGuesses(tokens, ctx, new Set())) {
      const held = byPort.get(guess.port)
      if (held === undefined || SOURCE_RANK[guess.source] < SOURCE_RANK[held.source]) byPort.set(guess.port, guess)
    }
  }
  return [...byPort.values()].sort((a, b) => Number(b.certain) - Number(a.certain) || a.port - b.port)
}
