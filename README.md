<p align="center">
  <img src="./docs/design/brand/png/icon-256.png" width="128" height="128" alt="OSW" />
</p>

<h1 align="center">OSW</h1>

<p align="center">
  <strong>Put every LLM channel you own behind one local address. When one goes down, the next one takes over.</strong>
</p>

<p align="center">English | <a href="./README.zh-CN.md">简体中文</a></p>

OSW runs a proxy on your machine. You register all the channels you have — different providers, different accounts, different models — put them in the order you want them tried, and point every AI client at a single local address. From then on it does the work: identify the protocol, pick a channel, send the request, move on when a channel fails, and record exactly what happened.

Your client only ever sees the attempt that succeeded.

**OSW is short for One Switch.** The name is the product: one switch for every channel you own — one local address going in, one place to configure providers, and one handle to flip when a channel breaks.

## What we believe

- **One entry point.** Clients only ever know one local address. Providers, accounts and models change behind it; nothing downstream ever has to be reconfigured again.
- **Failure is normal.** Network hiccups, connection timeouts, rate limits, exhausted quotas, dead keys, upstream 5xx — a broken channel is the expected case, not the exception. Keeping you running through it is the product's job, not yours.
- **Pass through by default.** No protocol parsing, no rewriting, no conversion unless you explicitly ask for it. The safest and fastest request is the one the proxy barely touches.
- **Local by default.** It binds `127.0.0.1`, keeps keys in the OS keychain, and sends requests to nobody but the upstreams you configured. No account, no cloud sync, no relay. The one exception is anonymous usage statistics, which are on by default and carry no request content — see [docs/product/telemetry.md](./docs/product/telemetry.md).
- **Everything is on the record.** Which provider, which model, which attempt finally succeeded, how long it took, how fast the first token arrived, how many tokens it cost — every request leaves a trace you can query.

---

## Install

