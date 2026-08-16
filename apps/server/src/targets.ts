import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type CliTarget = {
  id: string
  host: string
  port: number
  secure: boolean
  token?: string
  serverName?: string
}

type TargetFile = { version: 1; targets: CliTarget[] }

export function targetsPath(): string {
  return process.env.HANGAR_CLI_CONFIG ?? join(homedir(), ".hangar", "targets.json")
}

export function loadTargets(): CliTarget[] {
  try {
    const parsed = JSON.parse(readFileSync(targetsPath(), "utf8")) as TargetFile
    if (parsed.version !== 1 || !Array.isArray(parsed.targets)) return []
    return parsed.targets.filter(
      (target) =>
        typeof target?.id === "string" &&
        typeof target.host === "string" &&
        Number.isInteger(target.port) &&
        typeof target.secure === "boolean",
    )
  } catch {
    return []
  }
}

export function saveTargets(targets: CliTarget[]): void {
  const path = targetsPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, targets }, null, 2) + "\n", { mode: 0o600 })
  renameSync(temporary, path)
}

export function resolveTarget(id = process.env.HANGAR_TARGET ?? "local"): CliTarget | undefined {
  if (id === "local") {
    return { id, host: "127.0.0.1", port: Number(process.env.HANGAR_PORT ?? 4780), secure: false }
  }
  if (id === "dev") return { id, host: "127.0.0.1", port: 4781, secure: false }
  const stored = loadTargets().find((target) => target.id === id)
  if (stored) return stored
  try {
    const address = parseAddress(id)
    return { id, ...address }
  } catch {
    return undefined
  }
}

export function parseAddress(input: string): { host: string; port: number; secure: boolean } {
  const value = input.trim()
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`
  const url = new URL(withScheme)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("target must use http or https")
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 4780))
  if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("invalid target address")
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port, secure: url.protocol === "https:" }
}

export function targetBase(target: CliTarget): string {
  const host = target.host.includes(":") ? `[${target.host}]` : target.host
  return `${target.secure ? "https" : "http"}://${host}:${target.port}`
}
