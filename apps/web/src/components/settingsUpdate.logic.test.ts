import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { DesktopUpdateState } from "@hangar/contracts"
import {
  describeCheckResult,
  resolveSidebarUpdate,
  resolveUpdateAction,
  updateStatusLine,
} from "./settingsUpdate.logic.ts"

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

describe("resolveSidebarUpdate", () => {
  it("stays hidden when a click would have nothing to do", () => {
    assert.equal(resolveSidebarUpdate(null), null)
    assert.equal(resolveSidebarUpdate(state({})), null)
    assert.equal(resolveSidebarUpdate(state({ status: "checking" })), null)
    assert.equal(resolveSidebarUpdate(state({ status: "disabled" })), null)
    assert.equal(resolveSidebarUpdate(state({ status: "error", message: "feed unreachable" })), null)
  })

  it("names the version in the icon's accessible label at each stage", () => {
    assert.deepEqual(resolveSidebarUpdate(state({ status: "available", availableVersion: "0.3.0" })), {
      kind: "download",
      percent: null,
      label: "Download version 0.3.0",
    })
    assert.deepEqual(resolveSidebarUpdate(state({ status: "downloaded", downloadedVersion: "0.3.0" })), {
      kind: "install",
      percent: null,
      label: "Restart to install version 0.3.0",
    })
    assert.equal(
      resolveSidebarUpdate(state({ status: "error", availableVersion: "0.3.0", message: "network gone" }))?.label,
      "Retry downloading version 0.3.0",
    )
    assert.equal(resolveSidebarUpdate(state({ status: "available" }))?.label, "Download the update")
  })

  it("carries the percentage while downloading, in the label as well as the ring", () => {
    const half = resolveSidebarUpdate(state({ status: "downloading", availableVersion: "0.3.0", downloadPercent: 42 }))
    assert.deepEqual(half, { kind: "download", percent: 42, label: "Downloading version 0.3.0… 42%" })
  })

  it("clamps a missing or out-of-range percentage rather than drawing past the ring", () => {
    assert.equal(resolveSidebarUpdate(state({ status: "downloading" }))?.percent, 0)
    assert.equal(resolveSidebarUpdate(state({ status: "downloading", downloadPercent: 100.4 }))?.percent, 100)
    assert.equal(resolveSidebarUpdate(state({ status: "downloading", downloadPercent: 133 }))?.percent, 100)
    assert.equal(resolveSidebarUpdate(state({ status: "downloading", downloadPercent: -1 }))?.percent, 0)
    assert.equal(resolveSidebarUpdate(state({ status: "downloading", downloadPercent: Number.NaN }))?.percent, 0)
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

describe("describeCheckResult", () => {
  it("answers the boring outcome out loud, since nothing else would", () => {
    const result = describeCheckResult(state({ currentVersion: "0.7.0" }))
    assert.equal(result.title, "You are up to date")
    assert.match(result.body, /Hangar 0\.7\.0 is the latest version/)
  })

  it("names the version for every outcome that has one", () => {
    assert.match(describeCheckResult(state({ status: "available", availableVersion: "0.8.0" })).body, /0\.8\.0/)
    assert.match(describeCheckResult(state({ status: "downloaded", downloadedVersion: "0.8.0" })).body, /0\.8\.0/)
    assert.match(
      describeCheckResult(state({ status: "downloading", availableVersion: "0.8.0", downloadPercent: 42 })).body,
      /0\.8\.0.*42%/,
    )
  })

  it("explains a disabled build or a failure instead of claiming to be current", () => {
    const disabled = describeCheckResult(state({ status: "disabled", message: "no update feed" }))
    assert.equal(disabled.title, "Updates are unavailable")
    assert.equal(disabled.body, "no update feed")
    assert.equal(describeCheckResult(state({ status: "error", message: "offline" })).body, "offline")
    assert.match(describeCheckResult(state({ status: "error" })).body, /could not reach/)
  })
})
