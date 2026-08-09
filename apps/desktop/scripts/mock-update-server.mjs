// Serves the release/ artifacts as a local update feed for exercising the
// auto-update flow without publishing anything. The advertised version is
// inflated (default 99.9.9) so whatever build you run always sees an update —
// the zip itself is served untouched, so its checksum still matches.
//
// Usage:
//   pnpm dist:mac        # produce release/ artifacts once
//   pnpm mock-updates    # serve them on http://127.0.0.1:8817
//   HANGAR_MOCK_UPDATE_URL=http://127.0.0.1:8817 \
//     ./release/mac-arm64/Hangar.app/Contents/MacOS/Hangar
//
// Also works against `pnpm dev` (the desktop picks up the env var), but only a
// packaged build can complete the final restart-and-install step — and on an
// unsigned build that step fails signature validation by design.
//
// Options: --port 8817  --dir release  --version 99.9.9

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { basename, join, resolve } from "node:path"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "8817" },
    dir: { type: "string", default: "release" },
    version: { type: "string", default: "99.9.9" },
  },
})

const PORT = Number(args.port)
const DIR = resolve(args.dir)
const FEED = join(DIR, "latest-mac.yml")

if (!existsSync(FEED)) {
  console.error(`No ${FEED} — run \`pnpm dist:mac\` first to produce the release artifacts.`)
  process.exit(1)
}

/** The real feed with only the advertised version lines replaced. */
function mockedFeed() {
  return readFileSync(FEED, "utf8").replace(/^version: .*$/m, `version: ${args.version}`)
}

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
  const name = basename(path)
  console.log(`[mock-updates] ${request.method} ${path}`)

  if (name === "latest-mac.yml") {
    const body = mockedFeed()
    response.writeHead(200, { "content-type": "text/yaml", "content-length": Buffer.byteLength(body) })
    response.end(body)
    return
  }

  // basename() confines lookups to the release dir itself.
  const file = join(DIR, name)
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404)
    response.end("not found")
    return
  }
  response.writeHead(200, { "content-length": statSync(file).size })
  createReadStream(file).pipe(response)
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-updates] serving ${DIR} on http://127.0.0.1:${PORT} as version ${args.version}`)
  console.log("[mock-updates] launch the app with:")
  console.log(`  HANGAR_MOCK_UPDATE_URL=http://127.0.0.1:${PORT} ./release/mac-arm64/Hangar.app/Contents/MacOS/Hangar`)
})
