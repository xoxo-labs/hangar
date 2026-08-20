import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { openUrl, parseDeepLink, shareUrl } from "./links.ts"

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

describe("parseDeepLink", () => {
  /** Registry names go into the path raw, so anything but [A-Za-z0-9] comes back escaped. */
  it("decodes the ids the App Intents surface escaped", () => {
    assert.deepEqual(parseDeepLink("hangar://project/my%20app"), { kind: "project", project: "my app" })
    assert.deepEqual(parseDeepLink("hangar://process/my%20app%2Fdev%20server"), {
      kind: "process",
      project: "my app",
      process: "dev server",
    })
  })

  it("splits a process id at its first slash, escaped or not", () => {
    assert.deepEqual(parseDeepLink("hangar://process/api/dev"), { kind: "process", project: "api", process: "dev" })
    assert.deepEqual(parseDeepLink("hangar://process/api%2Fbuild%2Fweb"), {
      kind: "process",
      project: "api",
      process: "build/web",
    })
  })

  it("refuses every link it cannot act on", () => {
    const refused = [
      "",
      "not a url",
      "hangar://project/", // no id
      "hangar://process/api", // a process id is always project/process
      "hangar://process/api/", // …with both halves present
      "hangar://process//dev",
      "hangar://widget/api", // a kind we do not serve
      "hangar:project/api", // scheme-relative, so nothing is a host
      "https://example.com/project/api",
      "hangar://project/%zz", // a malformed escape
    ]
    for (const url of refused) assert.equal(parseDeepLink(url), null, url)
  })
})
