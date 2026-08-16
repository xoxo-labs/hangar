import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Project, SessionInfo } from "@hangar/contracts"
import { sessionId } from "@hangar/contracts"
import { hangarHome } from "./registry.ts"

/**
 * Bridge to the App Intents surface (Spotlight/Shortcuts). The Swift side
 * never talks to this server directly: we export entity snapshots as JSON
 * for its providers to read, and consume the command files its handlers
 * write. In dev both live under HANGAR_HOME; the packaged app points
 * HANGAR_APPINTENTS_DIR at the App Group container instead.
 */
export function appIntentsDir(): string {
  return process.env.HANGAR_APPINTENTS_DIR ?? join(hangarHome(), "appintents")
}

const commandsDir = (): string => join(appIntentsDir(), "Commands")

/** Field names mirror apps/desktop/appintents/appintents.config.json. */
type ProjectRecord = { id: string; name: string; path: string; status: string }
type ProcessRecord = { id: string; name: string; project: string; qualifiedName: string; state: string }

export type AppIntentsCommand = { kind: string; targetId: string; issuedAt: string }

function writeAtomic(file: string, records: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n", { mode: 0o600 })
  renameSync(tmp, file)
}

export function exportAppIntentsState(projects: Project[], sessions: SessionInfo[]): void {
  // Spotlight/Shortcuts only exist on macOS; a headless Linux server has no
  // Swift side to feed, so skip the writes entirely.
  if (process.platform !== "darwin") return
  const running = new Set(sessions.filter((s) => s.status === "running").map((s) => s.id))

  const projectRecords: ProjectRecord[] = projects.map((project) => {
    const total = project.processes.length
    const active = project.processes.filter((proc) => running.has(sessionId(project.name, proc.name))).length
    return {
      id: project.name,
      name: project.name,
      path: project.path,
      status: `${active} running · ${total} ${total === 1 ? "process" : "processes"}`,
    }
  })

  const processRecords: ProcessRecord[] = projects.flatMap((project) =>
    project.processes.map((proc) => ({
      id: sessionId(project.name, proc.name),
      name: proc.name,
      project: project.name,
      qualifiedName: `${proc.name} · ${project.name}`,
      state: running.has(sessionId(project.name, proc.name)) ? "running" : "stopped",
    })),
  )

  const dir = appIntentsDir()
  mkdirSync(dir, { recursive: true })
  writeAtomic(join(dir, "Project.json"), projectRecords)
  writeAtomic(join(dir, "Process.json"), processRecords)
}

/**
 * Consume every pending command file, oldest first, then keep watching for
 * new ones. Commands written while no server was running are drained on
 * startup — the disk is the queue.
 */
export function watchAppIntentsCommands(execute: (command: AppIntentsCommand) => void): void {
  if (process.platform !== "darwin") return
  const dir = commandsDir()
  mkdirSync(dir, { recursive: true })

  const drain = (): void => {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
    for (const name of files) {
      const file = join(dir, name)
      let command: AppIntentsCommand
      try {
        command = JSON.parse(readFileSync(file, "utf8")) as AppIntentsCommand
      } catch {
        continue // partially written; the watch event for the rename will retry
      }
      try {
        unlinkSync(file)
      } catch {
        continue // another drain got here first
      }
      execute(command)
    }
  }

  drain()
  let timer: ReturnType<typeof setTimeout> | null = null
  watch(dir, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(drain, 50)
  })
}
