import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { processActions, resolveProcessAction } from "./processActions.logic.ts"

describe("processActions", () => {
  it("offers only a start for an idle process", () => {
    assert.deepEqual(processActions(false), ["start"])
  })

  it("offers restart and stop for a running one, and never start", () => {
    assert.deepEqual(processActions(true), ["restart", "stop"])
  })

  it("ranks restart ahead of stop, so a tie lands on the safe action", () => {
    const running = processActions(true)
    assert.ok(running.indexOf("restart") < running.indexOf("stop"))
  })
})

describe("resolveProcessAction", () => {
  it("acts when the process is still in the state the entry was rendered from", () => {
    assert.equal(resolveProcessAction("start", false), "start")
    assert.equal(resolveProcessAction("stop", true), "stop")
  })

  it("drops out when the outcome already happened", () => {
    assert.equal(resolveProcessAction("start", true), null)
    assert.equal(resolveProcessAction("stop", false), null)
  })

  it("keeps restart valid in either state", () => {
    assert.equal(resolveProcessAction("restart", true), "restart")
    assert.equal(resolveProcessAction("restart", false), "restart")
  })
})
