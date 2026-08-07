// hangar desktop — a deliberately thin dev shell.
//
// It does two things:
//   1. makes sure the hangar server is running (spawning it only if it isn't),
//   2. shows the web UI in a window.
//
// No preload, no IPC, no packaging. The renderer talks to the server directly
// over HTTP, exactly as it does in a browser.

import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow } from "electron"

// When launched under a supervisor (concurrently, a dead terminal), stdout and
// stderr can vanish before we do; an unguarded console.* then throws EPIPE and
// takes the whole main process down with the crash dialog.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => {})
}

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = resolve(HERE, "../server/src/cli.ts")

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
 * Spawns the server in its own process group so we can take down the whole
 * tree later — the server starts child processes of its own.
 */
function spawnServer() {
  // The system `node` from PATH, deliberately: Electron's bundled Node cannot
  // run TypeScript, and the server entry is a .ts file.
  const child = spawn("node", [SERVER_ENTRY, "serve", "--port", String(PORT)], {
    stdio: "inherit",
    detached: true,
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
      `[hangar] server did not become healthy within ${
        HEALTH_POLL_TIMEOUT_MS / 1000
      }s — opening the window anyway`,
    )
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#111213",
    titleBarStyle: "hiddenInset",
    // Centers the lights on the 44px brand strip the web UI reserves.
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

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
    window.loadURL(WEB_URL).catch(() => {})
  }

  const scheduleRetry = (errorDescription) => {
    if (retryTimer !== null) return
    if (Date.now() >= giveUpAt) {
      console.error(`[hangar] gave up loading ${WEB_URL}: ${errorDescription}`)
      return
    }
    console.error(
      `[hangar] ${WEB_URL} not ready (${errorDescription}) — retrying`,
    )
    retryTimer = setTimeout(load, LOAD_RETRY_INTERVAL_MS)
  }

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      if (errorCode === -3) return // ERR_ABORTED — a navigation we replaced
      if (window.isDestroyed()) return
      scheduleRetry(errorDescription)
    },
  )

  load()
  mainWindow = window
  window.on("closed", () => {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    if (mainWindow === window) mainWindow = null
  })
  return window
}

// If the supervisor that launched us (concurrently, a terminal) dies, we get
// reparented to launchd and would linger as a headless orphan — bail instead.
setInterval(() => {
  if (process.ppid === 1) app.quit()
}, 2000).unref()

app.whenReady().then(async () => {
  await ensureServer()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
