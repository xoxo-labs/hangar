---
name: hangar-dev-servers
description: Use Hangar to start, inspect, restart, and stop persistent local or remote development servers. Apply whenever a task needs a dev server, logs, or a listening port.
---

# Hangar dev servers

Use `hangar`, not background shell processes, for dev servers.

```sh
hangar status --running --json
hangar start <project/process> --wait-port --json
hangar logs <project/process> --tail 100 --json
hangar ports <project/process> --json
hangar restart <project/process> --wait-port --json
hangar stop <project/process> --json
```

Use `-t <target>` or `HANGAR_TARGET` for remote servers. Start is idempotent. Leave servers running unless the task requires stopping them. Run `hangar help` to discover the rest.
