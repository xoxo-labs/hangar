// hangar desktop updater — wires electron-updater to the pure state machine in
// updateReducer.mjs.
//
// The feed lives on GitHub Releases (see "publish" in package.json); at package
// time electron-builder embeds Resources/app-update.yml pointing there, and at
// runtime electron-updater compares the release's latest-mac.yml against the
// running version. Nothing is automatic: the renderer asks to download, then
// asks to restart & install. main.mjs only loads this module when updates can
// work, so the electron-updater dependency is bundled into dist/updater.cjs at
// build time and never ships as loose node_modules.

import electronUpdater from "electron-updater"
import { canCheck, canDownload, canInstall, initialUpdateState, reduceUpdateEvent } from "./updateReducer.mjs"

const { autoUpdater } = electronUpdater

const STARTUP_CHECK_DELAY_MS = 15_000
const POLL_INTERVAL_MS = 30 * 60_000

/**
 * `broadcast(state)` pushes every state change to the renderer.
 * `prepareInstall()` runs right before quitAndInstall — flag the quit and stop
 * the server child so it gets SIGTERM instead of dying with the process.
 * `mockFeedUrl` (dev/testing) points the updater at a local generic feed — see
 * scripts/mock-update-server.mjs — instead of the embedded GitHub one.
 */
export function createUpdater({ currentVersion, broadcast, prepareInstall, mockFeedUrl = null }) {
  let state = initialUpdateState(currentVersion)
  let installing = false

  const apply = (event) => {
    const next = reduceUpdateEvent(state, event)
    if (next === state) return
    state = next
    broadcast({ ...state })
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (mockFeedUrl !== null) {
    // Lets an unpackaged (dev) run reach checkForUpdates at all; harmless when
    // packaged. The mock feed replaces whatever app-update.yml says.
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL({ provider: "generic", url: mockFeedUrl })
  }

  autoUpdater.on("checking-for-update", () => apply({ type: "checking" }))
  autoUpdater.on("update-available", (info) => apply({ type: "available", version: info.version }))
  autoUpdater.on("update-not-available", () => apply({ type: "not-available" }))
  autoUpdater.on("update-downloaded", (info) => apply({ type: "downloaded", version: info.version }))

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent)
    // One broadcast per whole percent; the raw events fire far more often.
    if (state.status !== "downloading" || state.downloadPercent !== percent) {
      apply({ type: "download-progress", percent })
    }
  })

  autoUpdater.on("error", (error) => {
    installing = false
    apply({ type: "error", message: error?.message ?? String(error) })
  })

  const snapshot = () => ({ ...state })

  async function check() {
    if (!canCheck(state)) return snapshot()
    await autoUpdater.checkForUpdates().catch(() => {
      // The "error" listener above already moved the state machine.
    })
    return snapshot()
  }

  async function download() {
    if (!canDownload(state)) return snapshot()
    apply({ type: "download-progress", percent: 0 })
    await autoUpdater.downloadUpdate().catch(() => {})
    return snapshot()
  }

  async function install() {
    if (!canInstall(state) || installing) return snapshot()
    installing = true
    try {
      await prepareInstall()
      autoUpdater.quitAndInstall(true, true)
    } catch (error) {
      installing = false
      apply({ type: "error", message: error?.message ?? String(error) })
    }
    return snapshot()
  }

  function start() {
    setTimeout(() => void check(), STARTUP_CHECK_DELAY_MS).unref()
    setInterval(() => void check(), POLL_INTERVAL_MS).unref()
  }

  return { getState: snapshot, check, download, install, start }
}
