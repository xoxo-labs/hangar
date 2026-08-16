import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { openUrl, shareUrl } from "./links.ts"

const NONE = { lan: [], tailscale: [] }
const BOTH = { lan: ["192.168.1.20"], tailscale: ["100.64.0.5"] }

describe("shareUrl", () => {
  it("prefers tailscale over lan on auto, and honours an explicit choice", () => {
    assert.equal(shareUrl(3000, "auto", "", BOTH).url, "http://100.64.0.5:3000")
    assert.equal(shareUrl(3000, "lan", "", BOTH).url, "http://192.168.1.20:3000")
    assert.equal(shareUrl(3000, "tailscale", "", BOTH).kind, "tailscale")
  })

  it("falls back to the machine's own host when its choice has no address", () => {
    assert.deepEqual(shareUrl(3000, "tailscale", "", { lan: ["192.168.1.20"], tailscale: [] }, "10.0.0.4"), {
      url: "http://10.0.0.4:3000",
      kind: "direct",
    })
    assert.equal(shareUrl(3000, "custom", "  ", NONE).kind, "local")
  })

  it("strips scheme and trailing slash off a custom host", () => {
    assert.equal(shareUrl(8091, "custom", "https://box.local/", BOTH).url, "http://box.local:8091")
  })

  /**
   * A container's `/network-info` reports its docker-bridge address, which the
   * host cannot route; the port is only reachable at the address the connection
   * itself was made on. Open and copy both go through here, so this is what the
   * two agree on.
   */
  it("keeps a remote machine's host when discovery only found unroutable addresses", () => {
    const bridged = { lan: ["172.19.0.3"], tailscale: [] }
    assert.equal(shareUrl(8091, "custom", "127.0.0.1", bridged, "127.0.0.1").url, "http://127.0.0.1:8091")
    assert.equal(shareUrl(8091, "auto", "", NONE, "127.0.0.1").url, "http://127.0.0.1:8091")
  })
})

describe("openUrl", () => {
  it("dials the machine's own host on automatic, however discovery went", () => {
    assert.equal(openUrl(3000, "auto", "", BOTH), "http://localhost:3000")
    assert.equal(
      openUrl(8091, "auto", "", { lan: ["172.19.0.3"], tailscale: [] }, "127.0.0.1"),
      "http://127.0.0.1:8091",
    )
  })

  it("follows an explicit choice, exactly as a copied link does", () => {
    assert.equal(openUrl(3000, "tailscale", "", BOTH), shareUrl(3000, "tailscale", "", BOTH).url)
    assert.equal(openUrl(3000, "lan", "", BOTH), "http://192.168.1.20:3000")
    assert.equal(openUrl(8091, "custom", "127.0.0.1", BOTH, "10.0.0.4"), "http://127.0.0.1:8091")
  })
})
