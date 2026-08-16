# @xoxo-labs/hangar

Supervisor for development servers. Register a project once, start its processes
from anywhere, and let them outlive the terminal — or the coding-agent command —
that started them.

This package is the `hangar` CLI and the server it talks to: the same program.
The desktop app ([Hangar for macOS](https://github.com/xoxo-labs/hangar/releases/latest))
bundles this server plus a terminal UI; installed from npm you get the CLI, the
HTTP/WebSocket API, and no window.

## Install

```sh
npx @xoxo-labs/hangar status        # no install
npm install -g @xoxo-labs/hangar    # then: hangar status
```

Requires Node ≥ 24. `lsof` enables port detection and `ps` enables resource
metrics; both degrade to nothing when absent.

Terminals come from [node-pty](https://github.com/microsoft/node-pty), which
ships prebuilt binaries for macOS and Windows. On Linux it compiles at install
time, so the install script has to run — with npm ≥ 11 that means
`npm install -g @xoxo-labs/hangar --allow-scripts node-pty`, plus `python3`,
`make` and a C++ compiler on the machine. Without it the server still starts and
answers, but no session can spawn.

## Use

```sh
hangar add web ~/code/site --cmd "dev=pnpm dev"
hangar start web/dev --wait-port     # blocks until it is actually listening
hangar status --running
hangar logs web/dev --tail 100
hangar ports web/dev
hangar stop web/dev
```

Lifecycle commands are idempotent, and `--json` gives every command a stable
envelope for scripts and agents.

A process that dies because its port was taken says so, rather than leaving you
an exit code:

```
web/dev  exited pid:256 exit:1  port 3000 is held by pid 98910 (node), which hangar does not manage
```

## Serving

Any command starts a local server if none is running. Run it yourself when you
want to own the process or bind it somewhere other than loopback:

```sh
hangar serve                              # 127.0.0.1:4780
hangar serve --host "$(tailscale ip -4)"  # reachable on the tailnet only
```

Remote machines are paired explicitly and addressed with `-t`:

```sh
hangar target pair-code                          # on the machine being managed
hangar target add studio 100.x.y.z:4780 --code -
hangar -t studio status
```

Full documentation: [CLI](https://github.com/xoxo-labs/hangar/blob/main/docs/CLI.md) ·
[remote machines](https://github.com/xoxo-labs/hangar/blob/main/docs/REMOTE.md)

MIT © XOXO Labs
