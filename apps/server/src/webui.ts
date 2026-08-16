import { existsSync, readFileSync, statSync } from "node:fs"
import type { ServerResponse } from "node:http"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
}

/**
 * The packaged desktop app bundles this file to dist/server/cli.mjs with the
 * built web app in the sibling dist/web; a source checkout finds the monorepo
 * build output instead. HANGAR_WEB_DIST overrides both.
 */
export function resolveWebRoot(): string | null {
  const candidates = [process.env.HANGAR_WEB_DIST, join(HERE, "../web"), join(HERE, "../../web/dist")]
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "index.html"))) return resolve(candidate)
  }
  return null
}

function send(res: ServerResponse, path: string, head: boolean): void {
  const body = readFileSync(path)
  res.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "content-length": body.length,
    // Vite content-hashes everything under assets/; index.html must revalidate
    // so a redeployed server never pins clients to a stale shell.
    "cache-control": path.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  })
  res.end(head ? undefined : body)
}

/**
 * Serves the built web UI. The static shell is public by design: it holds no
 * secrets, and every state-bearing request (WS, /api) still requires loopback
 * or a paired session token.
 */
export function serveWebUi(pathname: string, res: ServerResponse, root: string | null, head = false): void {
  if (root === null) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
    // Two audiences reach this: a checkout that has not built the UI yet, and a
    // standalone CLI install, which ships no UI at all by design.
    res.end(
      "hangar is running, but no web UI is bundled with it.\n" +
        "Use the Hangar desktop app to manage this server, or from a source checkout run: pnpm --filter @hangar/web build\n",
    )
    return
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    decoded = "\0"
  }
  if (decoded.includes("\0")) {
    res.writeHead(404)
    res.end()
    return
  }
  const path = resolve(root, `.${decoded}`)
  const inRoot = path === root || path.startsWith(root + sep)
  if (inRoot && existsSync(path) && statSync(path).isFile()) {
    send(res, path, head)
    return
  }
  // Anything else gets the app shell; the UI owns its own routing and 404s.
  if (inRoot) send(res, join(root, "index.html"), head)
  else {
    res.writeHead(404)
    res.end()
  }
}
