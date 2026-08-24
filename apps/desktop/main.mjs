// hangar desktop — a deliberately thin dev shell.
//
// It does two things:
//   1. makes sure the hangar server is running (spawning it only if it isn't),
//   2. shows the web UI in a window.
//
// In development it uses the source server and Vite. In a packaged build it
// uses the bundled server and static renderer shipped inside the application.

import { spawn } from "node:child_process"
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron"

// When launched under a supervisor (concurrently, a dead terminal), stdout and
// stderr can vanish before we do; an unguarded console.* then throws EPIPE and
// takes the whole main process down with the crash dialog.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => {})
}

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = app.isPackaged ? resolve(HERE, "dist/server/cli.mjs") : resolve(HERE, "../server/src/cli.ts")
const WEB_ENTRY = resolve(HERE, "dist/web/index.html")
const PRELOAD_ENTRY = resolve(HERE, "preload.cjs")
const RELEASE_NOTES_ENTRY = resolve(HERE, "RELEASE_NOTES.md")

// Keep Electron's cache, cookies, and singleton state separate from the stable
// app so a packaged Hangar can safely launch and supervise Hangar development.
if (!app.isPackaged) {
  app.setPath("userData", join(process.env.HANGAR_HOME ?? join(homedir(), ".hangar-dev"), "desktop"))
}

const PORT = Number(process.env.HANGAR_PORT ?? 4780)
const WEB_URL = process.env.HANGAR_WEB_URL ?? "http://localhost:4790"

const HEALTH_URL = `http://127.0.0.1:${PORT}/health`
const HEALTH_PROBE_TIMEOUT_MS = 500
const HEALTH_POLL_INTERVAL_MS = 250
const HEALTH_POLL_TIMEOUT_MS = 10_000
const LOAD_RETRY_INTERVAL_MS = 1_000
const LOAD_RETRY_TIMEOUT_MS = 30_000

/** The server process we started, if we started one. Null means "not ours". */
let serverChild = null
let mainWindow = null
let releaseNotesWindow = null
let shortcutsWindow = null

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Resolves true if the server answers /health, false on any failure. */
async function probeHealth() {
  try {
    const response = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      cache: "no-store",
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Where the server should write the entity snapshots the App Intents
 * extension reads: the location comes from store-contract.json, generated
 * next to the Swift surface and shipped in Resources, so the App Group
 * container is named in exactly one place.
 *
 * Gated on the extension actually being in this bundle. Embedding it is
 * opt-in (see scripts/embed-appintents.mjs), and redirecting the store into
 * a group container nothing reads would only move the snapshots out of reach
 * and create a container this app has no business owning.
 */
function appIntentsEnv() {
  if (process.platform !== "darwin") return {}
  if (!existsSync(join(dirname(process.resourcesPath), "Extensions", "HangarIntents.appex"))) return {}
  try {
    const contract = JSON.parse(readFileSync(join(process.resourcesPath, "store-contract.json"), "utf8"))
    const path = contract.storage?.macOSPath
    if (typeof path !== "string") return {}
    return { HANGAR_APPINTENTS_DIR: expandHome(path) }
  } catch (error) {
    // A build without the contract still runs; only Spotlight goes stale.
    console.error(`[hangar] no App Intents store contract: ${error.message}`)
    return {}
  }
}

/**
 * Spawns the server in its own process group so we can take down the whole
 * tree later — the server starts child processes of its own.
 */
function spawnServer() {
  // Development sources require system Node 24. Packaged builds use Electron's
  // bundled Node runtime and the precompiled server, so the .app is standalone.
  const executable = app.isPackaged ? process.execPath : "node"
  const env = app.isPackaged ? { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...appIntentsEnv() } : process.env
  const child = spawn(executable, [SERVER_ENTRY, "serve", "--port", String(PORT)], {
    stdio: "inherit",
    detached: true,
    env,
  })

  child.on("error", (error) => {
    console.error(`[hangar] failed to spawn server: ${error.message}`)
    if (serverChild === child) serverChild = null
  })

  child.on("exit", (code, signal) => {
    if (serverChild === child) serverChild = null
    if (!app.isQuitting) {
      console.error(`[hangar] server exited (code ${code}, signal ${signal})`)
    }
  })

  return child
}

/** Kills the server we spawned, process group first, child as a fallback. */
function stopServer() {
  const child = serverChild
  if (!child) return
  serverChild = null

  try {
    // Negative pid targets the process group created by `detached: true`.
    process.kill(-child.pid, "SIGTERM")
  } catch {
    try {
      child.kill("SIGTERM")
    } catch {
      /* already gone */
    }
  }
}

/** Waits for /health, polling. Resolves true if it came up in time. */
async function waitForHealth() {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probeHealth()) return true
    await sleep(HEALTH_POLL_INTERVAL_MS)
  }
  return probeHealth()
}

