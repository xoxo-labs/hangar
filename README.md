# hangar

Local project launcher for the Mac: register your dev projects once, then start
them (and later, watch their terminals) from one place. Designed so coding
agents can manage the registry through the CLI instead of you doing it by hand.

## Install

Download the latest DMG from the
[releases page](https://github.com/xoxo-labs/hangar/releases/latest). Builds
are unsigned for now: if Gatekeeper blocks the first launch, right-click
`Hangar.app`, choose **Open**, then confirm **Open**.

## Architecture (t3code-inspired)

1. **`apps/server`** — the brain. Owns the project registry and the PTY
   sessions, exposed over a local WebSocket (`hangar serve`, port 4780). It also
   serves the built web UI on that same port, so a browser alone is a complete
   client. Also ships the `hangar` CLI: the CLI and the desktop backend are the
   same program.
2. **`apps/desktop`** — thin Electron shell: ensures the server is running
   (spawns it if not) and shows the web UI in a window.
3. **`apps/web`** — React UI with xterm.js terminals (Vite, port 4790), talking
   to the server over WebSocket. Runs in the Electron window or a plain browser.
4. **`packages/contracts`** — shared types and the WebSocket protocol.

## Run the app

```sh
pnpm dev            # server :4781 + web :4790 + Electron window
pnpm dev:headless   # server + web only — open http://localhost:4790
```

Development deliberately uses port `4781` and `~/.hangar-dev` (including a
separate Electron profile), so the packaged app can keep running on `4780` and
launch Hangar development without port, data, or profile collisions.

To build a standalone macOS application (no separately installed Node runtime
needed at launch):

```sh
pnpm package:mac    # apps/desktop/release/mac-arm64/Hangar.app
pnpm dist:mac       # also creates an installable DMG
```

Local builds are intentionally unsigned. If Gatekeeper blocks the first launch,
right-click `Hangar.app`, choose **Open**, then confirm **Open**.

## Registry

Lives in `~/.hangar/projects.json` (override the directory with `$HANGAR_HOME`).
One entry per project:

```json
{
  "name": "lust",
  "path": "~/code/xoxo/lust",
  "processes": [
    { "name": "web", "cmd": "pnpm dev", "cwd": "apps/lust-web" },
    { "name": "convex", "cmd": "npx convex dev", "cwd": "apps/convex-be" }
  ]
}
```

## CLI

See the [human CLI guide](docs/CLI.md). Coding agents can use the bundled slim
[`hangar-dev-servers` skill](.agents/skills/hangar-dev-servers/SKILL.md).

The CLI controls the same persistent sessions as the desktop and web clients.
Use `project/process` to select one process, or a bare project name for all of
its processes.

```sh
hangar ls --json
hangar add <name> <path> --cmd "web=pnpm dev@apps/web"
hangar --json status [project/process]
hangar --json start project/process [--wait-port[=3000]]
hangar stop project/process
hangar restart project
hangar logs project/process --tail 100
hangar ports project --json
```

A missing local server is started automatically. `hangar run project/process`
keeps the old, unsupervised foreground behavior for scripts that explicitly
need it.

### Remote targets

On the Mac that will run the processes, mint a single-use five-minute code:

```sh
hangar target pair-code
```

On the client, pass the code over stdin so it does not enter shell history:

```sh
printf '%s' "$PAIRING_CODE" | hangar target add studio 100.90.1.5:4780 --code -
hangar -t studio status --json
hangar -t studio start project/process --wait-port
```

`HANGAR_TARGET=studio` can select a target for a whole shell. The implicit
target is always `local`; there is deliberately no persistent remote default.
Paired tokens live in `~/.hangar/targets.json` with mode `0600` and grant control
of development commands on that Mac, much like an SSH credential. Tailscale is
the recommended transport.

A Mac with no display can run Hangar on its own — `hangar serve --host <addr>`
binds where you point it (a Tailscale address is the safe choice) and serves the
web UI there, so `http://<host>:4780` in any browser is a full client once paired
with a code from `hangar target pair-code`. See
[docs/REMOTE.md](docs/REMOTE.md#headless).

No build step: Node ≥ 24 runs the TypeScript sources directly. The DMG does not
modify PATH automatically; in the installed app choose **Hangar → Install
Command Line Tool…**. For a source checkout:

```sh
cd apps/server && pnpm link --global
```

## License

[MIT](LICENSE).
