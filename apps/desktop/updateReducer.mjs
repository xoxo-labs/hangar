// Pure state transitions for the desktop updater. updater.mjs feeds
// electron-updater events through reduceUpdateEvent and consults the guards
// before starting an action; keeping this free of Electron makes it testable
// with plain `node --test`.

/** @typedef {"disabled"|"idle"|"checking"|"available"|"downloading"|"downloaded"|"error"} UpdateStatus */

export function initialUpdateState(currentVersion) {
  return {
    status: "idle",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    message: null,
  }
}

/**
 * Events mirror electron-updater's: checking, available {version},
 * not-available, download-progress {percent}, downloaded {version},
 * error {message}. availableVersion/downloadedVersion deliberately survive an
 * error so the UI can offer the right retry.
 */
export function reduceUpdateEvent(state, event) {
  switch (event.type) {
    case "checking":
      return { ...state, status: "checking", message: null }
    case "available":
      return { ...state, status: "available", availableVersion: event.version, message: null }
    case "not-available":
      return { ...state, status: "idle", availableVersion: null, downloadPercent: null, message: null }
    case "download-progress":
      return { ...state, status: "downloading", downloadPercent: event.percent, message: null }
    case "downloaded":
      return { ...state, status: "downloaded", downloadedVersion: event.version, downloadPercent: null, message: null }
    case "error":
      return { ...state, status: "error", downloadPercent: null, message: event.message }
    default:
      return state
  }
}

/** A check while a download is staged or running would reset its state. */
export function canCheck(state) {
  return state.status !== "checking" && state.status !== "downloading" && state.status !== "downloaded"
}

export function canDownload(state) {
  return state.status === "available" || (state.status === "error" && state.availableVersion !== null)
}

export function canInstall(state) {
  return state.status === "downloaded" || (state.status === "error" && state.downloadedVersion !== null)
}
