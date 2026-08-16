# Hangar 0.5.0

## Drive Hangar from the terminal

- A `hangar` command now controls your supervised processes from any terminal, and from coding agents: `hangar ls`, `start`, `stop`, `restart`, `status`, `logs` and `ports`, against the local Mac or any paired one with `-t <machine>`.
- `hangar start lust/web --wait-port` returns only once the server is actually listening, so a script never races a slow boot. `--json` everywhere, and `logs --follow --json` streams JSONL.
- Install it from **Hangar → Install Command Line Tool…**. It lands in Homebrew's bin directory, `/usr/local/bin`, or `~/.local/bin` — whichever your account can write to.

## A Mac with no display

- `hangar serve --host <addr>` binds Hangar where you point it — a Tailscale address is the safe choice — and serves the full web UI from that same port. Open `http://<host>:4780` in any browser and you have a complete client, no app installed on that machine.
- `hangar target pair-code` prints a QR next to the pairing string, so a phone can join a headless host by scanning it.
- Hangar behind NAT or in a container can be told the address that actually answers, and hands that out everywhere: pairing strings, QRs, and the links you open for detected ports.

## Ports open where they answer

- Opening a detected port and copying its link used to disagree about the address. Both now follow one per-machine setting, renamed to **Reach ports at** because it no longer governs copying alone.
- Automatic still tells the two apart on purpose: a copied link prefers your Tailscale or LAN address, since you are handing it to another device, while opening uses the host you already reach that machine on.

## Paired machines in the sidebar

- Right-click a machine header to rename it, retry a stalled connection, or remove it.
- A machine that has never connected keeps its header, so those actions stay available instead of vanishing with its empty project list.

# Hangar 0.4.0

## Connections: pair your Macs

- Hangar can now accept paired connections from your other machines. Turn it on in Settings → Connections, generate a one-time pairing code (shown as a code, a paste-friendly string, and a QR), and enter it on the other Mac.
- Connections are protected end to end: single-use pairing codes that expire in five minutes, per-client session tokens you can revoke at any time, and a server that stays loopback-only until you explicitly opt in. Traffic is plain HTTP on your network — Tailscale is the recommended way to reach a Mac across networks.
- The sidebar groups projects by machine, every process runs in its own machine's context, and detected port links open on the right host. The command palette labels entries by machine, and new projects can be created on any connected Mac.

## Same repo, one card

- When the same repository lives on more than one connected machine (matched by its git origin), the sidebar merges it into a single project card with a section per machine — local and paired actions side by side.

## Mobile companion

- A new companion app for iPhone and iPad lives in the repository: pair by scanning the QR, watch live process output in color, start and stop processes, and switch machines' addresses on the go. On iPad it opens into a split layout with the session pane alongside the list.

## Quality of life

- The project editor's detected-scripts list gains a search filter once a folder yields more than five scripts — monorepos cumulate root and workspace scripts quickly.

# Hangar 0.3.1

## Clearer session endings

- Exited tabs and the terminal status strip now show the exit code explicitly.
- Every exit writes a persistent status line to the terminal, including after reconnecting.
- Resource charts clearly switch from live sampling to their last recorded values; stale ports and live metrics are hidden after exit.
- Restarted processes begin a fresh resource timeline without losing their terminal scrollback.

## Project actions and links

- Projects and processes now have context menus for common start, stop, restart, edit, and rename actions.
- Browser preferences can be overridden per project or process when opening detected local ports.

# Hangar 0.3.0

## Automatic updates

- Hangar now checks GitHub Releases for new versions: a banner appears under the project list, and Settings → About gains download and install controls.
- Nothing happens without you: you choose when to download and when to restart. Running processes are stopped cleanly before the app restarts into the new version.

## Process descriptions

- Every process can carry a note about what it does — edit it in the session inspector; it shows in tooltips and when editing the project.

## Windows

- Release notes and the help & shortcuts guide now open in their own windows instead of workspace tabs.

# Hangar 0.2.0

## Smarter project setup

- Adding a project now starts from a native folder picker, with manual entry one click away.
- Hangar reads package.json and pnpm-workspace.yaml workspaces and lists every package's scripts, grouped per package, when you add or edit a project.

## Help & shortcuts

- New Help dialog covering the UI and every keyboard shortcut — open it from the sidebar, the command palette, or the macOS Help menu.
- ⌘W closes the active tab (release notes, history, or session) instead of the window; hold Shift to skip the running-session confirmation.

## Interface

- The sidebar is resizable — drag its edge or use the arrow keys on the divider; the width is remembered.
- Sidebar row actions now float over the row's edge, so project and process names use the full width and fade out only where they truncate.
- First-run tutorial refined to match the real UI.

# Hangar 0.1.0

## First packaged release

- Standalone macOS application with its own server runtime.
- Project and process launcher with live terminal sessions.
- Session history, replay, resource metrics, and terminal logging.
- Configurable appearance, terminal fonts, links, and retention.
- Native macOS folder picker and Finder/browser integrations.
- Draggable workspace tabs, closable History, and in-app release notes.
