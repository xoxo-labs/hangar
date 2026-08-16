import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { hangarHome } from "./registry.ts"

/**
 * A liveness marker for the one server owning this HANGAR_HOME: written when
 * the socket binds, removed on shutdown. Readers must treat it as a hint —
 * a SIGKILL leaves it behind, which is why reads verify the pid.
 */
export type ServerRuntimeState = {
  version: 1
  pid: number
  host: string
  port: number
  startedAt: number
}

export function runtimeStatePath(): string {
  return join(hangarHome(), "server-runtime.json")
}

export function writeRuntimeState(host: string, port: number): void {
  mkdirSync(hangarHome(), { recursive: true })
  const state: ServerRuntimeState = { version: 1, pid: process.pid, host, port, startedAt: Date.now() }
  const temporary = `${runtimeStatePath()}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n")
  renameSync(temporary, runtimeStatePath())
}

/** Only the writer may clear: a restarting server must not erase its successor's file. */
export function clearRuntimeState(): void {
  try {
    const parsed = JSON.parse(readFileSync(runtimeStatePath(), "utf8")) as ServerRuntimeState
    if (parsed.pid === process.pid) unlinkSync(runtimeStatePath())
  } catch {
    // No file, or someone else's — either way there is nothing of ours to clear.
  }
}

/** Returns the state only when the recorded process is still alive. */
export function readRuntimeState(): ServerRuntimeState | null {
  let parsed: ServerRuntimeState
  try {
    parsed = JSON.parse(readFileSync(runtimeStatePath(), "utf8")) as ServerRuntimeState
  } catch {
    return null
  }
  if (
    parsed.version !== 1 ||
    !Number.isInteger(parsed.pid) ||
    typeof parsed.host !== "string" ||
    !Number.isInteger(parsed.port)
  )
    return null
  try {
    process.kill(parsed.pid, 0)
  } catch {
    return null
  }
  return parsed
}
