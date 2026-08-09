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
