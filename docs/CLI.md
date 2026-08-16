# Hangar CLI

Hangar keeps development servers running outside the lifetime of a terminal or coding-agent command. Servers started from the CLI are the same sessions shown in the desktop, web, and mobile clients.

## Typical workflow

Find the configured project and process names:

```sh
hangar ls
hangar status --running
```

Start a server and wait until it listens on a port:

```sh
hangar start lust/web --wait-port
# Or require a particular port:
hangar start lust/web --wait-port=3000
```

Inspect it later:

```sh
hangar logs lust/web --tail 100
hangar ports lust/web
hangar status lust/web
```

When a process dies because its port was taken, Hangar says so instead of leaving you a bare exit code — in `status`, in `--wait-port` failures, and in the session's own output:

```sh
hangar status lust/web
# lust/web  exited pid:256 exit:1  port 3000 is held by pid 98910 (node), which hangar does not manage
```

The holder is named as a Hangar session when Hangar started it (`port 3000 is held by lust/api (pid 4120), started by hangar`), so a conflict between two of your own projects reads as one. With `--json` the same finding arrives as `exitDiagnosis`.

Lifecycle commands are safe to repeat:

```sh
hangar restart lust/web --wait-port
hangar stop lust/web
```

Use `--json` for scripts and coding agents. `logs --follow --json` produces JSONL.

## Running the server

Commands autostart a missing local server, so `hangar serve` is only needed when you want to own the process — or bind it somewhere other than loopback:

```sh
hangar serve                              # 127.0.0.1:4780
hangar serve --port 4781                  # the built-in dev target
hangar serve --host "$(tailscale ip -4)"  # reachable on the tailnet only
```

Bind precedence: `--host` → `HANGAR_HOST` → the connections setting (`0.0.0.0`) → `127.0.0.1`. Prefer a tailnet address over `0.0.0.0`.

The server also serves the built web UI on the same port, so `http://<host>:4780` is a complete client. See [docs/REMOTE.md](REMOTE.md#headless).

A running server records its bind address in `$HANGAR_HOME/server-runtime.json`. If a live server already owns the port but is bound to an address the CLI cannot reach over loopback, autostart stops and tells you to use `-t <host>:<port>` instead of spawning a second server on the same home directory.

## Remote servers

On the Mac running Hangar, enable remote connections and create a pairing code:

```sh
hangar target pair-code
```

On a TTY this also prints the code as a QR the mobile app can scan; `--json` output is unchanged.

On the client, keep the code out of shell history:

```sh
printf '%s' "$PAIRING_CODE" |
  hangar target add studio 100.90.1.5:4780 --code -
```

Then select that Mac explicitly:

```sh
hangar -t studio status
hangar -t studio start lust/web --wait-port
```

Set `HANGAR_TARGET=studio` to select it for the current shell. Tailscale is the recommended transport. A paired token can run project commands on that Mac and should be protected like an SSH credential.

## Installation and discovery

From the installed application, choose **Hangar → Install Command Line Tool…**. From a source checkout, run `cd apps/server && pnpm link --global`.

Run `hangar help` for the complete command list and options.
