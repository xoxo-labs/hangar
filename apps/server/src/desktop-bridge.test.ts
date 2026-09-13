import assert from "node:assert/strict"
import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import type { DesktopUpdateState, ServerMsg } from "@hangar/contracts"

/*
 * Plays the desktop app: spawns a real server over an IPC channel the way
 * Electron does, hands it an updater state, and checks that a WebSocket client
 * sees it — and that the client's update request comes back up the channel.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), "cli.ts")

const available: DesktopUpdateState = {
  status: "available",
  currentVersion: "0.13.0",
  availableVersion: "0.14.0",
  downloadedVersion: null,
  downloadPercent: null,
  message: null,
}

function nextMessage(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (raw: unknown): void => {
      const msg = raw as Record<string, unknown>
      if (msg?.type !== type) return
      child.off("message", listener)
      resolve(msg)
    }
    child.on("message", listener)
  })
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("server never became healthy")
}

function firstState(port: number): Promise<{ socket: WebSocket; state: ServerMsg & { type: "state" } }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    socket.onerror = () => reject(new Error("websocket failed"))
    socket.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMsg
      if (msg.type === "state") resolve({ socket, state: msg })
    }
  })
}

test("the server relays the desktop updater to clients and their requests back up", async () => {
  const home = mkdtempSync(join(tmpdir(), "hangar-bridge-"))
  const port = 47000 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, [CLI, "serve", "--port", String(port)], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, HANGAR_HOME: home },
  })
  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  try {
    // The server asks for a snapshot as soon as it can hear one.
    await nextMessage(child, "hello")
    child.send({ type: "desktopUpdateState", state: available })
    await waitForHealth(port)

    const { socket, state } = await firstState(port)
    assert.equal(typeof state.version, "string")
    assert.deepEqual(state.desktopUpdate, available)

    // A client's request comes back to the app untouched.
    const request = nextMessage(child, "desktopUpdate")
    socket.send(JSON.stringify({ type: "desktopUpdate", action: "download" }))
    assert.equal((await request).action, "download")

    // And a new state from the app reaches the client without asking.
    const downloading = { ...available, status: "downloading" as const, downloadPercent: 42 }
    const pushed = new Promise<ServerMsg>((resolve) => {
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as ServerMsg
        if (msg.type === "state" && msg.desktopUpdate?.status === "downloading") resolve(msg)
      }
    })
    child.send({ type: "desktopUpdateState", state: downloading })
    const next = (await pushed) as ServerMsg & { type: "state" }
    assert.equal(next.desktopUpdate?.downloadPercent, 42)
    socket.close()
  } catch (error) {
    throw new Error(`${String(error)}\nserver stderr:\n${stderr}`)
  } finally {
    child.kill("SIGTERM")
    await new Promise((resolve) => child.once("exit", resolve))
    rmSync(home, { recursive: true, force: true })
  }
})
