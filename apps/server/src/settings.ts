import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { DEFAULT_SETTINGS, type AppSettings } from "@hangar/contracts"
import { expandHome, hangarHome } from "./registry.ts"

export function settingsPath(): string {
  return join(hangarHome(), "settings.json")
}

export function loadSettings(): AppSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<AppSettings>
    return {
      appearance: {
        ...DEFAULT_SETTINGS.appearance,
        ...(parsed.appearance ?? {}),
      },
      links: {
        ...DEFAULT_SETTINGS.links,
        ...(parsed.links ?? {}),
      },
      terminal: {
        ...DEFAULT_SETTINGS.terminal,
        ...(parsed.terminal ?? {}),
      },
      terminalLogging: {
        ...DEFAULT_SETTINGS.terminalLogging,
        ...(parsed.terminalLogging ?? {}),
      },
      sessionHistory: {
        ...DEFAULT_SETTINGS.sessionHistory,
        ...(parsed.sessionHistory ?? {}),
      },
      onboarding: {
        ...DEFAULT_SETTINGS.onboarding,
        ...(parsed.onboarding ?? {}),
      },
    }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function saveSettings(settings: AppSettings): void {
  validateSettings(settings)
  mkdirSync(hangarHome(), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + "\n")
  pruneLogs(settings)
}

function pruneLogs(settings: AppSettings): void {
  const days = settings.terminalLogging.retentionDays
  if (days === null) return
  const root = resolve(expandHome(settings.terminalLogging.directory))
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const visit = (directory: string): void => {
    let names: string[]
    try {
      names = readdirSync(directory)
    } catch {
      return
    }
    for (const name of names) {
      const path = join(directory, name)
      try {
        const stat = statSync(path)
        if (stat.isDirectory()) visit(path)
        else if (stat.mtimeMs < cutoff) rmSync(path)
      } catch {}
    }
  }
  visit(root)
}

function validateSettings(settings: AppSettings): void {
  if (!["system", "light", "dark"].includes(settings?.appearance?.theme)) {
    throw new Error("invalid theme setting")
  }
  if (typeof settings.appearance.shortcutHints !== "boolean") {
    throw new Error("invalid shortcut hints setting")
  }
  if (!["system", "safari", "chrome", "arc", "firefox", "brave", "edge"].includes(settings?.links?.browser)) {
    throw new Error("invalid browser setting")
  }
  if (!["auto", "lan", "tailscale", "custom"].includes(settings?.links?.shareHost)) {
    throw new Error("invalid share host setting")
  }
  if (typeof settings.links.customHost !== "string") throw new Error("invalid custom share host")
  const terminal = settings?.terminal
  if (
    typeof terminal?.copyOnSelect !== "boolean" ||
    typeof terminal.fontFamily !== "string" ||
    !terminal.fontFamily.trim()
  ) {
    throw new Error("invalid terminal settings")
  }
  if (!Number.isFinite(terminal.fontSize) || terminal.fontSize < 8 || terminal.fontSize > 32) {
    throw new Error("terminal font size must be between 8 and 32 px")
  }
  const log = settings?.terminalLogging
  if (!log || typeof log.enabled !== "boolean" || !log.directory?.trim()) {
    throw new Error("invalid terminal logging settings")
  }
  if (![7, 30, null].includes(log.retentionDays)) throw new Error("invalid log retention")
  if (!Number.isFinite(log.maxFileSizeMb) || log.maxFileSizeMb < 1 || log.maxFileSizeMb > 1000) {
    throw new Error("log size must be between 1 and 1000 MB")
  }
  if (log.format !== "plain" && log.format !== "ansi") throw new Error("invalid log format")
  const history = settings?.sessionHistory
  if (!history || typeof history.enabled !== "boolean") throw new Error("invalid session history settings")
  if (![7, 30, 90, null].includes(history.retentionDays)) throw new Error("invalid history retention")
  if (typeof settings?.onboarding?.tutorialSeen !== "boolean") throw new Error("invalid onboarding settings")
}
