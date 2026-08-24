import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Baked in by the desktop bundle (see build:server's --define); absent when
// the source tree runs directly under node.
declare const __HANGAR_VERSION__: string | undefined

let cached: string | null = null

/** This server's version, so a newer desktop app can spot a stale leftover. */
export function serverVersion(): string {
  if (typeof __HANGAR_VERSION__ === "string") return __HANGAR_VERSION__
  cached ??= readPackageVersion()
  return cached
}

function readPackageVersion(): string {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown }
    return typeof parsed.version === "string" ? parsed.version : "unknown"
  } catch {
    return "unknown"
  }
}
