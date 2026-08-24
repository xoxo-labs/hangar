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

/**
 * What an explicitly requested check should say when it comes back. The menu
 * item has no other way to report itself: the sidebar control appears only when
 * there is something to click, so "nothing found" would otherwise look like a
 * menu item that does nothing at all.
 */
export function describeCheckResult(state: DesktopUpdateState): { title: string; body: string } {
  switch (state.status) {
    case "disabled":
      return { title: "Updates are unavailable", body: state.message ?? "This build cannot check for updates." }
    case "available":
      return { title: "Update available", body: `Version ${state.availableVersion} is ready to download.` }
    case "downloading":
      return {
        title: "Already downloading",
        body: `Version ${state.availableVersion ?? "the update"} is downloading — ${state.downloadPercent ?? 0}% done.`,
      }
    case "downloaded":
      return {
        title: "Update ready",
        body: `Version ${state.downloadedVersion} is staged. Restart Hangar to install it.`,
      }
    case "error":
      return { title: "Check failed", body: state.message ?? "Hangar could not reach the update feed." }
    default:
      return { title: "You are up to date", body: `Hangar ${state.currentVersion} is the latest version.` }
  }
}

export type SidebarUpdate = {
  kind: Exclude<UpdateActionKind, "check">
  /** Non-null exactly while a download runs. */
  percent: number | null
  /** Short copy shown inside the pill itself. */
  text: string
  /** Full sentence for the tooltip and accessible name. */
  label: string
}

/**
 * The sidebar's update pill, or null when it must not render at all: in a
 * browser or on mobile (no desktop shell, so no state), while the updater is
 * disabled, idle or checking, and for errors only a fresh check could clear.
 * Checking stays in Settings — the sidebar only appears when a single click
 * has something to do.
 */
export function resolveSidebarUpdate(state: DesktopUpdateState | null): SidebarUpdate | null {
  if (state === null) return null
  if (state.status === "downloading") {
    const percent = clampPercent(state.downloadPercent)
    return {
      kind: "download",
      percent,
      text: `Downloading (${percent}%)`,
      label: `Downloading ${describeVersion(state.availableVersion)}… ${percent}%`,
    }
  }

  const action = resolveUpdateAction(state)
  if (action === null || action.kind === "check") return null
  if (action.kind === "install") {
    return {
      kind: "install",
      percent: null,
      text: "Restart to update",
      label: `Restart to install ${describeVersion(state.downloadedVersion)}`,
    }
  }
  // A failed download keeps the plain offer as its copy; the tooltip names the retry.
  const verb = state.status === "error" ? "Retry downloading" : "Download"
  return {
    kind: "download",
    percent: null,
    text: "Update available",
    label: `${verb} ${describeVersion(state.availableVersion)}`,
  }
}

/** Versions come off the feed and can in principle be missing; never say "version null". */
function describeVersion(version: string | null): string {
  return version === null ? "the update" : `version ${version}`
}

/** electron-updater reports a float, and a resumed download can overshoot 100. */
function clampPercent(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}
