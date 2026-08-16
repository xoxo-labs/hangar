# TODO

Things worth doing, with enough context to pick them up cold. Not a schedule —
an item lives here until it ships or stops being a good idea. Bigger themes that
shape the product live under Roadmap in [PRODUCT.md](PRODUCT.md); this file is
for the concrete work.

## Updating a headless host

A Mac serving Hangar with no display has no way to update itself, and no way to
be told to.

Updates are an Electron feature today: `apps/desktop/updater.mjs` wires
`electron-updater` to the GitHub Releases feed, the renderer drives it over IPC
(`hangar:update-check` / `-download` / `-install`), and `apps/web` reaches it
through `window.hangarDesktop`. A browser pointed at a headless server has no
`window.hangarDesktop`, so `useDesktopUpdate` reports `disabled` — correctly, in
that there is genuinely nothing there to update the host with. `hangar serve` on
a headless Mac is a bare Node process someone started; nothing watches the feed,
and nothing would restart it.

So the questions to settle, roughly in order:

- **What is being updated?** A headless host runs from a source checkout or the
  app bundle's binary, not from a DMG it can swap under itself. `git pull` is a
  different act from installing a release, and version skew between a client and
  the machine it drives is the thing that actually bites.
- **Who decides?** Pushing an update to a machine you paired with is a real
  privilege escalation over "run the processes I registered". It needs to be its
  own capability, not something a session token implies.
- **How does it restart?** `prepareInstall()` stops the server child so it gets a
  clean SIGTERM; on a headless host the server *is* the process, and its
  supervised sessions die with it. Whatever restarts it — launchd, a wrapper,
  the CLI — has to exist before an update can be safe, and the sessions'
  fate across it has to be a decision rather than an accident.
- **What does the client show?** Probably the same Settings → About affordance,
  fed per connection instead of from `window.hangarDesktop`, so a remote machine
  reports its own version and update state. That likely means the update state
  belongs in the server's state broadcast rather than in Electron IPC.

Worth checking first whether the honest answer is narrower: report the version
per machine and warn on skew, and let updating a headless host stay a deliberate
`ssh` + `git pull` + restart. That may be the whole feature.

## Document the signing-free CLI install

`Hangar → Install Command Line Tool…` is the only install path the release notes
mention, and reaching it means getting the unsigned app past Gatekeeper first.
The CLI itself needs none of that — `bin` in `apps/server/package.json` points at
`src/cli.ts` and Node ≥ 24 runs it directly, so `cd apps/server && pnpm link
--global` is a complete install from a checkout. Say so somewhere a user will
look, at least while releases are unsigned ([SIGNING.md](SIGNING.md)).
