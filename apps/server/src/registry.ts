import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import type { Project, Registry } from "@hangar/contracts"

const EMPTY: Registry = { version: 1, projects: [] }

export function hangarHome(): string {
  return process.env.HANGAR_HOME ?? join(homedir(), ".hangar")
}

export function registryPath(): string {
  return join(hangarHome(), "projects.json")
}

export function expandHome(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  return p
}

export function loadRegistry(): Registry {
  let raw: string
  try {
    raw = readFileSync(registryPath(), "utf8")
  } catch {
    return structuredClone(EMPTY)
  }
  const parsed = JSON.parse(raw) as Registry
  if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    throw new Error(`Unrecognized registry format in ${registryPath()}`)
  }
  return parsed
}

export function saveRegistry(registry: Registry): void {
  mkdirSync(hangarHome(), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2) + "\n")
}

export function findProject(registry: Registry, name: string): Project | undefined {
  return registry.projects.find((p) => p.name === name)
}

export function validateProject(project: Project): string[] {
  const errors: string[] = []
  if (!project.name || /[\s/]/.test(project.name)) {
    errors.push(`invalid project name: ${JSON.stringify(project.name)}`)
  }
  const path = expandHome(project.path ?? "")
  if (!path || !isAbsolute(resolve(path))) {
    errors.push(`invalid path: ${JSON.stringify(project.path)}`)
  }
  if (!Array.isArray(project.processes) || project.processes.length === 0) {
    errors.push("a project needs at least one process")
  } else {
    for (const proc of project.processes) {
      if (!proc.name || !proc.cmd) {
        errors.push(`process needs name and cmd: ${JSON.stringify(proc)}`)
      }
    }
    const names = new Set(project.processes.map((p) => p.name))
    if (names.size !== project.processes.length) {
      errors.push("process names must be unique within a project")
    }
  }
  return errors
}
