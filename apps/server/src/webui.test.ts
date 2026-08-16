import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import type { ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test, type TestContext } from "node:test"
import { resolveWebRoot, serveWebUi } from "./webui.ts"

const SHELL = "<!doctype html><title>hangar shell</title>\n"
const ASSET = "export const built = true\n"
const SECRET = "topsecret\n"

/** A built web root inside a container that also holds a file traversal must never reach. */
function webRootFixture(): { root: string; outside: string } {
  const container = mkdtempSync(join(tmpdir(), "hangar-webui-"))
  const root = join(container, "web")
  mkdirSync(join(root, "assets"), { recursive: true })
  writeFileSync(join(root, "index.html"), SHELL)
  writeFileSync(join(root, "assets", "app-abc123.js"), ASSET)
  writeFileSync(join(root, "favicon.svg"), "<svg/>\n")
  writeFileSync(join(root, "manifest.bin"), "binary\n")
  writeFileSync(join(container, "secret.txt"), SECRET)
  return { root, outside: join(container, "secret.txt") }
}

type Sent = { status: number; headers: Record<string, string | number>; body: string | undefined }

/** serveWebUi only ever touches writeHead/end, so a capture object stands in for the socket. */
function serve(pathname: string, root: string | null, head = false): Sent {
  const sent: Sent = { status: 0, headers: {}, body: undefined }
  const res = {
    writeHead(status: number, headers?: Record<string, string | number>) {
      sent.status = status
      Object.assign(sent.headers, headers ?? {})
      return res
    },
    end(chunk?: Buffer | string) {
      sent.body = chunk === undefined ? undefined : String(chunk)
      return res
    },
  }
  serveWebUi(pathname, res as unknown as ServerResponse, root, head)
  return sent
}

function withWebDist(t: TestContext, value: string | undefined): void {
  const previous = process.env.HANGAR_WEB_DIST
  if (value === undefined) delete process.env.HANGAR_WEB_DIST
  else process.env.HANGAR_WEB_DIST = value
  t.after(() => {
    if (previous === undefined) delete process.env.HANGAR_WEB_DIST
    else process.env.HANGAR_WEB_DIST = previous
  })
}

test("HANGAR_WEB_DIST wins over the bundled and monorepo candidates", (t) => {
  const { root } = webRootFixture()
  withWebDist(t, join(root, "assets", ".."))
  assert.equal(resolveWebRoot(), resolve(root))
})

test("a candidate without index.html is not a web root", (t) => {
  const empty = mkdtempSync(join(tmpdir(), "hangar-webui-empty-"))
  withWebDist(t, empty)
  assert.notEqual(resolveWebRoot(), resolve(empty))
})

test("without the override only the packaged or monorepo build answers", (t) => {
  withWebDist(t, undefined)
  const here = resolve(import.meta.dirname)
  // A source checkout may or may not have apps/web/dist built; either way the
  // answer is one of the two fixed candidates.
  assert.ok([null, resolve(here, "../web"), resolve(here, "../../web/dist")].includes(resolveWebRoot()))
})

test("serves index.html for / and revalidates it", () => {
  const { root } = webRootFixture()
  const sent = serve("/", root)
  assert.equal(sent.status, 200)
  assert.equal(sent.body, SHELL)
  assert.equal(sent.headers["content-type"], "text/html; charset=utf-8")
  assert.equal(sent.headers["content-length"], Buffer.byteLength(SHELL))
  assert.equal(sent.headers["cache-control"], "no-cache")
})

test("content-hashed assets are immutable, everything else is not", () => {
  const { root } = webRootFixture()
  const asset = serve("/assets/app-abc123.js", root)
  assert.equal(asset.status, 200)
  assert.equal(asset.body, ASSET)
  assert.equal(asset.headers["content-type"], "text/javascript; charset=utf-8")
  assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable")

  const icon = serve("/favicon.svg", root)
  assert.equal(icon.headers["content-type"], "image/svg+xml")
  assert.equal(icon.headers["cache-control"], "no-cache")

  // Unknown extensions still get served, just untyped.
  assert.equal(serve("/manifest.bin", root).headers["content-type"], "application/octet-stream")
})

test("HEAD sends the headers of the real file with no body", () => {
  const { root } = webRootFixture()
  const sent = serve("/assets/app-abc123.js", root, true)
  assert.equal(sent.status, 200)
  assert.equal(sent.body, undefined)
  assert.equal(sent.headers["content-length"], Buffer.byteLength(ASSET))
})

test("misses fall back to the app shell so the UI can route them", () => {
  const { root } = webRootFixture()
  for (const pathname of ["/projects/hangar", "/assets/gone.js", "/assets"]) {
    const sent = serve(pathname, root)
    assert.equal(sent.status, 200, pathname)
    assert.equal(sent.body, SHELL, pathname)
    assert.equal(sent.headers["cache-control"], "no-cache", pathname)
  }
})

test("paths escaping the root are 404s, never file reads", () => {
  const { root, outside } = webRootFixture()
  // The target exists, so a 404 here can only come from the containment check.
  assert.equal(readFileSync(outside, "utf8"), SECRET)
  for (const pathname of ["/../secret.txt", "/%2e%2e%2fsecret.txt", "/assets/../../secret.txt", "/../"]) {
    const sent = serve(pathname, root)
    assert.equal(sent.status, 404, pathname)
    assert.equal(sent.body, undefined, pathname)
  }
})

test("undecodable paths are 404s", () => {
  const { root } = webRootFixture()
  const sent = serve("/%zz", root)
  assert.equal(sent.status, 404)
  assert.equal(sent.body, undefined)
})

test("a NUL in the path is rejected before any filesystem call", () => {
  const { root } = webRootFixture()
  assert.equal(serve("/index.html%00.png", root).status, 404)
  assert.equal(serve("/%2e%2e%2fsecret.txt%00", root).status, 404)
})

test("an unbuilt web UI explains itself with a 503", () => {
  const sent = serve("/", null)
  assert.equal(sent.status, 503)
  assert.equal(sent.headers["content-type"], "text/plain; charset=utf-8")
  assert.match(String(sent.body), /pnpm --filter @hangar\/web build/)
})
