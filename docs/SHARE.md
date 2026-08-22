# Published ports: sharing a dev server through Tailscale

Design notes for the port-sharing feature. Read `docs/REMOTE.md` first — the
connection and scoping model is defined there and does not change here.

Wording: a port is **published** or **shared**; it is **on your tailnet** or
**public on the internet**. Never "remote access" (see `docs/PRODUCT.md`).

## What it is

Hangar already detects the ports a session listens on and offers links and a QR
for LAN and Tailscale addresses. Those only help a device that is already on the
same network. Publishing goes one step further:

| Reach | Mechanism | Who can open it |
|---|---|---|
| Tailscale address | `tailscale serve --bg --yes --tcp=<port> tcp://localhost:<port>` | machines allowed by your tailnet policy, at the existing `100.x:<port>` link |
| Tailnet HTTPS | `tailscale serve --bg --yes --https=<p> <port>` | machines on your tailnet, over real HTTPS |
| Public | `tailscale funnel --bg --yes --https=<p> <port>` | anyone with the link — no account, no client |

All three proxy from the Tailscale edge into localhost, which is why they work
for a dev server bound to loopback only. The Tailscale-address tile in the QR
dialog can turn its TCP bridge on and off without changing the HTTP URL already
shown to the user; the HTTPS modes allocate a separate Serve port. The bridge
changes routing, not browser origin: authentication or edge providers may reject
a private-IP HTTP origin, in which case Tailnet HTTPS plus an authorized MagicDNS
hostname is the right option.

### Why not device sharing

The obvious reading of "share a port with a friend" is Tailscale's node-sharing
invite. It was rejected: there is no CLI for it (admin console or API only, so
Hangar would have to hold a tailnet-wide OAuth secret), it shares a **device**
rather than a port — narrowing to one port means Hangar rewriting the user's
tailnet policy file — and the recipient must create an account, install a
client and accept an invite before anything renders. Funnel needs none of that.

## Server

`apps/server/src/tailscale.ts` owns every interaction with the CLI.

The serve config is **shared mutable state**: a user may have hand-built entries
in it. So the module

- never runs `reset` or `clear` — a test asserts no emittable argv contains them;
- only ever turns off the single `--https=<port>` entry a share owns;
- treats as *Hangar-shaped* only an entry with exactly one handler, at `/`,
  proxying a loopback URL. Anything else — extra paths, a foreign target, a raw
  TCP forwarder — is never listed, never claimed, and never withdrawn.

Every decision about that config is a pure function over its JSON
(`readShares`, `servePortOwner`, `pickServePort`, `shareArgs`, `unshareArgs`,
`stopTarget`, `funnelDenied`, `stateFromStatus`), so the rules are tested
without a running `tailscaled`.

Notes the implementation had to respect:

- The CLI is **not on PATH** on macOS. Resolution order is `TAILSCALE_BIN`, the
  app bundle at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, then
  homebrew/usr paths, then PATH.
- Funnel terminates TLS on **443, 8443 and 10000 only** — a hard cap of three
  concurrent public shares. Plain `serve` has no such limit (verified against
  1.98.10), so tailnet shares continue into 10001–10050.
- `status --json` exits 0 even when stopped; `Self.DNSName` arrives fully
  qualified with a trailing dot, which browsers do not want.
- When the tailnet policy lacks the `funnel` node attribute, Tailscale prints
  the admin-console link that grants it. That stderr is surfaced verbatim — it
  contains the URL the user has to click, and a paraphrase would strand them.
- Every spawn has a 10 s timeout: a wedged `tailscaled` must not wedge Hangar.

`serve.ts` caches `shares` and `tailscale` and refreshes them around each
mutation, because `stateMsg()` is called from a dozen synchronous places and
cannot await a subprocess. Both ride the existing `state` broadcast, so shares
are per-connection like everything else a machine owns.

## Lifetime

A published port is the only thing in Hangar a stranger can reach, so it is
withdrawn at every natural ending and surfaced loudly while it lives.

- **Process ends** → its proxies and shares are withdrawn. A *restart* is not an ending:
  `SessionManager.restarting()` tells the exit handler that the port is coming
  back, so a share survives the seam rather than being torn down and rebuilt.
- **Hangar quits** → `stopOwnShares()` withdraws only what this run created, including TCP bridges.
  Adopted and hand-made entries existed before Hangar and are left standing.
  Bounded to 3 s and run alongside PTY shutdown, so quitting never waits on a
  wedged daemon.
- **Hangar starts** → it reconciles against the live serve config and *adopts*
  what it finds rather than assuming a clean slate. A share that outlived a
  crash is still live; the worst outcome is an exposed port that no UI admits
  to, so it is shown (and killable) instead of guessed at.

A consequence worth knowing: a serve entry you built by hand appears in
Hangar's UI as a share, because it is one. Hangar will not withdraw it on quit,
but it will list it and offer to stop it.

## UI

Public Funnel controls are available whenever Tailscale is running. Private
Tailnet HTTPS controls are opt-in under **Settings → Links → Show Tailnet HTTPS
sharing** and hidden by default; the managed-tailnet setup is uncommon enough
that it should not crowd the default menu. The setting links to Tailscale's Serve
and access-policy documentation. Turning it off leaves public sharing alone, and
an existing tailnet share remains visible and stoppable rather than concealing
an exposed port.

Three surfaces, one rule: **the reach is the signal.** Public shares carry the
warning tone everywhere; tailnet shares stay calm.

- **Port QR dialog** (`PortShareDialog.tsx`) — a Settings-style reach rail
  switches among Local network, Tailscale, Tailnet HTTPS, and Public link while
  a stable right pane holds the QR, URL, guidance, and on/off action. Warnings
  use an inline accent lane rather than nested cards, and reserve their space so
  live state changes do not move the content. Unavailability is stated honestly
  from `TailscaleState` (not installed / stopped / an older server).
- **Sidebar** (`Sidebar.tsx`) — a `Globe` beside the status dot on a publishing
  row, tinted by reach. Deliberately **not** a row background: selection and
  hover already contend for it, and a third meaning would lose to selection or
  eat it. The right-click menu gains share/QR/stop items, using the ports
  detected on the live session.
- **Status bar** (`StatusBar.tsx`) — the always-visible alarm and kill switch,
  since it is the surface that catches "I forgot I did this an hour ago". Lists
  every share across every machine, public first, each with its own QR trigger
  and stop action. QR actions here and in the sidebar open the same reach dialog
  as the inspector, preselected to the active share.

Publishing **publicly** always confirms (`ConfirmRequest`'s `share-public`
variant), matching the product principle that destructive actions confirm.
Tailnet sharing does not: it is reversible and stays among machines the user
already trusts.

## Verification

- `pnpm -r typecheck` and `pnpm -r test` green.
- Pure-logic coverage in `apps/server/src/tailscale.test.ts` (including tests
  that a hand-made `443 → 3021` config survives sharing and unsharing beside it)
  and `apps/web/src/shares.logic.test.ts`.
- Live check, which needs a logged-in `tailscaled`: publish a port on the
  tailnet, open the URL from another machine; publish publicly, open the URL
  from a device with Tailscale off; stop the process and confirm the share is
  gone; quit Hangar with a share live and confirm `tailscale serve status`
  no longer lists it while any hand-made entry remains.
