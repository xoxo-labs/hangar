#!/usr/bin/env node
import { parseArgs } from "node:util"
import { resolve } from "node:path"
import {
  expandHome,
  findProject,
  loadRegistry,
  registryPath,
  saveRegistry,
  validateProject,
} from "./registry.ts"
import { startProject } from "./start.ts"
import type { Project, ProjectProcess } from "@hangar/contracts"

const HELP = `hangar — local project launcher

Usage:
  hangar ls [--json]                     List registered projects
  hangar add <name> <path> [options]     Register a project
  hangar add --json '<project-json>'     Register a project from JSON (agent-friendly)
  hangar rm <name>                       Remove a project from the registry
  hangar path <name>                     Print a project's absolute path
  hangar start <name> [process]          Start all (or one) of a project's processes
  hangar serve [--port <n>]              Run the hangar server (WebSocket + PTYs) for the GUI
  hangar help                            Show this help

Options for add:
  --cmd "name=command[@cwd]"   A process to run; repeatable. cwd is relative to
                               the project path. Default: "dev=pnpm dev"
  --force                      Overwrite an existing project with the same name

Registry file: ${registryPath()}

JSON shape for add --json:
  {"name":"lust","path":"~/code/xoxo/lust","processes":[
    {"name":"web","cmd":"pnpm dev","cwd":"apps/lust-web"}]}
`

function fail(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n")
  process.exit(1)
}

function parseCmdFlag(value: string): ProjectProcess {
  const eq = value.indexOf("=")
  if (eq === -1) fail(`--cmd must look like "name=command[@cwd]", got: ${value}`)
  const name = value.slice(0, eq).trim()
  const rest = value.slice(eq + 1)
  const at = rest.lastIndexOf("@")
  if (at === -1) return { name, cmd: rest.trim() }
  return { name, cmd: rest.slice(0, at).trim(), cwd: rest.slice(at + 1).trim() }
}

function cmdLs(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean" } } })
  const registry = loadRegistry()
  if (values.json) {
    process.stdout.write(JSON.stringify(registry.projects, null, 2) + "\n")
    return
  }
  if (registry.projects.length === 0) {
    process.stdout.write(`no projects yet — try: hangar add <name> <path>\n`)
    return
  }
  const width = Math.max(...registry.projects.map((p) => p.name.length))
  for (const project of registry.projects) {
    const procs = project.processes.map((p) => p.name).join(", ")
    process.stdout.write(`${project.name.padEnd(width)}  ${project.path}  [${procs}]\n`)
  }
}

function cmdAdd(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "string" },
      cmd: { type: "string", multiple: true },
      force: { type: "boolean" },
    },
  })

  let project: Project
  if (values.json !== undefined) {
    try {
      project = JSON.parse(values.json) as Project
    } catch (error) {
      fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    const [name, path] = positionals
    if (!name || !path) fail(`usage: hangar add <name> <path> [--cmd "name=command[@cwd]"]`)
    const processes = (values.cmd ?? []).map(parseCmdFlag)
    project = {
      name,
      path: path.startsWith("~") ? path : resolve(path),
      processes: processes.length > 0 ? processes : [{ name: "dev", cmd: "pnpm dev" }],
    }
  }

  const errors = validateProject(project)
  if (errors.length > 0) fail(errors.join("\n"))

  const registry = loadRegistry()
  const existing = findProject(registry, project.name)
  if (existing && !values.force) {
    fail(`project ${JSON.stringify(project.name)} already exists (use --force to overwrite)`)
  }
  const existingIndex = registry.projects.findIndex((p) => p.name === project.name)
  if (existingIndex === -1) registry.projects.push(project)
  else registry.projects[existingIndex] = project
  saveRegistry(registry)
  process.stdout.write(`${existing ? "updated" : "added"} ${project.name}\n`)
}

function cmdRm(argv: string[]): void {
  const [name] = argv
  if (!name) fail("usage: hangar rm <name>")
  const registry = loadRegistry()
  if (!findProject(registry, name)) fail(`no project named ${JSON.stringify(name)}`)
  registry.projects = registry.projects.filter((p) => p.name !== name)
  saveRegistry(registry)
  process.stdout.write(`removed ${name}\n`)
}

function cmdPath(argv: string[]): void {
  const [name] = argv
  if (!name) fail("usage: hangar path <name>")
  const project = findProject(loadRegistry(), name)
  if (!project) fail(`no project named ${JSON.stringify(name)}`)
  process.stdout.write(expandHome(project.path) + "\n")
}

async function cmdStart(argv: string[]): Promise<void> {
  const [name, only] = argv
  if (!name) fail("usage: hangar start <name> [process]")
  const project = findProject(loadRegistry(), name)
  if (!project) fail(`no project named ${JSON.stringify(name)}`)
  process.exitCode = await startProject(project, only)
}

async function cmdServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" } } })
  const port = Number(values.port ?? process.env.HANGAR_PORT ?? 4780)
  if (!Number.isInteger(port) || port <= 0) fail(`invalid port: ${values.port}`)
  // Lazy import keeps plain CLI commands fast and independent of native modules.
  const { serve } = await import("./serve.ts")
  serve(port)
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case "ls":
      return cmdLs(rest)
    case "add":
      return cmdAdd(rest)
    case "rm":
      return cmdRm(rest)
    case "path":
      return cmdPath(rest)
    case "start":
      return cmdStart(rest)
    case "serve":
      return cmdServe(rest)
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP)
      return
    default:
      fail(`unknown command: ${command}\n\n${HELP}`)
  }
}

await main()
