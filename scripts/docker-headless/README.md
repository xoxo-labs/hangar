# Dev remotes

Two Linux containers, each running a Hangar server, standing in for remote
machines while you develop the multi-machine parts of the app (target pairing,
the connections UI, grouped projects, mobile scanning). They share the image
built by `Dockerfile` in this directory — the same one used for headless
smoke tests — and are wired up by `docker-compose.yml` and `dev-remotes.sh`.

| service    | container      | Mac URL                 | demo port | demo projects                    |
| ---------- | -------------- | ----------------------- | --------- | -------------------------------- |
| `hangar-a` | `hangar-dev-a` | <http://127.0.0.1:4795> | 8091      | `a-ticker`, `a-web`, `a-crasher` |
| `hangar-b` | `hangar-dev-b` | <http://127.0.0.1:4796> | 8092      | `b-ticker`, `b-web`, `b-crasher` |

Your own Hangar is untouched: the app keeps `4780`, `pnpm dev` keeps `4781`,
and `~/.hangar` is never mounted into a container. Each container keeps its own
state in a named volume mounted at `/root/.hangar`.

## The three scripts

```sh
pnpm dev:remotes        # build if needed, start both, wait for /health
pnpm dev:remotes:pair   # a fresh pairing string + QR for each container
pnpm dev:remotes:down   # stop and remove the containers; state volumes survive
```

`dev:remotes` picks the address the containers advertise: `tailscale ip -4` if
Tailscale is up, else `ipconfig getifaddr en0`, else `127.0.0.1` with a warning
(nothing but the Mac can reach that). Override it by exporting
`HANGAR_ADVERTISE_HOST` before the command.

That address matters because a container only sees its bridge IP, which nothing
outside Docker can dial. `HANGAR_ADVERTISE_HOST` / `HANGAR_ADVERTISE_PORT` make
the startup banner, pairing codes and QRs advertise `<your-ip>:4795` (and
`:4796`) instead — the published Mac ports — while the server itself binds
`0.0.0.0:4780` inside the container.

Extra arguments pass through to `docker compose`, e.g.
`pnpm dev:remotes:down --volumes` to also discard the containers' state.

## Pairing

Pairing codes are single-use and expire in five minutes, and minting a new one
invalidates the previous one — run `pnpm dev:remotes:pair` once per device,
right before you pair it.

- **Dev web UI / desktop app**: copy the `host:port#CODE` line and paste it into
  Settings → Connections → add a connection.
- **Phone**: scan the QR printed under the line (it encodes the same string).
  The phone must be able to reach the advertised address — same LAN, or both
  ends on the tailnet.
- **CLI**:

  ```sh
  export HANGAR_CLI_CONFIG=/tmp/hangar-dev-targets.json   # keep ~/.hangar/targets.json clean
  CODE=$(docker exec hangar-dev-a node apps/server/src/cli.ts --json target pair-code \
    | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).data.pairing.token))')
  echo "$CODE" | node apps/server/src/cli.ts target add devremote-a 127.0.0.1:4795 --code -
  node apps/server/src/cli.ts -t devremote-a --json ls
  ```

Paired tokens live in the container's volume, so they survive
`docker compose restart` and `pnpm dev:remotes:down` — no re-pairing.

## Demo projects

`entrypoint.sh` seeds `$HANGAR_HOME/projects.json` on first boot only, so
projects you add later survive restarts. Each container gets a prefixed set
(`a-` vs `b-`) so the two are distinguishable in a grouped UI:

- `*-ticker/tick` — prints the date every 2s; a session that stays running.
- `*-web/http` — `python3 -m http.server` on the container's demo port (8091 for
  `a`, 8092 for `b`); exercises port detection (`start a-web/http
  --wait-port=8091`) and the open/copy link path.
- `*-crasher/boom` — exits 1 immediately; exercises the exited/failed path.

To reseed, discard the volumes: `pnpm dev:remotes:down --volumes`.

## Why the demo ports differ

The UI opens a detected port at `<the machine's host>:<the detected port>` — the
port number a session reports is assumed to be the one that answers from
outside. Docker only honours that if the port is published **1:1**, so the two
containers cannot both use 8091: they'd need different Mac ports, and the link
for whichever got remapped would point at nothing. Each container therefore
publishes its own demo port unchanged (`8091:8091`, `8092:8092`), set by
`HANGAR_DEMO_PORT`.

The same caveat applies to any process you add yourself: a port that isn't
published by `docker-compose.yml` is reachable only from inside the container,
however correctly the UI detects it. `/network-info` reports the container's
docker-bridge address (`172.x`), which macOS cannot route either — so with
share-host on `auto` the link falls back to the connection's host. Set the
connection's share host to **custom** → `127.0.0.1` if you want the copied link
to match what you dial from the Mac.

## Editing server code

`apps/server/src`, `packages/contracts/src` and `packages/client-core/src` are
bind-mounted read-only over the image's copies, so your working tree is what the
containers run. Apply changes with:

```sh
docker compose -f scripts/docker-headless/docker-compose.yml restart
```

No rebuild needed — same for `entrypoint.sh`, which is mounted too. Rebuild
(`pnpm dev:remotes`, which passes `--build`) only when dependencies, the web UI
bundle or the Dockerfile change; the web UI is built into the image, not
mounted.

Nothing that would shadow `node_modules` is mounted: the image's Linux
`node-pty` build must not be replaced by the macOS one.

## Teardown

```sh
pnpm dev:remotes:down                              # containers only, state kept
pnpm dev:remotes:down --volumes --rmi local        # nuke state and the image too
```
