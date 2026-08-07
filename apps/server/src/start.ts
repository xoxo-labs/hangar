import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { expandHome } from "./registry.ts"
import type { Project, ProjectProcess } from "@hangar/contracts"

const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m", "\x1b[31m"]
const RESET = "\x1b[0m"

type Running = {
  proc: ProjectProcess
  child: ChildProcess
}

function prefixedWriter(label: string, color: string, out: NodeJS.WriteStream) {
  let pending = ""
  const prefix = `${color}[${label}]${RESET} `
  return (chunk: Buffer | string) => {
    pending += chunk.toString()
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) out.write(prefix + line + "\n")
  }
}

export async function startProject(project: Project, only?: string): Promise<number> {
  const root = expandHome(project.path)
  if (!existsSync(root)) {
    process.stderr.write(`project path does not exist: ${root}\n`)
    return 1
  }

  const targets = only ? project.processes.filter((p) => p.name === only) : project.processes
  if (targets.length === 0) {
    process.stderr.write(`no process named ${JSON.stringify(only)} in project ${project.name}\n`)
    return 1
  }

  const running: Running[] = []
  const width = Math.max(...targets.map((t) => t.name.length))

  for (const [i, proc] of targets.entries()) {
    const cwd = proc.cwd ? join(root, proc.cwd) : root
    if (!existsSync(cwd)) {
      process.stderr.write(`cwd for ${proc.name} does not exist: ${cwd}\n`)
      stopAll(running)
      return 1
    }
    const color = COLORS[i % COLORS.length] ?? ""
    const label = proc.name.padEnd(width)
    const command = proc.shell ? `${process.env.SHELL ?? "/bin/zsh"} -l` : proc.cmd
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      env: { ...process.env, ...project.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout?.on("data", prefixedWriter(label, color, process.stdout))
    child.stderr?.on("data", prefixedWriter(label, color, process.stderr))
    process.stdout.write(`${color}[${label}]${RESET} $ ${command}  (pid ${child.pid})\n`)
    running.push({ proc, child })
  }

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    process.stdout.write("\nstopping...\n")
    stopAll(running)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  const codes = await Promise.all(
    running.map(
      ({ proc, child }) =>
        new Promise<number>((resolvePromise) => {
          child.on("exit", (code, signal) => {
            if (!shuttingDown) {
              process.stdout.write(`[${proc.name}] exited (${signal ?? code})\n`)
            }
            resolvePromise(code ?? 0)
          })
        }),
    ),
  )
  return codes.every((c) => c === 0) ? 0 : 1
}

function stopAll(running: Running[]): void {
  for (const { child } of running) {
    if (child.pid === undefined || child.exitCode !== null) continue
    // Negative pid signals the whole process group, so `pnpm dev`'s children die too.
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      try {
        child.kill("SIGTERM")
      } catch {}
    }
  }
}