Download the installer for your platform from the [latest release](https://github.com/yinxulai/osw/releases/latest). Every asset follows `OSW-<version>-<os>-<arch>.<ext>`, and each installer ships a matching `.sha256` file you can verify.

| Platform | Architecture | File to download |
| --- | --- | --- |
| macOS | Apple silicon | `OSW-<version>-mac-arm64.dmg` |
| macOS | Intel | `OSW-<version>-mac-x64.dmg` |
| Windows | x64 | `OSW-<version>-win-x64.exe` |
| Windows | ARM64 | `OSW-<version>-win-arm64.exe` |
| Linux | x64 | `OSW-<version>-linux-x86_64.AppImage` |
| Linux | ARM64 | `OSW-<version>-linux-arm64.AppImage` |

1. **macOS** — open the `.dmg` and drag **OSW** into *Applications*. Builds are ad-hoc signed and not notarized, so if macOS blocks the first launch, allow it under **System Settings → Privacy & Security**, or right-click the app in Finder and choose **Open**.
2. **Windows** — run the `.exe`. If SmartScreen warns about an unknown publisher, choose **More info → Run anyway**.
3. **Linux** — make the AppImage executable and run it:

   ```bash
   chmod +x OSW-*-linux-*.AppImage
   ./OSW-*-linux-*.AppImage
   ```

Once installed, OSW lives in the system tray and checks for updates itself. Windows and Linux download and install updates in place; on macOS the ad-hoc signature means it can only check for updates and open the DMG download page.

Next: [Up and running in three steps](#up-and-running-in-three-steps).

## Why it's worth installing

- **Configure once, use it everywhere.** Every client points at one local address. Swapping providers, accounts or models later means editing OSW, not hunting through each tool's settings.
- **Channels break; your work doesn't.** Network hiccups, connection timeouts, rate limits, exhausted quota, rejected keys and upstream 5xx all push the request to the next channel automatically. A response that has already started streaming is never spliced together from a second one — you get a failure instead of a Frankenstein answer.
- **Every request tells you the truth.** Which provider and model actually served it, which attempt succeeded, how long it took, how fast the first token arrived, tokens per second, how much of the prompt was cached — all of it stored and queryable.
- **Provider quirks without writing code.** Need to add a `User-Agent`, drop a header, or pin a field to `0.7`? Request rewrite rules do it, and the editor validates the change against a test case on the spot.
- **Your data stays on your machine.** Local listener on `127.0.0.1`, keys in the OS-encrypted store, no account, no cloud sync, no relay server. Requests only go to the upstreams you configured.
- **English and Chinese UI**, light / dark / follow-system themes, lives in the system tray, auto-launch at login, built-in updater.

## Screenshots

Logical models: drag to set priority, and every model carries its own recent track record.

![Logical models: channel queue with live metrics](./snapshot/en/01-logical-models.png)

Smart Routing: the header switches between a node graph and a plain rule table — two interchangeable modes for "which requests land in which channel group" — and every save is a version you can roll back.

![Smart Routing: node graph and request matching](./snapshot/en/02-smart-routing.png)

Request Logs: one row per request, expandable into the full execution detail and raw usage.

![Request Logs: per-attempt detail and usage](./snapshot/en/03-request-logs.png)

Analytics: success rate, latency, TTFT, TPS, cache hits, model ranking, failure reasons.

![Analytics: metric cards, usage distribution and model ranking](./snapshot/en/04-analytics.png)

Request Rewrite: stat cards, the rule list, and the templates behind **New rule**.

![Request Rewrite: rule list and template menu](./snapshot/en/05-request-rewrite.png)

## Up and running in three steps

### 1. Add a channel

Open **Model Management** → **New provider**. Fill in the name, API key, timeout, and the default endpoint for each protocol this provider speaks.

Then add the real model IDs under that provider (`gpt-4.1-mini`, `deepseek-reasoner`, `claude-sonnet-4`, …) and tick the protocols each one supports. A model that speaks several protocols still occupies a single row in the queue.

### 2. Order the queue

Go to **Logical Models** and drag the models you just added into the order you want them tried. Switch off whatever should sit out.

Things worth doing while you're here:

- Every row shows when that model last succeeded, how many consecutive failures it has, plus its TPS and TTFT — enough to decide who deserves to go first.
- Each logical model card has a **Failover** / **Manual** switch. In Manual mode the request is pinned to one upstream model: that row is marked as selected and the rest go on standby.
- To find out whether a channel actually works, use **Model Management** → **Connection test**, tick several channels and protocols and verify them concurrently. Each target receives one minimal real request, which may cost a little and will show up in the request logs.

### 3. Repoint your client

**Access Config** is a three-step guide: confirm the service is running, pick your client type, copy the address it asks for. Addresses are built from the current listener, and every one of them has a copy button.

| Your client | Base URL |
| --- | --- |
| OpenAI compatible (Chat Completions / Responses) | `http://127.0.0.1:9300/v1` |
| Anthropic | `http://127.0.0.1:9300` |

> ⚠️ The trap everyone falls into: Anthropic clients append `/v1/messages` themselves, so the Base URL **stops at the port**. Add `/v1` and the request becomes `/v1/v1/messages`, which the proxy does not recognise — you get a 404.

The model name is up to you: `default`, or any non-empty name. OSW swaps it for the real model ID of whichever channel it selects. If your client insists on an API key, any placeholder will do — the real keys are injected per provider.

Check that the service is alive:

```bash
curl http://127.0.0.1:9300/v1/models
```

The listener host and port live in **Settings → Network → Local Listener**; save and the proxy moves to the new port.

## Failover rules

| What happens upstream | What OSW does |
| --- | --- |
| Network error, connection timeout, streaming idle timeout | Try the next channel |
| `401`, `403` | Try the next channel, and count the failure against that provider |
| `408`, `429` | Try the next channel |
| `5xx` | Try the next channel |
| Any other `4xx` (a malformed request, say) | Returned to you as-is — another channel would not fix it |
| Breaks off after the response has started streaming to you | Aborts the request rather than splicing in another channel's output |

The defaults are 3 consecutive failures before a provider enters cooldown, a 30-second initial cooldown that grows with each failure up to 5 minutes, and a 30-second streaming idle timeout. All three live in **Settings → Reliability → Failover**.

## Supported protocols

| Protocol | Local path | Typical upstreams |
| --- | --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` | OpenAI, DeepSeek, Volcengine Ark, OpenRouter, Ollama — anything OpenAI compatible |
| OpenAI Responses | `/v1/responses` | Services that implement the Responses API |
| Anthropic Messages | `/v1/messages` | Claude and compatible services |

These paths are recognised with or without the `/v1` prefix. `GET /v1/models` is served locally and returns your model names; it is never forwarded upstream.

**About protocol conversion:** nothing is converted by default — requests pass through untouched, which is both the safest and the fastest behaviour. If you genuinely need a Claude client to talk to an OpenAI-only channel, turn conversion on for that endpoint binding. Conversion is a best-effort compatibility layer and some parameters may be lost; a single failover will only ever consider channels that match natively or that you have explicitly enabled conversion for.

## Smart Routing

This is the landing page after install, and it answers one question: **which requests belong to which channel group.** Two modes, switched from the page header — exactly one is in effect at a time, and neither rewrites the other's definition:

- **Workflow graph** (the default): draw the policy as a node graph.
  - Four ready-made policies you can drop straight onto the canvas: **Logical model hit** (use the requested model when it names a logical model, otherwise fall back to the default), **Route by user agent** (recognise Cursor or Claude CLI and split accordingly, everything else falls back), **LLM request complexity** (let a model judge difficulty and send the hard ones to the strong channel, the rest to the fast cheap one), and **JS script request handling** (a sandboxed script scores the request and buckets it).
  - Or build your own from nodes: input → protocol discovery → conditions → logical model selection → output. Each node does exactly one thing.
- **Rule table**: cheaper to read and write for simple cases — a list of rules read top to bottom, one condition and one landing each. The first rule that both matches and yields a landing wins, the row at the end is the fallback, and reprioritising is dragging a row where you want it. Conditions are the same kind the graph uses, so a policy never means one thing in one mode and something else in the other.

Both modes are versioned separately, and both cover the same everyday behaviour out of the box.

- **Test run** takes a real request body and shows which branch it takes and what each node produced; in rule mode it lists every rule as matched / not matched / disabled together with the live value of each condition. Nothing is forwarded upstream.
- Every save leaves a version behind, so a bad policy is one rollback away.

The built-in `default` logical model is the safety net: anything no policy matches ends up there.

## Request Rewrite

Maintain rules on the **Request Rewrite** page to smooth over small differences between providers:

- Two match conditions only: client protocol and upstream protocol. Leave them empty to apply everywhere — no protocol matrix to work out first.
- Actions run in the request or response stage. Headers can be set, appended or removed; JSON bodies can have values set, paths deleted, or strings replaced by literal or regular expression via `$.path`.
- A rule can be global (applies to every channel) or bound to specific models with an explicit execution order.
- The editor carries a test case, so you see the effect of a change immediately without sending a real request.

Three templates ship with it: **Override User-Agent** (defaults to `OSW/<version>`), **Drop a request header**, and **Set a request field**.

New rules are enabled; disable one from the list if you change your mind. Every change is a structured add/delete/replace and nothing ever executes a script. Response-stage actions only touch complete non-streaming JSON — the body of a streaming response is never rewritten.

## Data and privacy

- The proxy listens on `127.0.0.1` by default and does not expose itself to the local network.
- API keys are kept in the OS-encrypted store. Exporting providers has an **include plaintext API keys** switch that is on by default — an export carrying keys is a working credential, so pass it between your own devices and nowhere else.

Configuration, logs and request metadata live in one hidden directory in your home folder, and they are split into two SQLite files:

| File | Contents |
| --- | --- |
| `~/.osw/config-v1.db` | Providers, models, routing and rewrite rules — **your configuration, worth backing up** |
| `~/.osw/data-v1.db` | Request logs, captured bodies, usage and health state — **safe to delete**, you only lose history |

The development build uses `~/.osw-development` instead, so a dev instance never touches your real data.

A few more things worth knowing:

- **Body capture is on by default.** The full request, response and streamed content are stored locally, including both sides of any protocol conversion. Headers are redacted automatically (`authorization`, `x-api-key`, `cookie` and friends); bodies are not — which is exactly why it can debug any request, and why the logs may contain sensitive content. Bodies are kept for 7 days by default while the request records themselves are kept forever. Turn capture off, change the retention windows, or clear history from **Settings → Data → Request Logs**.
- To support very long contexts properly, neither the proxy nor body capture caps request size; the body is read into memory in full. Enormous bodies will cost real memory and disk. That is a deliberate trade-off in this version.
- There is no cloud sync, no account and no remote relay. Requests only go to the upstreams you configured.

## Not supported yet

Better to be clear about the edges than let you find them the hard way:

- No system-wide proxy — you change the Base URL in each AI tool yourself.
- No Gemini `/v1beta/models/*` endpoints.
- No team collaboration, multi-user permissions, cloud sync or remote access.
- A single request's failover only picks among channels that match the protocol natively or where you explicitly enabled conversion. It never guesses across protocols.

## Local development

Node.js 22+ and pnpm 11 are required:

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm dev             # dev session: console dev server + Electron
pnpm dev:preview     # console only, for looking at the UI in a browser
pnpm typecheck       # TypeScript
pnpm lint            # ESLint plus the layering and package-boundary guards
pnpm test            # the whole test suite
pnpm build           # compile every package (no installers)
pnpm release:mac     # build macOS arm64 / x64 installers
pnpm release:win     # build Windows arm64 / x64 installers
pnpm release:linux   # build Linux arm64 / x64 installers
```

The repository is a pnpm workspace: `packages/{contracts,core,console}` are libraries that can be consumed on their own, `packages/toolkit` holds the cross-package development scripts, `apps/app` is the desktop host, and Turborepo runs the tasks. The stack is Electron + React + TypeScript + Vite + Drizzle ORM + SQLite.

Design goals, behaviour contracts and acceptance criteria have a single authority in [`docs/product/`](./docs/product/README.md); build and packaging details live in [packaging.md](./docs/product/packaging.md). Verbatim upstream API references are kept in [`docs/references/`](./docs/references/).

## Feedback

Issues and ideas are welcome in [Issues](https://github.com/yinxulai/osw/issues). The version number, operating system, protocol and a redacted runtime log go a long way — but please **do not** paste API keys, full prompts or other sensitive content.

---

## Contributors

[![Contributors](https://contrib.rocks/image?repo=yinxulai/osw)](https://github.com/yinxulai/osw/graphs/contributors)

Thanks to everyone who has put work into OSW — code, bug reports, ideas and documentation fixes all count.

---

## License

OSW is released under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

- **Personal and other noncommercial use is free.** Research, study, hobby projects, and use by charitable, educational, public research, public safety or health, environmental and government organizations are all permitted purposes.
- **Commercial use is not allowed.** For commercial licensing, contact the author.
- **The license travels with the code.** Anyone who receives a copy — modified or not — must also receive the license text and the `Required Notice:` line in [`LICENSE`](./LICENSE). The project may not be sublicensed or relicensed under other terms.

---

## Friends

- [LINUX DO](https://linux.do/) — a Chinese community for developers and open-source projects.
