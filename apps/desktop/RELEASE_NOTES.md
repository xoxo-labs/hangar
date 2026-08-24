# Hangar 0.10.0

## Session history you can curate

- Any archived run can now be deleted — an ✕ on its row in History, or the Delete run button on the run's own page. Deleting forgets the run and its captured terminal output; log files on disk are yours and stay where they are.
- A run's resource timeline now loads when you open that run instead of riding along with every state update, so a long history stops weighing on every connected window.

## Grow a project without opening the editor

- **Add process…** — from the + on a project's sidebar row or its context menu — opens a small dialog: the package.json scripts you haven't added yet (monorepo-aware, filterable), one click each; a custom command row; and the empty-terminal shortcut, now somewhere you can see it.
- Processes and projects can be deleted from their context menus. The confirmation says exactly what happens — the entry goes, everything on disk stays — and ⇧-clicking the menu item skips it once you know. Accumulated terminal entries finally have a way out.
- The project editor had a visual pass: detected scripts fold to one line while editing, the process list is one titled group — *What this project runs* — with its add actions in the header, and the browser preference no longer interrupts the flow between them.

## An update you can actually see

- The sidebar's update control grew from a 30-pixel icon into a labeled pill: *Update available*, *Downloading (42%)*, *Restart to update*. It can be dismissed until the next launch — though never a download in flight or a staged install, which you asked for.

## The sharing window tells the truth about the proxy

- The Tailscale address is a direct address, and now reads that way: **Direct**, like the local network. Only a port bound to localhost shows **Needs proxy** — the one case where the proxy genuinely is the fix, and the only case where its button insists. Everywhere else it is a quiet option.
- When Tailscale is missing, stopped or logged out, publishing explains itself in place — installed-or-not, and what to do — instead of a disabled button with a hover tooltip.

## Quieter and steadier underneath

- A phone that wandered off mid-build no longer grows the server's memory without bound; heavy terminal output stopped churning allocations; closing a history tab releases its replay buffer.
- The desktop shell restarts a crashed server instead of sitting on "connecting…" forever, and after an update it replaces a stale leftover server rather than silently driving the previous version. Updates now visibly apply.
- Closing the main window while Help stayed open could crash the menu and strand the app with no way back; fixed, and a dock click brings the window back.
- Native scrollbars are slim and match the rest of the app.

# Hangar 0.9.0

## Share a port with whoever you choose

- A detected port can now be published straight from its sharing window. **Public on the internet** gives you a link that works for anyone you send it to — no account, and nothing to install at the other end. It is the one thing in Hangar a stranger can reach, so it confirms before it goes live and stays marked wherever it appears.
- **Tailnet HTTPS** does the same over real HTTPS for machines on your own tailnet. It stays out of sight until you turn it on under Settings → Links, because it only makes sense on a tailnet you manage.
- Publishing proxies from the Tailscale edge into localhost, so a dev server bound to `127.0.0.1` becomes reachable without changing how you start it. That is the case the sharing window used to only warn about.
- A published port is withdrawn when its process ends and when Hangar quits. A restart is not an ending: the link survives the seam instead of being torn down and built again.

## Your Tailscale address, without rebinding the dev server

- The Tailscale reach can now switch on a bridge into localhost, so the `100.x` address you already had answers even when the server listens on loopback alone. The link you hand out is unchanged — only the way it gets there is new.
- It changes routing, not the origin the browser sees. If a login or an edge provider refuses a plain-IP address, Tailnet HTTPS with a proper hostname is still the answer.

## Every port you have open, in one place

- The status bar item used to appear only while something was shared, then vanish the moment it stopped. It is now a standing list of every port Hangar has open, grouped by machine, each one showing how far it reaches and offering a QR to pick it up on your phone.
- Because the item no longer comes and goes, its icon carries the warning instead: quiet when nothing is listening, plain while ports are open but private, amber the moment one is public.
- The count beside it tracks shared ports rather than open ones, so a dev server restarting all day never makes it flicker. Any row can stop its own share, and once more than one port is public there is a single control to stop them all.

## Settings, sharing and the tour share one shape

- Settings is no longer one long scroll. Categories run down the left and the panel beside them shows one at a time.
- The sharing window follows suit: the reaches are a list on the left, and the QR, the link and its on/off button hold still on the right while you move between them. Warnings keep their space rather than shifting the content when something goes live.
- The first-run tour is two panes as well, its steps down the side doubling as a map of how much is left. Replaying it for one thing no longer means clicking past everything else — and a new step covers publishing, including what Tailscale adds.

# Hangar 0.8.0

## Open a project straight from Spotlight

- Links like `hangar://project/lust` now reach Hangar: the window comes forward and the project is selected, exactly as if you had clicked it in the sidebar. Opening never starts anything — that is still the play button's job.
- A link that arrives while Hangar is starting up waits for the window instead of being dropped, so a link can be what launches the app.

## The command palette knows what a process is doing

- Choosing Stop for a process that had already exited used to ask you to confirm terminating it, then send the stop anyway. Actions are now resolved against the current state at the moment you press Enter, and one whose outcome already happened quietly does nothing.
- For a running process, Restart comes before Stop, so a fast Enter lands on the harmless one.

## Groundwork: Spotlight and Shortcuts

- The App Intents surface — searching your projects, starting a process by voice or from Shortcuts — now builds as an extension inside Hangar itself, instead of only working through a development host. It is not enabled in this build: shipping it needs a provisioning profile that is still being set up, and an extension that ships without one looks installed while quietly failing to read anything.

# Hangar 0.7.0

## Update from the sidebar

- An update now arrives as a button you can act on, not a banner telling you to go open Settings. Click the download arrow to fetch it, watch the ring around it fill as it downloads, then click again to restart into the new version.
- It is only there when there is something to do, and Settings keeps the full update row for checking on demand.

## Commands find the tools your terminal finds

- A process whose runtime comes from nvm, fnm, volta or asdf could fail to start with `command not found`, even though the same command worked in your terminal. Those tools install themselves into `.zshrc`, which the shell Hangar used was never reading. Commands now run the way your terminal runs them.

# Hangar 0.6.1

## The disk image is notarized too

- 0.6.0 signed and notarized the app, but not the disk image wrapped around it — and macOS checks a downloaded image on its own, before you ever reach the app inside. The DMG now carries its own notarization ticket, so nothing along the way asks whether you are sure.

# Hangar 0.6.0

## Signed by a known developer

- Hangar is now Developer ID–signed and notarized by Apple. Downloading it and double-clicking is all there is to it: no right-click-to-open, no `xattr` incantation, no "unidentified developer" dialog.
- Automatic updates work properly for the first time. macOS validates the signature of an incoming update before installing it, which unsigned builds could never satisfy.

## An icon of its own

- Hangar has real artwork on every surface it shows up: the Dock and the DMG, the iOS and Android home screens, the browser tab and the web app when you add it to a home screen. It replaces Electron's default, Expo's placeholder, and a lone favicon.

## Smaller things

- Install the CLI without the app: `npm i -g @xoxo-labs/hangar` gives you `hangar` on a machine that has no display, which is what a container or an agent box usually is.
- When a session dies because its port was already taken, Hangar now names the process holding it instead of leaving you to hunt for it.

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
