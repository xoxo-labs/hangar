import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { fetchWsTicket, httpBase, isBlocked, TicketError, wsUrl } from "./connect.ts"
import type { ConnectionConfig } from "./types.ts"

const config: ConnectionConfig = {
  id: "c1",
  label: "Mac mini",
  host: "100.90.1.5",
  port: 4780,
  secure: false,
  token: "hgr_x",
}
const local: ConnectionConfig = { id: "local", label: "This Mac", host: "127.0.0.1", port: 4781, secure: false }

const realFetch = globalThis.fetch

const answer = (reply: () => Response | Promise<Response>): void => {
  globalThis.fetch = (async () => await reply()) as typeof globalThis.fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("httpBase / wsUrl", () => {
  it("builds the plaintext origins a paired machine speaks", () => {
    assert.equal(httpBase(config), "http://100.90.1.5:4780")
    assert.equal(wsUrl(config, "tkt/1"), "ws://100.90.1.5:4780/ws?ticket=tkt%2F1")
  })

  it("leaves the local connection ticketless", () => {
    assert.equal(wsUrl(local), "ws://127.0.0.1:4781/ws")
    assert.equal(wsUrl(local, ""), "ws://127.0.0.1:4781/ws")
  })

  it("honours the secure flag", () => {
    assert.equal(httpBase({ ...config, secure: true }), "https://100.90.1.5:4780")
    assert.equal(wsUrl({ ...config, secure: true }), "wss://100.90.1.5:4780/ws")
  })
})

describe("fetchWsTicket", () => {
  it("sends the token as a bearer and returns the ticket", async () => {
    const seen: Array<[string, RequestInit | undefined]> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push([url, init])
      return Response.json({ ticket: "tkt" })
    }) as unknown as typeof globalThis.fetch
    assert.equal(await fetchWsTicket(config), "tkt")
    assert.equal(seen[0]?.[0], "http://100.90.1.5:4780/api/auth/ws-ticket")
    assert.equal(seen[0]?.[1]?.method, "POST")
    assert.deepEqual(seen[0]?.[1]?.headers, { authorization: "Bearer hgr_x" })
  })

  it("marks a rejected credential blocked", async () => {
    for (const status of [401, 403]) {
      answer(() => new Response("", { status }))
      const error = await fetchWsTicket(config).catch((thrown: unknown) => thrown)
      assert.ok(isBlocked(error))
    }
  })

  it("keeps every other failure transient", async () => {
    answer(() => new Response("", { status: 500 }))
    const server = await fetchWsTicket(config).catch((thrown: unknown) => thrown)
    assert.ok(server instanceof TicketError)
    assert.equal(server.blocked, false)

    answer(() => Response.json({ ticket: "" }))
    assert.equal(isBlocked(await fetchWsTicket(config).catch((thrown: unknown) => thrown)), false)

    answer(() => {
      throw new TypeError("fetch failed")
    })
    const offline = await fetchWsTicket(config).catch((thrown: unknown) => thrown)
    assert.ok(offline instanceof TicketError)
    assert.equal(offline.blocked, false)
  })
})