/**
 * Ensures a server is listening on PORT. Returns nothing; whether we own the
 * process is recorded in `serverChild`.
 */
async function ensureServer() {
  if (await probeHealth()) {
    console.log(`[hangar] server already running on :${PORT}`)
    return
  }

  // Under `pnpm dev` the server is owned by concurrently and just hasn't bound
  // yet — spawning our own here would race it for the port. Wait instead.
  if (process.env.HANGAR_NO_SPAWN) {
    console.log(`[hangar] waiting for external server on :${PORT}`)
    if (!(await waitForHealth())) {
      console.error(`[hangar] no server appeared on :${PORT} — opening the window anyway`)
    }
    return
  }

  console.log(`[hangar] starting server on :${PORT}`)
  serverChild = spawnServer()

  if (!(await waitForHealth())) {
    console.error(
      `[hangar] server did not become healthy within ${HEALTH_POLL_TIMEOUT_MS / 1000}s — opening the window anyway`,
    )
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function writableCliDirectory() {
  for (const directory of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    try {
      accessSync(directory, constants.W_OK)
      return directory
    } catch {
      // Fall back to a user-owned directory below.
    }
  }
  const directory = join(homedir(), ".local", "bin")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}

/**
 * Dialogs anchored to the main window while it is alive, standalone otherwise:
 * the app can outlive its main window (a help window keeps it running), and a
 * destroyed parent throws.
 */
function messageBox(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

async function installCommandLineTool() {
  if (!app.isPackaged) {
    await messageBox({
      type: "info",
      message: "The packaged app installs the command-line tool",
      detail: "For this source checkout, run: cd apps/server && pnpm link --global",
    })
    return
  }

  const directory = writableCliDirectory()
  const destination = join(directory, "hangar")
  if (existsSync(destination)) {
    const answer = await messageBox({
      type: "warning",
      message: `Replace the existing ${destination}?`,
      detail: "Hangar will replace it with a launcher for this installed application.",
      buttons: ["Cancel", "Replace"],
      defaultId: 1,
      cancelId: 0,
    })
    if (answer.response !== 1) return
  }

  // Baked in, not inherited: a server started from a terminal has to write
  // the Spotlight snapshots where this app's extension reads them, or the
  // store location would depend on who happened to start the server.
  const { HANGAR_APPINTENTS_DIR } = appIntentsEnv()
  const storeEnv = HANGAR_APPINTENTS_DIR ? `HANGAR_APPINTENTS_DIR=${shellQuote(HANGAR_APPINTENTS_DIR)} ` : ""
  const launcher = `#!/bin/sh\n${storeEnv}ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(process.execPath)} ${shellQuote(SERVER_ENTRY)} "$@"\n`
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, launcher, { mode: 0o755 })
    chmodSync(temporary, 0o755)
    renameSync(temporary, destination)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {}
    await messageBox({
      type: "error",
      message: "Could not install the command-line tool",
      detail: error instanceof Error ? error.message : String(error),
    })
    return
  }

  const onPath = (process.env.PATH ?? "").split(":").includes(directory)
  await messageBox({
    type: "info",
    message: `Installed ${destination}`,
    detail: onPath
      ? "Open a new terminal and run: hangar help"
      : `Add this directory to PATH, then open a new terminal:\n\nexport PATH=${shellQuote(directory)}:$PATH`,
  })
}

/**
 * Resolved at click time, never captured: the menu is a process-global
 * singleton that outlives any window, and the app itself survives the main
 * window closing while a help or release-notes window is up. Sending into a
 * captured, destroyed window throws out of the menu handler.
 */
function sendToMainWindow(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel)
}

