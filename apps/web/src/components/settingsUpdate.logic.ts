import type { DesktopUpdateState } from "@hangar/contracts"

export function updateStatusLine(state: DesktopUpdateState): string {
  switch (state.status) {
    case "checking":
      return "Checking for updates…"
    case "available":
      return `Version ${state.availableVersion} is available.`
    case "downloading":
      return `Downloading ${state.availableVersion ?? "update"}… ${state.downloadPercent ?? 0}%`
    case "downloaded":
      return `Version ${state.downloadedVersion} is ready to install.`
    case "error":
      return state.message ?? "Update failed."
    default:
      return "Hangar is up to date."
  }
}

export type UpdateActionKind = "check" | "download" | "install"

/** Which single button the update row shows; null while busy (checking/downloading). */
export function resolveUpdateAction(state: DesktopUpdateState): { label: string; kind: UpdateActionKind } | null {
  if (state.status === "downloaded" || (state.status === "error" && state.downloadedVersion !== null)) {
    return { label: "Restart & install", kind: "install" }
  }
  if (state.status === "available") return { label: "Download", kind: "download" }
  if (state.status === "error" && state.availableVersion !== null) return { label: "Retry download", kind: "download" }
  if (state.status === "idle" || state.status === "error") return { label: "Check for updates", kind: "check" }
  return null
}
