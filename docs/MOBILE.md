# Mobile companion: Hangar on your phone

Design spec for the mobile phase of the connections work (`feature/remote`).
Read `docs/REMOTE.md` first — the pairing/auth/scoping model is defined there
and does not change here. Same wording rule: "connections", "paired machines";
never "remote access".

## Goal

An Expo (React Native) app, `apps/mobile`, that pairs with Hangar servers the
same way a paired Mac does (QR scan or `host:port#CODE`), and offers:

- Machines list with live status (connected / reconnecting / blocked + retry).
- Projects and processes per machine: status, CPU/mem, start / stop / restart
  (destructive ones behind a confirm).
- Read-only session output: scrollback snapshot + live tail, exit codes.

Out of scope for this phase: interactive terminal input, push notifications
(needs a relay), pairing-code *generation* (phones don't accept connections),
project editing.

## Package extraction — `packages/client-core`

The platform-neutral half of `apps/web/src/connections/` moves to a new
workspace package `@hangar/client-core` (same raw-TS export style as
`@hangar/contracts`: `exports: "./src/index.ts"`). Contents:

- `scope.ts` — as-is (`LOCAL_CONN_ID`, `scoped`, `parseScoped`, `connIdOf`,
  `displayName`).
- `route.ts` — as-is (`scopeInbound`, `routeOutbound`).
- `supervisor.ts` — as-is; it must not reference `window`/DOM. Wakeup wiring
  (online/visibility listeners) stays in each platform's manager; if today's
  supervisor binds browser events directly, split that out into a hook the web
  manager passes in.
- `types.ts` — `ConnectionConfig`, `ConnectionStatus`.
- `pairing.ts` — `parsePairingString`, `pairingString`, `countdown` (moves from
  `apps/web/src/components/pairing.logic.ts`).
- NEW `connect.ts` — the ticket sequence as small platform-free helpers using
  global `fetch`: `httpBase(config)`, `fetchWsTicket(config)` (bearer POST,
  distinguishes blocked-vs-transient failure in its thrown/returned shape),
  `wsUrl(config, ticket?)` (no ticket for local/loopback). The web manager
  switches to these.
- Tests move along (`node --test`, wired into a `test` script).

`apps/web` keeps its manager (zustand/localStorage/terminals glue) and imports
the moved modules from `@hangar/client-core`. No behavior change; all existing
web tests keep passing (update import paths only).

## The app — `apps/mobile`

- Expo latest SDK, TypeScript, expo-router, pnpm workspace member. Keep the
  scaffold lean — no template demo screens left behind.
- Deps: `expo-camera` (QR scan), `zustand`, AsyncStorage for persistence,
  `@hangar/contracts` + `@hangar/client-core` (workspace:*). Metro must resolve
  workspace TS packages (Expo's monorepo support; enable
  `unstable_enablePackageExports`/watchFolders as needed).
- App display name: "Hangar". Scheme: `hangar-mobile`.

### Connection layer

A mobile manager mirroring the web one, built on the shared supervisor:

- Persistence: AsyncStorage key `hangar.connections.v1`, same JSON shape as
  the web (`ConnectionConfig[]` with tokens) so the mental model matches.
- No implicit `local` connection — every machine is added by pairing. The
  machine list is empty-state-first ("Scan the QR from Hangar's Connections
  settings on your Mac").
- Wakeups: RN `AppState` (active), `@react-native-community/netinfo` optional —
  if it needs a native module, plain `AppState` + manual retry is enough for v1.
- Inbound messages run through `scopeInbound` into a zustand store keyed the
  same scoped way (projects, sessions, metrics history trimmed to something
  phone-sized, e.g. last 30 min).
- Session output: keep a per-session ring buffer (~200 KB) of raw text; strip
  ANSI escape sequences for display (simple regex), render as monospace lines
  with follow-to-bottom. `snapshot` replaces the buffer, `output` appends.

### Screens (expo-router)

1. **Machines** (index): cards with name (serverName/label), status dot,
   running/total process counts; add button → Pair screen; long-press or detail
   → rename/remove/retry.
2. **Pair**: camera QR scan (expo-camera, `barcodeTypes: ["qr"]`) parsing the
   `host:port#CODE` payload via `parsePairingString`, plus manual host/port/code
   fields; POST `/api/auth/pair` with label = device name (`expo-device` or a
   static "iPhone"); store config on success; the same inline error mapping as
   the web (401 bad/expired, 429 locked → "generate a fresh code on your Mac").
3. **Machine detail**: projects grouped, each process row: status dot, name,
   CPU/mem when running, tap → session; buttons start/stop/restart (stop and
   restart confirm via native Alert).
4. **Session**: read-only log view (auto-follow, pause on scroll-up), header
   with status/exit code, actions stop/restart.

Visual language: follow the desktop app's dark aesthetic (near-black bg,
monospace accents, the same status-dot color semantics — see
`apps/web/src/status.ts` and Dot.tsx for tones). Simple, native-feeling,
no component library.

### iOS networking

Plain `ws://`/`http://` to LAN and Tailscale IPs requires, in `app.json`:
`ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads = true` (with a
comment that Tailscale is the recommended transport, matching the desktop
copy) and `NSLocalNetworkUsageDescription` + `NSBonjourServices` not needed
(no mDNS). Camera: `NSCameraUsageDescription` via the expo-camera plugin.

## Verification

- `pnpm -r typecheck` and `pnpm -r test` green across the repo (client-core
  extraction must not disturb web/server).
- Mobile: `tsc --noEmit` in apps/mobile, pure-logic tests (ANSI strip, store
  reducers) under `node --test`, and `npx expo export --platform ios` completes
  (proves metro resolves the workspace packages).
- Live check against a real server: `HANGAR_HOME=$(mktemp -d) HANGAR_PORT=4899
  HANGAR_HOST=0.0.0.0 node apps/server/src/cli.ts serve` — pair with a token
  minted over a loopback WS client, drive the manager headlessly (node) to
  prove connect → state → start → output → stop works with the mobile layer's
  code paths where runnable outside RN.
