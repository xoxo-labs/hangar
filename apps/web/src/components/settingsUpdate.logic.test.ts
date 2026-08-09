import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { DesktopUpdateState } from "@hangar/contracts"
import { resolveUpdateAction, updateStatusLine } from "./settingsUpdate.logic.ts"

const state = (overrides: Partial<DesktopUpdateState>): DesktopUpdateState => ({
  status: "idle",
  currentVersion: "0.2.0",
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  message: null,
  ...overrides,
})

describe("resolveUpdateAction", () => {
  it("offers a check when idle and nothing while busy or disabled", () => {
    assert.equal(resolveUpdateAction(state({}))?.kind, "check")
    assert.equal(resolveUpdateAction(state({ status: "checking" })), null)
    assert.equal(resolveUpdateAction(state({ status: "downloading", downloadPercent: 3 })), null)
    assert.equal(resolveUpdateAction(state({ status: "disabled" })), null)
  })

  it("walks download → install as the update progresses", () => {
    assert.equal(resolveUpdateAction(state({ status: "available", availableVersion: "0.3.0" }))?.kind, "download")
    assert.equal(resolveUpdateAction(state({ status: "downloaded", downloadedVersion: "0.3.0" }))?.kind, "install")
  })

  it("matches the retry to what actually failed", () => {
    const failedDownload = state({ status: "error", availableVersion: "0.3.0", message: "network gone" })
    assert.deepEqual(resolveUpdateAction(failedDownload), { label: "Retry download", kind: "download" })

    const failedInstall = state({
      status: "error",
      availableVersion: "0.3.0",
      downloadedVersion: "0.3.0",
      message: "install failed",
    })
    assert.equal(resolveUpdateAction(failedInstall)?.kind, "install")

    const bareError = state({ status: "error", message: "feed unreachable" })
    assert.equal(resolveUpdateAction(bareError)?.kind, "check")
  })
})

describe("updateStatusLine", () => {
  it("names the version at each stage", () => {
    assert.equal(
      updateStatusLine(state({ status: "available", availableVersion: "0.3.0" })),
      "Version 0.3.0 is available.",
    )
    assert.equal(
      updateStatusLine(state({ status: "downloading", availableVersion: "0.3.0", downloadPercent: 42 })),
      "Downloading 0.3.0… 42%",
    )
    assert.equal(
      updateStatusLine(state({ status: "downloaded", downloadedVersion: "0.3.0" })),
      "Version 0.3.0 is ready to install.",
    )
  })

  it("surfaces the error message, with a fallback", () => {
    assert.equal(updateStatusLine(state({ status: "error", message: "network gone" })), "network gone")
    assert.equal(updateStatusLine(state({ status: "error" })), "Update failed.")
    assert.equal(updateStatusLine(state({})), "Hangar is up to date.")
  })
})