function installApplicationMenu() {
  if (process.platform !== "darwin") return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          {
            // The renderer runs the check and reports it: an explicit check
            // that finds nothing must still say so, and the sidebar control
            // only exists when there is something to act on.
            label: "Check for Updates…",
            click: () => sendToMainWindow("hangar:check-updates"),
          },
          { type: "separator" },
          {
            label: "Settings…",
            accelerator: "CommandOrControl+,",
            click: () => sendToMainWindow("hangar:open-settings"),
          },
          {
            label: "Install Command Line Tool…",
            click: () => void installCommandLineTool(),
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            // A dialog in the main window, unlike its two neighbours here,
            // which open windows of their own.
            label: "Tutorial",
            click: () => sendToMainWindow("hangar:open-tutorial"),
          },
          {
            label: "Hangar Help & Shortcuts",
            click: openShortcutsWindow,
          },
          {
            label: "Release Notes",
            click: openReleaseNotesWindow,
          },
        ],
      },
    ]),
  )
}

/**
 * Defense in depth: the renderer already routes external links itself, but a
 * missed target=_blank would otherwise become an untracked BrowserWindow that
 * nobody closes — and that keeps window-all-closed from ever firing.
 */
function denyPopups(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
}

function openShortcutsWindow() {
  if (shortcutsWindow && !shortcutsWindow.isDestroyed()) {
    if (shortcutsWindow.isMinimized()) shortcutsWindow.restore()
    shortcutsWindow.show()
    shortcutsWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 520,
    height: 590,
    minWidth: 420,
    minHeight: 420,
    title: "Hangar Help & Keyboard Shortcuts",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121113" : "#fdfcfd",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_ENTRY,
    },
  })

  denyPopups(window)
  shortcutsWindow = window
  window.on("closed", () => {
    if (shortcutsWindow === window) shortcutsWindow = null
  })

  const navigation = app.isPackaged
    ? window.loadFile(WEB_ENTRY, { query: { window: "shortcuts" } })
    : window.loadURL(`${WEB_URL}?window=shortcuts`)
  navigation.catch((error) => console.error(`[hangar] failed to open shortcuts: ${error.message}`))
}

