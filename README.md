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
   sessions, exposed over a local WebSocket (`hangar serve`, port 4780). Also
   ships the `hangar` CLI: the CLI and the desktop backend are the same program.
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

```sh
hangar ls [--json]                # list projects (--json for agents)
hangar add <name> <path> \
  --cmd "web=pnpm dev@apps/web"   # register; --cmd is repeatable, cwd after @
hangar add --json '{...}'         # register from a JSON blob (agent-friendly)
hangar start <name> [process]     # run all (or one) processes, prefixed output
hangar path <name>                # print the project's path
hangar rm <name>                  # unregister
```

No build step: Node ≥ 24 runs the TypeScript sources directly. To get the
`hangar` command on your PATH:

```sh
cd apps/server && pnpm link --global
```

## License

[MIT](LICENSE).
