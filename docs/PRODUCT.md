# Hangar — product overview

Hangar is a Mac control room for local dev servers. You register projects, start
exactly the processes you need, watch their resource usage live, and open or
share any port they listen on. It is built for people who run the same handful
of dev servers every day — and for coding agents, which manage the same registry
through the `hangar` CLI.

This doc is the canonical description of what Hangar does and how we talk about
it. Architecture and dev setup live in the [README](../README.md).

## What it is / what it isn't

- A **launcher and monitor** for processes you already run, not a process
  supervisor. Nothing starts unless you (or your agent) ask.
- **Your folders, not clones**: registering a project just points Hangar at a
  path that already exists on the machine. Nothing is cloned, copied, or moved.
- **Open source** (MIT), launched macOS-first. Source and downloadable builds:
  <https://github.com/xoxo-labs/hangar>.
- **Local-first**: the server binds `127.0.0.1` only. "Remote" today means
  shareable *links* to your dev servers over LAN or Tailscale — not remote
  access to Hangar itself. (Remote control is on the roadmap, see below.)
- **Opt-in persistence**: session history and terminal logs are off by default.
  Live metrics are kept in memory only. Everything that is persisted stays on
  disk, under the user's control, with retention settings.

## Features — canonical wording

| Feature | What it means |
|---|---|
| **Start what you need** | Projects group their processes; start/stop/restart one or all. Clicking a process opens a *pending tab* without starting anything — ▶ is what starts it. New projects are inspected from `package.json` (scripts, package manager). |
| **Live resource usage, warnings surfaced** | CPU, memory, process count, and output rate sampled every 2 s across the whole process tree, with session peaks. High CPU (>80%) is flagged amber in the sidebar, tabs, session strip, and inspector. |
| **Metrics synced to output** | Click a point on a chart → the terminal scrolls to the line it was printing at that moment. Select terminal output → the matching time range highlights on all charts. Fixed-window ranges: 5 m / 15 m / 1 h / full session. |
| **Copy-friendly terminal** | Copy on select (default on), copy last 50/100 lines, copy all output, per-session log reveal. |
| **Ports, detected** | Listening ports found automatically across the process tree; one click opens them in the browser of your choice (system, Safari, Chrome, Arc, Firefox, Brave, Edge). |
| **Shareable port links (LAN / Tailscale)** | Copy a link another device can open — LAN for same-Wi-Fi, Tailscale for the tailnet, or a custom host. Loopback-only binds get a warning with the exact fix (`--host 0.0.0.0`). |
| **Unified search (⌘K)** | One palette across processes, per-process and per-project actions, archived runs, and app commands. Plus sidebar filtering and history search. |
| **Session history, opt-in** | Archived runs with outcome, duration, peaks, a downsampled resource timeline, and an ANSI replay you can *rewind* — scrubbing the timeline truncates the replay to that moment. |
| **Terminal logs, opt-in** | Raw output to disk with directory, retention, max-size, and format controls. Surfaced with a secrets warning. |

Wording to avoid:

- ~~"remote access"~~ → say **shareable links** / **open on your phone**. Hangar
  itself is not remotely reachable.
- ~~"scrollable synced usage"~~ → say **metrics synced to output** or
  **scroll-synced charts and terminal**.

## Naming

Lowercase **hangar** for the in-app wordmark, CLI, and browser title.
Capitalized **Hangar** for the product, the macOS app, and the server identity
(About, status bar, release notes).

## Principles

- Destructive actions (stop, restart, close-while-running) always confirm.
- Keyboard-first: ⌘K palette, ⌘I inspector, ⌘, settings, ⌘⇧K clear terminal;
  holding ⌘ reveals keycap hints on controls.
- Defaults are quiet: no logging, no history, no telemetry, nothing persisted
  beyond the registry and settings until the user opts in.

## Roadmap

- **Remote control** — act on sessions (start/stop/restart) from another device,
  not just open their ports. Requires deliberately widening the server's
  localhost-only bind; treat as a security-sensitive change.
- **Windows build** — the Electron shell and web UI package fine, but the server
  is Darwin/Unix-specific and needs a platform layer before a Windows build is
  honest: `$SHELL -lc` login shells (→ PowerShell/cmd), `ps -axo` metrics
  sampling (→ `Get-Process`/WMI), process-group `kill(-pid)` (→ `taskkill /T`),
  `lsof` port detection (→ `Get-NetTCPConnection`), and `/usr/bin/open -a`
  browser launching (→ `Start-Process`). Until then, macOS is the only target.

## Elsewhere

- Site page: `xoxo-labs/client-web` → `/open-source/hangar`.
- Releases: GitHub Actions builds a DMG on every `v*` tag and attaches it to the
  GitHub release (`.github/workflows/release.yml`).
- In-app tutorial: first-run tour, dismissable, replayable from Settings → About
  and the ⌘K palette (`onboarding.tutorialSeen` in settings).
