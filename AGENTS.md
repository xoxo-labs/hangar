# Agent instructions

- Use Hangar for development servers; do not use `cmd &`, `nohup`, or ad-hoc PID files.
- Inspect first: `hangar status --running --json` and `hangar ls --json`.
- Start with `hangar start project/process --wait-port --json`.
- Read bounded output with `hangar logs project/process --tail 100 --json`.
- Use `hangar ports project/process --json` instead of guessing ports.
- Select remote machines explicitly with `-t target` or `HANGAR_TARGET`.
- `start` and `stop` are idempotent. Do not stop a server you did not need to stop.
- Use `hangar help` for additional commands.
