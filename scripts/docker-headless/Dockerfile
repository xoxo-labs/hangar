# Hangar headless smoke-test image.
#
# Runs `hangar serve --host 0.0.0.0` on Linux so the headless/remote path (bind
# to a non-loopback address, serve the built web UI, pair a CLI over the
# network, spawn PTY sessions) can be exercised away from macOS. The container
# is a stand-in for a "remote machine": pair to it from the host CLI and drive
# it with `hangar -t <name> ...`.
#
# Build (context is the repo root, not this directory):
#   docker build -f scripts/docker-headless/Dockerfile -t hangar-headless-test .
#
# Run (host port 4977 -> container 4780; 8091 published 1:1 for the demo below,
# because a detected port is opened as <machine host>:<that same port>):
#   docker run -d --name hangar-headless -p 4977:4780 -p 8091:8091 hangar-headless-test
#
# Test from the host:
#   curl -s http://127.0.0.1:4977/health                  # -> ok
#   curl -s http://127.0.0.1:4977/ | head                 # -> web UI index.html
#   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4977/api/state
#                                                         # -> 401 (non-loopback needs a token)
#   docker logs hangar-headless                           # listening / web ui / pair hint
#   docker exec hangar-headless cat /root/.hangar/server-runtime.json
#
#   # Pair the host CLI with the container (loopback inside the container is trusted):
#   CODE=$(docker exec hangar-headless node apps/server/src/cli.ts --json target pair-code \
#          | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).data.pairing.token))')
#   export HANGAR_CLI_CONFIG=/tmp/hangar-targets.json     # never touch ~/.hangar/targets.json
#   echo "$CODE" | node apps/server/src/cli.ts target add dockerbox 127.0.0.1:4977 --code -
#   node apps/server/src/cli.ts -t dockerbox --json ls
#
#   # Supervise a process inside the container:
#   docker exec hangar-headless mkdir -p /tmp/demo
#   node apps/server/src/cli.ts -t dockerbox add demo /tmp/demo \
#     --cmd "web=python3 -m http.server 8091 --bind 0.0.0.0"
#   node apps/server/src/cli.ts -t dockerbox start demo/web --wait-port=8091 --json
#   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8091/   # -> 200
#   node apps/server/src/cli.ts -t dockerbox status --json
#   node apps/server/src/cli.ts -t dockerbox logs demo/web --tail 20
#   node apps/server/src/cli.ts -t dockerbox stop demo/web
#
# Known Linux gap this image papers over: the server's shell fallback is
# /bin/zsh (sessions.ts:273), which no container image ships — see the ENV
# SHELL line below.
#
# Cleanup:
#   docker rm -f hangar-headless
#   docker rmi hangar-headless-test
#   rm -f "$HANGAR_CLI_CONFIG"
#
# Dev remotes: docker-compose.yml beside this file runs two of these as
# stand-in remote machines (`pnpm dev:remotes`); see README.md.

FROM node:24-bookworm-slim

# lsof: session port detection (apps/server/src/sessions.ts listeningPorts).
# procps: `ps -axo ...` for CPU/RSS metrics (sessions.ts sampleMetrics).
# build-essential + python3: node-gyp toolchain for node-pty's native build.
# git: not used by the server itself (git.ts reads .git/config directly), but
#   supervised projects normally need it, and it lets the test create a repo
#   whose origin the state broadcast should resolve.
# python3 also doubles as the demo process (`python3 -m http.server`).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        git \
        lsof \
        procps \
        python3 \
    && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

WORKDIR /app

# Excludes live in scripts/docker-headless/Dockerfile.dockerignore (BuildKit
# reads "<dockerfile>.dockerignore" in preference to the context-root file), so
# macOS-native node_modules, .git and apps/desktop/release never enter the image.
COPY . .

# pnpm 10 blocks dependency build scripts unless they are allow-listed, but this
# repo already lists node-pty (and electron) under `onlyBuiltDependencies` in
# pnpm-workspace.yaml, so node-pty's native build runs unattended. The filter
# keeps apps/desktop (and its ~100MB electron download) out of the image; the
# trailing "..." pulls in each app's workspace dependencies.
RUN pnpm install --frozen-lockfile --filter @xoxo-labs/hangar... --filter @hangar/web...

# Fail loudly here rather than at spawn time if the allow-list ever regresses:
# without the native build every session dies with "Cannot find module pty.node".
RUN node -e "const{createRequire}=require('node:module');const p=createRequire('/app/apps/server/').resolve('node-pty');require(p);console.log('node-pty native build OK')"

# The server serves apps/web/dist as the SPA (apps/server/src/webui.ts resolveWebRoot).
RUN pnpm --filter @hangar/web build

# WORKAROUND, not a preference: apps/server/src/sessions.ts:273 spawns sessions
# with `process.env.SHELL ?? "/bin/zsh"`. Containers (and most Linux daemons)
# start with SHELL unset and no zsh installed, so every spawn dies instantly
# with `execvp(3) failed.: No such file or directory` and exit code 1. Setting
# SHELL here keeps the test image usable; the fallback itself should become a
# platform-aware probe (SHELL -> /bin/bash -> /bin/sh on Linux).
ENV SHELL=/bin/bash

ENV HANGAR_HOME=/root/.hangar
# 4780 is the server; 8091/8092 are the demo web processes the compose file
# publishes 1:1 (see docker-compose.yml).
EXPOSE 4780 8091 8092
CMD ["node", "apps/server/src/cli.ts", "serve", "--host", "0.0.0.0", "--port", "4780"]
