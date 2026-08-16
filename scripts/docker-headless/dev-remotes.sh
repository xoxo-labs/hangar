#!/usr/bin/env bash
# Dev fixture: two Linux Hangar servers in containers, standing in for remote
# machines. Wired to `pnpm dev:remotes`, `dev:remotes:down`, `dev:remotes:pair`.
#
#   up    build + start hangar-a (4795) and hangar-b (4796), wait for /health
#   pair  mint a fresh pairing code (+ QR) on each container
#   down  stop and remove the containers; volumes survive unless --volumes
#
# Your own Hangar (4780) and `pnpm dev` (4781) are untouched.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -f "$here/docker-compose.yml")
ports=(4795 4796)
services=(hangar-a hangar-b)
# Pinned in docker-compose.yml so `docker exec` can address them directly.
containers=(hangar-dev-a hangar-dev-b)

# The containers advertise this address in banners, pairing strings and QRs;
# they cannot discover it themselves (they only see the docker bridge).
resolve_advertise_host() {
  if [[ -n "${HANGAR_ADVERTISE_HOST:-}" ]]; then
    echo "$HANGAR_ADVERTISE_HOST"
    return
  fi
  local ip=""
  if command -v tailscale >/dev/null 2>&1; then
    ip="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    echo "warning: no tailscale or en0 address found; advertising 127.0.0.1 (phones will not reach it)" >&2
    ip="127.0.0.1"
  fi
  echo "$ip"
}

wait_for_health() {
  local port="$1" deadline=$((SECONDS + 120))
  until curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "timed out waiting for http://127.0.0.1:$port/health" >&2
      return 1
    fi
    sleep 1
  done
}

cmd_up() {
  HANGAR_ADVERTISE_HOST="$(resolve_advertise_host)"
  export HANGAR_ADVERTISE_HOST
  echo "advertising $HANGAR_ADVERTISE_HOST to paired clients"
  "${compose[@]}" up -d --build "$@"
  for port in "${ports[@]}"; do
    wait_for_health "$port"
  done
  cat <<EOF

dev remotes are up:
  hangar-a  http://127.0.0.1:4795   (advertised: http://$HANGAR_ADVERTISE_HOST:4795)
  hangar-b  http://127.0.0.1:4796   (advertised: http://$HANGAR_ADVERTISE_HOST:4796)

  demo web processes are published 1:1 — a-web/http on 8091, b-web/http on 8092.
  A port that compose does not publish stays inside its container, however
  correctly the UI detects it.

  pnpm dev:remotes:pair        pairing string + QR for each (single-use, 5 min)
  pnpm dev:remotes:down        stop them; state in the volumes survives
  docker compose -f scripts/docker-headless/docker-compose.yml restart
                               reload the mounted server sources
EOF
}

cmd_pair() {
  for i in "${!services[@]}"; do
    local service="${services[$i]}" port="${ports[$i]}" container="${containers[$i]}"
    echo "=== $service (host port $port) ==="
    # The QR is TTY-only (cli.ts pair-code). `docker exec -t` allocates one
    # unconditionally; `docker compose exec -t` silently drops it when the
    # script's own stdout is a pipe, and then only the one-line form prints.
    docker exec -t "$container" node apps/server/src/cli.ts target pair-code
    echo
  done
}

cmd_down() {
  "${compose[@]}" down "$@"
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  pair) shift; cmd_pair "$@" ;;
  down) shift; cmd_down "$@" ;;
  *)
    echo "usage: $(basename "$0") <up|pair|down> [extra compose args]" >&2
    exit 2
    ;;
esac
