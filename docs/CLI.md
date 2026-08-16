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

Lifecycle commands are safe to repeat:

```sh
hangar restart lust/web --wait-port
hangar stop lust/web
```

Use `--json` for scripts and coding agents. `logs --follow --json` produces JSONL.

## Remote servers

On the Mac running Hangar, enable remote connections and create a pairing code:

```sh
hangar target pair-code
```

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
