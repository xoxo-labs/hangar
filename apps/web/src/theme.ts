import type { ThemeSetting } from "@hangar/contracts"
import { applyTerminalTheme } from "./terminals"

export type ResolvedTheme = "light" | "dark"

/*
 * The setting lives in AppSettings (server-side, synced over ws) but is also
 * mirrored to localStorage so the inline script in index.html can settle the
 * `dark` class before first paint, long before the socket delivers state.
 */
const STORAGE_KEY = "hangar-theme"

const systemDark = matchMedia("(prefers-color-scheme: dark)")
let setting: ThemeSetting = readCachedSetting()

/** Re-resolves while the setting is "system" and the OS preference flips. */
export function initTheme(): void {
  systemDark.addEventListener("change", () => {
    if (setting === "system") apply()
  })
}

/** Called with every `state` broadcast; cheap when nothing changed. */
export function applyThemeSetting(next: ThemeSetting): void {
  setting = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {}
  apply()
}

export function resolvedTheme(): ResolvedTheme {
  return setting === "system" ? (systemDark.matches ? "dark" : "light") : setting
}

function apply(): void {
  const resolved = resolvedTheme()
  document.documentElement.classList.toggle("dark", resolved === "dark")
  applyTerminalTheme(resolved)
}

function readCachedSetting(): ThemeSetting {
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached === "light" || cached === "dark" || cached === "system") return cached
  } catch {}
  return "system"
}
