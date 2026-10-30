# @one-switch/cli

Run [OSW](https://github.com/yinxulai/osw) from a terminal: a local proxy that puts every LLM channel you own behind one address, with ordering, failover and request logs.

OSW is short for **One Switch**. The desktop app lives in the same repository; this package is the command-line host and drives the exact same service, the exact same data and the exact same SQLite files. Only the way it is started differs.

## Requirements

Node.js **>= 22**. The CLI stores data in SQLite via the built-in `node:sqlite` module, so there is no native dependency to compile — and no fallback: on an older Node it prints an upgrade hint and exits.

## Usage

```sh
npx @one-switch/cli            # same as `osw start`
npm install -g @one-switch/cli # installs the `osw` command
```

| Command | Description |
| --- | --- |
| `osw start` | Start the proxy and the management service; `--web` also serves the console |
| `osw stop` | Stop the instance started by this CLI |
| `osw status` | Print state, listen addresses, data directory and version; `--json` for machine-readable output |
| `osw version` | Print the version (same source as `--version`) |

With no subcommand, `osw` behaves like `osw start`. `Ctrl+C` triggers a graceful shutdown. Exit codes are fixed: `0` success (including "was not running"), `1` runtime failure, `2` usage error.

The data directory is `~/.osw` (`~/.osw-development` in development builds), shared with the desktop app. One instance per data directory: `start` refuses to run a second one rather than taking over an existing listener and its database.

## Notes

- The console is served from the same port as the management API; `--no-web` turns hosting off but keeps the API.
- When listening on a non-loopback address the CLI warns on stderr — the **proxy** port has no authentication, so anyone on the LAN can read and write through it. Use `custom` outbound proxy settings if you need one; the CLI has no OS proxy resolution.
- Diagnostics (`--json` payloads excluded) stay in English on stderr so stdout remains parseable.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — required notice: Copyright (c) 2026 yinxulai (https://github.com/yinxulai/osw).
