#!/bin/sh
# Seeds a fresh dev-remote container with demo projects, then hands off to the
# server. Mounted (not COPYd) by docker-compose.yml so editing it costs a
# `docker compose restart`, not an image rebuild.
#
# The registry is only written when it is missing, so projects added from the UI
# or the CLI survive restarts; delete the volume (`down --volumes`) to reseed.
set -eu

HANGAR_HOME="${HANGAR_HOME:-/root/.hangar}"
# Distinguishes the two containers' projects in a grouped UI: a-ticker vs b-ticker.
prefix="${HANGAR_DEMO_PREFIX:-demo}"
# Published 1:1 by docker-compose.yml, so the port the UI detects inside the
# container is the same one that answers on the Mac.
demo_port="${HANGAR_DEMO_PORT:-8091}"
registry="$HANGAR_HOME/projects.json"

# Session spawn refuses a project whose path is missing (sessions.ts start()).
mkdir -p "$HANGAR_HOME" /srv/demo/ticker /srv/demo/web /srv/demo/crasher

if [ ! -f "$registry" ]; then
  # Registry format version 1 (packages/contracts Registry/Project). Commands run
  # through `$SHELL -lc`, so plain shell syntax is enough — no `sh -c` wrapper.
  cat > "$registry" <<JSON
{
  "version": 1,
  "projects": [
    {
      "name": "$prefix-ticker",
      "path": "/srv/demo/ticker",
      "processes": [
        {
          "name": "tick",
          "cmd": "while true; do date; sleep 2; done",
          "description": "Prints the time every two seconds; a long-running session that never exits on its own."
        }
      ]
    },
    {
      "name": "$prefix-web",
      "path": "/srv/demo/web",
      "processes": [
        {
          "name": "http",
          "cmd": "python3 -m http.server $demo_port --bind 0.0.0.0",
          "description": "Static server on $demo_port; exercises port detection (--wait-port) and the open-link path."
        }
      ]
    },
    {
      "name": "$prefix-crasher",
      "path": "/srv/demo/crasher",
      "processes": [
        {
          "name": "boom",
          "cmd": "echo boom; exit 1",
          "description": "Exits 1 immediately; exercises the exited/failed status path."
        }
      ]
    }
  ]
}
JSON
  echo "seeded $registry with $prefix-ticker, $prefix-web (port $demo_port), $prefix-crasher"
fi

exec "$@"