function openReleaseNotesWindow() {
  if (releaseNotesWindow && !releaseNotesWindow.isDestroyed()) {
    if (releaseNotesWindow.isMinimized()) releaseNotesWindow.restore()
    releaseNotesWindow.show()
    releaseNotesWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 760,
    height: 700,
    minWidth: 520,
    minHeight: 420,
    title: "Hangar Release Notes",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121113" : "#fdfcfd",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_ENTRY,
    },
  })

  denyPopups(window)
  releaseNotesWindow = window
  window.on("closed", () => {
    if (releaseNotesWindow === window) releaseNotesWindow = null
  })

  const navigation = app.isPackaged
    ? window.loadFile(WEB_ENTRY, { query: { window: "release-notes" } })
    : window.loadURL(`${WEB_URL}?window=release-notes`)
  navigation.catch((error) => console.error(`[hangar] failed to open release notes: ${error.message}`))
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // First-paint backdrop before the renderer settles its own theme; the two
    // values mirror --color-surface-1 (Radix mauve step 1) per scheme.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121113" : "#fdfcfd",
    titleBarStyle: "hiddenInset",
    // Centers the lights on the 48px title strip shared by sidebar and tabs.
    trafficLightPosition: { x: 18, y: 18 },
    // Held back until the renderer's first paint (ready-to-show below), so a
    // cold start never flashes seconds of empty window while React boots.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_ENTRY,
    },
  })

  const showWindow = () => {
    if (!window.isDestroyed() && !window.isVisible()) window.show()
  }
  window.once("ready-to-show", showWindow)
  // In dev a failed load never fires ready-to-show while Vite boots; without a
  // deadline the app would look like it never launched.
  const showDeadline = setTimeout(showWindow, 4_000)

  denyPopups(window)

  // In dev the Vite server may still be booting. Keep retrying until it is up.
  const giveUpAt = Date.now() + LOAD_RETRY_TIMEOUT_MS
  let retryTimer = null

  // A single failed navigation can emit several did-fail-load events, so one
  // pending retry at a time — otherwise the timers multiply on every round.
  const load = () => {
    retryTimer = null
    if (window.isDestroyed()) return
    // Rejection is expected while the dev server is down; did-fail-load drives
    // the retry, so swallow it rather than leaking an unhandled rejection.
    const navigation = app.isPackaged ? window.loadFile(WEB_ENTRY) : window.loadURL(WEB_URL)
    navigation.catch(() => {})
  }

  const scheduleRetry = (errorDescription) => {
    if (retryTimer !== null) return
    if (Date.now() >= giveUpAt) {
      console.error(`[hangar] gave up loading ${WEB_URL}: ${errorDescription}`)
      return
    }
    const target = app.isPackaged ? WEB_ENTRY : WEB_URL
    console.error(`[hangar] ${target} not ready (${errorDescription}) — retrying`)
    retryTimer = setTimeout(load, LOAD_RETRY_INTERVAL_MS)
  }

  // A link that arrived while this window was still loading (or sitting on the
  // dev retry's error page) waits in the queue; the renderer usually claims it
  // on mount, and this covers the reload case where nothing new mounts.
  window.webContents.on("did-finish-load", () => flushDeepLink(window))

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    if (errorCode === -3) return // ERR_ABORTED — a navigation we replaced
    if (window.isDestroyed()) return
    scheduleRetry(errorDescription)
  })

  load()
  mainWindow = window
  window.on("closed", () => {
    clearTimeout(showDeadline)
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    if (mainWindow === window) mainWindow = null
  })
  return window
}

// If the development supervisor dies, we get reparented to launchd and would
// linger as a headless orphan. A packaged app is normally owned by launchd, so
// this guard must only run in development.
if (!app.isPackaged) {
  setInterval(() => {
    if (process.ppid === 1) app.quit()
  }, 2000).unref()
}

/** Read once: three windows each ask on mount, and the file lives in the asar. */
let releaseNotesCache = null
ipcMain.handle("hangar:app-info", () => {
  releaseNotesCache ??= readFileSync(RELEASE_NOTES_ENTRY, "utf8")
  return { version: app.getVersion(), releaseNotes: releaseNotesCache }
})
ipcMain.handle("hangar:open-release-notes", openReleaseNotesWindow)
ipcMain.handle("hangar:open-shortcuts", openShortcutsWindow)

