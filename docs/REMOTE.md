# Connections: pairing Hangar across machines

Design spec for the `feature/remote` work: run Hangar on more than one Mac and
control all of them from one window. This document is the contract between the
server-side and client-side implementation; `packages/contracts/src/index.ts`
carries the wire types.

Wording note: user-facing copy talks about "connections", "paired machines",
"other Macs" — never "remote access" (see `docs/PRODUCT.md`).

## Model

- Every machine keeps running its own full Hangar (server + registry + PTYs).
  Servers never talk to each other.
- One client (the app's web UI) can hold **N WebSocket connections**, one per
  machine: the implicit `local` connection plus zero or more paired machines.
- Everything a server owns (projects, sessions, history, settings) stays
  namespaced per connection in the client. A later feature may *group* projects
  across machines by git identity — that stays a pure UI layer; identity remains
  per-connection.

## Threat model

WS access is code execution (`start` runs `$SHELL -lc`). Therefore:

- The server binds `127.0.0.1` unless the user explicitly enables
  `settings.connections.acceptRemote`; then it binds `0.0.0.0`
  (`HANGAR_HOST` env overrides either way).
- Loopback clients are trusted (unchanged from today). Non-loopback requests
  must present credentials on **every** HTTP endpoint except `/health` and
  `POST /api/auth/pair`, and on the WS upgrade.
- Traffic is plaintext HTTP/WS; the recommended transport across networks is
  Tailscale. Say so in the UI copy near the toggle.

## Server (`apps/server`)

### Auth module — new file `apps/server/src/auth.ts`

Persisted state `~/.hangar/auth.json` (via `hangarHome()`):
`{ version: 1, sessions: [{ id, tokenHash, label, createdAt, lastSeenAt }] }`.

- **Session tokens**: `hgr_` + 32 random bytes base64url. Returned once by
  `/api/auth/pair`; stored as SHA-256 hex, verified with `timingSafeEqual`.
  `lastSeenAt` updated (throttled, ≤1 write/min) on use.
- **Pairing grants**: in-memory only. Token = 12 chars from the alphabet
  `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (rejection-sampled from `randomBytes`),
  TTL 5 minutes, single-use. Minting a new grant invalidates prior ones.
  Brute-force guard: after 20 failed pair attempts, refuse `/api/auth/pair`
  until a new grant is minted.
- **WS tickets**: in-memory. 32 random bytes base64url, TTL 60 s, single-use,
  bound to the auth session that requested them.

API (shape, adapt freely): `createPairingToken()`, `redeemPairingToken(token,
label)`, `verifyBearer(authorizationHeader)`, `issueTicket(sessionId)`,
`consumeTicket(ticket)`, `listSessions()`, `revokeSession(id)`.

### `serve.ts`

- **Bind host**: `HANGAR_HOST` env if set, else `0.0.0.0` when
  `settings.connections.acceptRemote`, else `127.0.0.1`. When a settings save
  flips `acceptRemote`: broadcast state, close all WS clients (code 1012),
  `server.close()` + `closeAllConnections()`, then `listen()` again on the new
  host. PTY sessions live in `SessionManager` and are untouched; local UIs
  reconnect on their own.
- **Loopback check**: `req.socket.remoteAddress` ∈
  {`127.0.0.1`, `::1`, `::ffff:127.0.0.1`}.
- **HTTP endpoints** (existing + new). All `/api/*` and existing JSON endpoints
  answer `OPTIONS` preflight with `access-control-allow-origin: *`,
  `access-control-allow-headers: authorization, content-type`,
  `access-control-allow-methods: GET, POST`. Auth (bearer or loopback) is the
  security boundary, not CORS.
  - `GET /health` — open, unchanged (Electron probe relies on it).
  - `POST /api/auth/pair` — open. Body `PairRequest`; 200 → `PairResponse`
    (`serverName` = `os.hostname()`), 401 on bad/expired token, 429 when the
    brute-force guard trips.
  - `POST /api/auth/ws-ticket` — loopback or bearer → `WsTicketResponse`.
  - `GET /network-info`, `GET /project-info` — now require loopback or bearer
    (401 otherwise).
- **WS upgrade**: switch to `new WebSocketServer({ noServer: true })` + an
  `upgrade` handler on the HTTP server: accept loopback directly; otherwise
  require a valid single-use `?ticket=`; else respond `401` and destroy the
  socket.
- **New WS messages** (any connected client is fully trusted by definition):
  - `createPairingToken` → reply on the same socket with
    `{ type: "pairingToken", pairing }` where `pairing.hosts` comes from
    `networkInfo()` and `pairing.port` is the listening port.
  - `revokeAuthSession { id }` → revoke + `broadcastState()`.
- **State message**: include `serverName: os.hostname()` and
  `authSessions: listSessions()` (without token hashes).
- **Settings back-compat**: an older client's `updateSettings` payload has no
  `connections` section — `saveSettings` must preserve the currently saved
  `connections` value in that case instead of throwing or resetting it.
  `loadSettings`/validation follow the existing per-section merge pattern.

### Desktop (`apps/desktop/main.mjs`)

Widen the `openUrl` whitelist from localhost-only to any `http:`/`https:` URL
(still refusing other schemes) so detected ports on paired machines can open.

## Client (`apps/web`)

### Scoped identifiers

All server-owned identifier strings are rewritten at the WS seam so the store
only ever sees **scoped** values:

- Scope format: `${connId}::${value}` — applied to `project.name`,
  `session.id`, `session.project`, `session.runId`, history entries' `runId`
  and `project`/`id`, and the `id`/`runId` of `metrics`/`snapshot`/`output`/
  `exit`/`historyReplay` messages. (`session.process` stays bare.)
- Helpers in `apps/web/src/connections/scope.ts`: `scoped(connId, value)`,
  `parseScoped(value) → { connId, value }`, `displayName(value)`. Connection
  ids never contain `:`; the local connection id is the literal `"local"`.
- Outgoing messages strip the scope and route to the owning socket:
  `actions.ts` parses the scope out of its arguments — component call sites
  keep passing `project.name` / `session.id` and mostly don't change.
- Anywhere a *bare* server id enters the client outside the WS seam (deep
  links, `?window=` flows, App Intents URLs), scope it as `local`.
- UI text must render names through `displayName`; grep for rendered
  `project.name` / `session.project` / `session.id` usages.

### Connection manager — new `apps/web/src/connections/`

- `ConnectionConfig = { id, label, host, port, secure: false, token? }`. The
  `local` connection is implicit (`127.0.0.1`, `readPort()`, no token) and not
  persisted; paired configs (with tokens) persist in
  `localStorage["hangar.connections.v1"]`.
- Per-connection supervisor owns the retry loop (single retry owner):
  - Statuses: `connecting | connected | reconnecting | blocked`.
  - Backoff 1 s → 2 → 4 → 8 → 16 (cap), reset after 30 s healthy.
  - **Transient vs blocked**: network/fetch failures and WS closes retry
    forever; a 401/403 from `/api/auth/ws-ticket` marks the connection
    `blocked` (bad/revoked token) and stops retrying until a wakeup: browser
    `online` event, `visibilitychange` → visible, config/token change, or an
    explicit "Retry" from the UI.
- Connect sequence, remote: `POST /api/auth/ws-ticket` (bearer) →
  `ws://host:port/ws?ticket=…`. Local: straight `ws://127.0.0.1:port/ws`.
- Message ingestion applies scoping, then dispatches to the shared handler
  (today's `handle()` in `ws.ts`, refactored to take `connId`).
- "Connected" surfaces only after the first `state` message arrives.

### Store

- `connections: Record<connId, { config, status, error, serverName,
  settings, authSessions }>`; top-level `status` and `settings` stay aliased to
  the local connection (they drive theme/terminal/global UI, and existing
  components keep working).
- `applyState(connId, …)` merges **one connection's slice**: drop previous
  items scoped to `connId`, keep every other connection's items, preserve
  existing ordering rules within the slice.
- Focus rule: the "new session grabs focus" behavior only applies after a
  connection's first `state` since (re)connect — a reconnect snapshot must not
  steal focus.
- Removing a connection purges its scoped items (sessions, pending, history
  tabs, metric history, terminals via `disposeTerminal`).

### UI (second pass, after the core lands)

- Settings → **Connections** section:
  - "This Mac": `acceptRemote` toggle (+ plaintext/Tailscale note), pairing
    code generator showing code, `host:port` candidates, and a QR (new deps:
    `qrcode` + `@types/qrcode`); paired-clients list with revoke.
  - "Paired machines": add (host + port + code, or pasted `host:port#CODE`
    string), remove, per-connection status dot, Retry when `blocked`.
- Sidebar: with >1 connection, group projects under machine headers
  (label/serverName + status dot). Local group first.
- Ports/links panel: per-connection `network-info` (bearer where remote);
  detected-port links for a paired machine open `http://<its host>:<port>`.
- Command palette: entries already enumerate scoped projects; ensure labels go
  through `displayName` and remote entries mention the machine.

## Verification checklist

Two servers on one Mac simulate two machines:
`HANGAR_HOME=~/.hangar-a HANGAR_PORT=4890` and `HANGAR_HOME=~/.hangar-b
HANGAR_PORT=4891` (plus `HANGAR_HOST=0.0.0.0` or the settings toggle on B).
Pair A's UI to B; verify: start/stop/terminal I/O on B from A's UI, auth
rejections (no ticket, bad bearer, reused ticket, expired pairing code),
`acceptRemote` toggle re-bind, revoke kills B's paired client on next connect.
