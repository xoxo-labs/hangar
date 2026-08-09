import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canCheck, canDownload, canInstall, initialUpdateState, reduceUpdateEvent } from "./updateReducer.mjs"

const reduceAll = (state, events) => events.reduce(reduceUpdateEvent, state)

describe("reduceUpdateEvent", () => {
  it("walks the happy path: check → available → download → downloaded", () => {
    let state = initialUpdateState("0.2.0")
    assert.equal(state.status, "idle")

    state = reduceUpdateEvent(state, { type: "checking" })
    assert.equal(state.status, "checking")

    state = reduceUpdateEvent(state, { type: "available", version: "0.3.0" })
    assert.deepEqual([state.status, state.availableVersion], ["available", "0.3.0"])

    state = reduceUpdateEvent(state, { type: "download-progress", percent: 42 })
    assert.deepEqual([state.status, state.downloadPercent], ["downloading", 42])

    state = reduceUpdateEvent(state, { type: "downloaded", version: "0.3.0" })
    assert.deepEqual([state.status, state.downloadedVersion, state.downloadPercent], ["downloaded", "0.3.0", null])
    assert.equal(state.currentVersion, "0.2.0")
  })

  it("resets to idle when no update is available", () => {
    const state = reduceAll(initialUpdateState("0.2.0"), [
      { type: "available", version: "0.3.0" },
      { type: "not-available" },
    ])
    assert.deepEqual([state.status, state.availableVersion, state.downloadPercent], ["idle", null, null])
  })

  it("keeps availableVersion through a failed download so the UI can retry", () => {
    const state = reduceAll(initialUpdateState("0.2.0"), [
      { type: "available", version: "0.3.0" },
      { type: "download-progress", percent: 10 },
      { type: "error", message: "network gone" },
    ])
    assert.deepEqual([state.status, state.message, state.downloadPercent], ["error", "network gone", null])
    assert.equal(state.availableVersion, "0.3.0")
  })

  it("clears a stale error message on the next transition", () => {
    const state = reduceAll(initialUpdateState("0.2.0"), [{ type: "error", message: "boom" }, { type: "checking" }])
    assert.deepEqual([state.status, state.message], ["checking", null])
  })

  it("returns the same reference for unknown events", () => {
    const state = initialUpdateState("0.2.0")
    assert.equal(reduceUpdateEvent(state, { type: "nonsense" }), state)
  })
})

describe("action guards", () => {
  it("blocks checks that would clobber an active or staged download", () => {
    const idle = initialUpdateState("0.2.0")
    assert.equal(canCheck(idle), true)
    assert.equal(canCheck(reduceUpdateEvent(idle, { type: "checking" })), false)
    assert.equal(canCheck(reduceUpdateEvent(idle, { type: "download-progress", percent: 1 })), false)
    assert.equal(canCheck(reduceUpdateEvent(idle, { type: "downloaded", version: "0.3.0" })), false)
    assert.equal(canCheck(reduceUpdateEvent(idle, { type: "error", message: "x" })), true)
  })

  it("allows download only when a version is on offer", () => {
    const idle = initialUpdateState("0.2.0")
    assert.equal(canDownload(idle), false)
    const available = reduceUpdateEvent(idle, { type: "available", version: "0.3.0" })
    assert.equal(canDownload(available), true)
    // Failed download keeps the offer; a bare error does not.
    assert.equal(canDownload(reduceUpdateEvent(available, { type: "error", message: "x" })), true)
    assert.equal(canDownload(reduceUpdateEvent(idle, { type: "error", message: "x" })), false)
  })

  it("allows install only with a staged download, including after a failed install", () => {
    const idle = initialUpdateState("0.2.0")
    assert.equal(canInstall(idle), false)
    const downloaded = reduceUpdateEvent(idle, { type: "downloaded", version: "0.3.0" })
    assert.equal(canInstall(downloaded), true)
    assert.equal(canInstall(reduceUpdateEvent(downloaded, { type: "error", message: "x" })), true)
  })
})