ipcMain.handle("hangar:choose-directory", async (_event, requestedTitle) => {
  const options = {
    title: typeof requestedTitle === "string" ? requestedTitle : "Choose a folder",
    properties: ["openDirectory"],
  }
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

function expandHome(path) {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

const BROWSER_APPS = {
  safari: "Safari",
  chrome: "Google Chrome",
  arc: "Arc",
  firefox: "Firefox",
  brave: "Brave Browser",
  edge: "Microsoft Edge",
}

ipcMain.handle("hangar:open-url", async (_event, rawUrl, browser) => {
  if (typeof rawUrl !== "string") return "Invalid URL"
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return "Invalid URL"
  }
  // Paired machines expose their detected ports on their own host, so any http(s) URL is allowed.
  if (!["http:", "https:"].includes(url.protocol)) {
    return "Only HTTP links are allowed"
  }
  const appName = BROWSER_APPS[browser]
  if (process.platform === "darwin" && appName) {
    // A ChildProcess 'error' with no listener is an uncaught exception in the
    // main process; a sandbox or odd system that lacks /usr/bin/open falls
    // back to the default browser instead.
    const child = spawn("/usr/bin/open", ["-a", appName, url.href], { detached: true, stdio: "ignore" })
    const launched = await new Promise((resolve) => {
      child.once("spawn", () => resolve(true))
      child.once("error", () => resolve(false))
    })
    if (launched) {
      child.unref()
      return ""
    }
  }
  await shell.openExternal(url.href)
  return ""
})

ipcMain.handle("hangar:open-path", async (_event, path) => {
  if (typeof path !== "string" || path.trim() === "") return "Invalid path"
  return shell.openPath(expandHome(path))
})

ipcMain.handle("hangar:reveal-path", (_event, path) => {
  if (typeof path === "string" && path.trim() !== "") shell.showItemInFolder(expandHome(path))
})

// --- deep links --------------------------------------------------------------
// `hangar://project/<name>` and `hangar://process/<project>/<process>`, opened by
// the App Intents surface (Spotlight, Siri, Shortcuts). Both ids are raw registry
// values sitting in a URL path, so they arrive percent-encoded; the renderer
// decodes them and resolves them against the registry it already has.
//
// There is deliberately no single-instance lock. On macOS LaunchServices hands a
// URL to the copy that is already running — as open-url, never as argv — so a
// lock would buy nothing here, while the two Hangars this project runs on purpose
// (a packaged one supervising a dev one, hence the userData split above) are
// exactly what a lock is one HANGAR_HOME change away from breaking. second-instance
// only ever fires for a lock holder, so there is nothing to listen for until
// Hangar ships somewhere URLs arrive in argv.

/** A link that arrived before a renderer could take it; claimed on mount. */
let pendingDeepLink = null

/** Focuses the window and hands the link over, or queues it for the renderer. */
function deliverDeepLink(url) {
  if (typeof url !== "string" || !url.startsWith("hangar://")) return
  pendingDeepLink = url

  const window = mainWindow
  // No window yet means the link launched us and whenReady is still on its way
  // (closing the last window quits). The renderer it creates will claim the link.
  if (!window || window.isDestroyed()) return

  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  // Spotlight can open a link while Hangar is hidden or buried behind another
  // app; the user just asked for this window, so take the front.
  app.focus({ steal: true })

  flushDeepLink(window)
}

/**
 * Hands a queued link to a renderer that can receive it, and only then drops
 * it. `isLoading()` alone would also be false for the dev-server retry loop's
 * error page, which has no preload bridge — a link sent there is lost, and
 * the renderer that eventually loads has nothing left to claim.
 */
function flushDeepLink(window) {
  if (pendingDeepLink === null) return
  if (window.isDestroyed() || window.webContents.isLoading()) return
  if (window.webContents.getURL() === "") return
  window.webContents.send("hangar:deep-link", pendingDeepLink)
  pendingDeepLink = null
}

// The bundle declares the scheme (electron-builder `protocols`); this claims the
// handler when several copies are installed. Development runs Electron's own
// bundle, which declares nothing, so the call could only fail there.
if (app.isPackaged) app.setAsDefaultProtocolClient("hangar")

// Subscribed at load rather than on ready: a cold start delivers the URL that
// launched us well before the app is ready, let alone the window.
app.on("open-url", (event, url) => {
  event.preventDefault()
  deliverDeepLink(url)
})

/** The renderer claims the queued link as it mounts, so a cold start never drops one. */
ipcMain.handle("hangar:take-deep-link", () => {
  const url = pendingDeepLink
  pendingDeepLink = null
  return url
})

// --- auto-updates ------------------------------------------------------------
// The real machinery lives in updater.mjs (bundled to dist/updater.cjs with
// electron-updater inside). It only loads in packaged builds with a feed, so
// development never touches electron-updater and the renderer still gets an
// honest "disabled" state everywhere else.

// Local testing: point the updater at scripts/mock-update-server.mjs instead
// of the embedded GitHub feed. Works in dev too, though only a packaged build
// can complete the install step.
const MOCK_UPDATE_URL = process.env.HANGAR_MOCK_UPDATE_URL ?? null

function updatesDisabledReason() {
  if (process.env.HANGAR_DISABLE_AUTO_UPDATE) return "Automatic updates are disabled by HANGAR_DISABLE_AUTO_UPDATE."
  if (MOCK_UPDATE_URL !== null) return null
  if (!app.isPackaged) return "Automatic updates are only available in packaged builds."
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) return "This build has no update feed configured."
  return null
}

/** Null until startUpdater() succeeds; every IPC handler falls back to "disabled". */
let updater = null

function disabledUpdateState() {
  return {
    status: "disabled",
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    message: updatesDisabledReason(),
  }
}

ipcMain.handle("hangar:update-state", () => (updater ? updater.getState() : disabledUpdateState()))
ipcMain.handle("hangar:update-check", () => (updater ? updater.check() : disabledUpdateState()))
ipcMain.handle("hangar:update-download", () => (updater ? updater.download() : disabledUpdateState()))
ipcMain.handle("hangar:update-install", () => (updater ? updater.install() : disabledUpdateState()))

async function startUpdater() {
  if (updatesDisabledReason() !== null) return
  try {
    // Packaged builds use the esbuild bundle; dev (only reachable in mock
    // mode) imports the source, resolving electron-updater from node_modules.
    const entry = app.isPackaged ? resolve(HERE, "dist/updater.cjs") : resolve(HERE, "updater.mjs")
    const { createUpdater } = await import(pathToFileURL(entry).href)
    updater = createUpdater({
      currentVersion: app.getVersion(),
      mockFeedUrl: MOCK_UPDATE_URL,
      broadcast: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("hangar:update-state", state)
      },
      // quitAndInstall's app.quit() would hard-kill the server child before the
      // will-quit handler runs; stop it here so it gets SIGTERM and grace.
      prepareInstall: () => {
        app.isQuitting = true
        stopServer()
      },
    })
    updater.start()
  } catch (error) {
    console.error(`[hangar] updater unavailable: ${error.message}`)
  }
}

app
  .whenReady()
  .then(async () => {
    // A packaged build takes its icon from the bundle. Development runs Electron's
    // own binary, which shows Electron's own icon until it is told otherwise.
    if (!app.isPackaged && process.platform === "darwin") {
      try {
        app.dock?.setIcon(resolve(HERE, "assets/icon.png"))
      } catch {
        // A missing dev icon must not stop the window or the server below.
      }
    }

    // Window first, server in parallel: the renderer is a local file and paints
    // fast, then its own "connecting…" state honestly covers the server boot.
    // Blocking the window on /health meant seconds of nothing on cold start.
    createWindow()
    installApplicationMenu()
    void startUpdater()
    await ensureServer()
  })
  .catch((error) => console.error("[hangar] startup failed:", error))

// Not gated on window count: a help or release-notes window keeps the app
// alive after the main window closes, and a dock click must still bring the
// main window back rather than dead-end.
app.on("activate", () => {
  if (app.isReady() && (!mainWindow || mainWindow.isDestroyed())) createWindow()
})

// This is a launcher, not a document app — closing the window means done,
// on macOS too.
app.on("window-all-closed", () => {
  app.quit()
})

app.on("before-quit", () => {
  app.isQuitting = true
})

// Only tear down a server we own. One that was already running outlives us.
app.on("will-quit", () => {
  stopServer()
})
