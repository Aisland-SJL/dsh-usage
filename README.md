# 🌊 dsh-usage

A **persistent floating dock**, a **fully customizable balance / token-usage panel**, an **activity heatmap**, and a **dual-channel usage comparison** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI (`dsh web`) and official Windows Desktop. See the host scope below.

[![README-中文](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-crimson?style=flat-square)](README.zh-CN.md)
[![License](https://img.shields.io/badge/license-MIT-2da44e?style=flat-square)](LICENSE)

## ✨ Feature tour

### 🌊 Persistent dock

Your key numbers stay visible at all times — balance glows green (red only when out of credit), rows are separated by hairlines, and a settings gear plus one-click refresh sit in the corner. When the sidebar collapses, the dock folds into a tiny balance pill.

<table><tr>
<td width="44%"><img src="docs/images/dock.png" alt="dsh-usage dock" width="100%"></td>
<td>

- 🟢 **Balance** — green when healthy, red when drained
- 📊 **Today / Month / Cache hit** — glanceable token stats
- ⚙ **Gear** opens the panel · ↻ refresh re-queries instantly
- 🧲 **Mirrors your pins** — every change applies immediately

</td>
</tr></table>

### 🎛️ Detail panel — all seven widgets

A two-column card layout; every widget has a detail and a compact form, and can be drag-reordered, collapsed, hidden, or pinned.

<table><tr>
<td>

| Widget | What it does |
| --- | --- |
| 💳 **Balance** | Big number on the left, available / topped-up / granted rows on the right; provider switchable |
| 📊 **Today** | Today's tokens plus input / output / cache-read breakdown |
| 📈 **This month** | Monthly tokens plus the same breakdown |
| 🎯 **Cache hit** | Today's and all-time cache hit rates |
| ↔️ **Channel share** | DSH channel vs Claude Code channel ratio bar |
| 📜 **Usage log** | Last 14 days per-day list, click to drill into per-model detail |
| 🔥 **Activity heatmap** | 28-day × 6-band dot grid (dates across, 0–24h down) |

</td>
<td width="46%"><img src="docs/images/panel.png" alt="dsh-usage panel" width="100%"></td>
</tr></table>

### 🎨 Everything customizable

Accent (presets + color picker), background, and panel opacity are adjustable live. Drag-reorder, pin, collapse, hide — every number presents your way, echoing DeepSeek Harness's "everything is a plugin" spirit.

<p align="center"><img src="docs/images/customizer.png" alt="dsh-usage customizer" width="78%"></p>

## At a glance

| | Feature | Notes |
| --- | --- | --- |
| 💳 | Persistent dock | Pinned compacts always visible; collapses into a balance pill when the sidebar folds |
| 🎨 | Everything customizable | Widgets: pin / collapse / hide / drag-reorder with a dashed placeholder and glide animation; accent, background, opacity; persisted in localStorage |
| 📊 | Balance & usage panel | Provider picker, balance breakdown, today/month totals in k/M/B units, cache hit, usage log with per-model drilldown |
| 🔥 | Activity heatmap | GitHub-style dots: 28 days × 6 four-hour bands with date labels |
| ↔️ | Channel share | DSH channel vs Claude Code channel (incremental JSONL aggregation of `~/.claude/projects`) |
| 🔄 | Background refresh | Refresh at startup, then every 5 minutes: balances, DSH tokens, Claude Code aggregation |
| 🔒 | Local-only security | Three loopback-only GET endpoints; credentials resolved server-side; upstream forced HTTPS with DNS pinning; Claude logs aggregate numbers only — message text never leaves the machine |

UI supports Chinese and English. Balance requests resolve keys in memory through Harness's credential service; keys are not included in plugin caches or browser responses.

## Quick start

**v0.3.1 targets DeepSeek Harness 0.2.0-rc.2**, on Web and official Windows Desktop. Legacy service branches remain, but a full 0.1.x-host regression has not been performed: keep v0.3.0 on older hosts rather than assuming universal compatibility. Desktop platforms other than Windows have not been tested on real machines.

Desktop uses the client `platform: web` contract, but installation belongs to the `desktop` profile and must use that app's bundled CLI while Desktop is fully quit. Open the app manually afterward; do not kill or restart it automatically. Update prompts select the active profile. Plugin appearance settings are origin-specific, even when profiles share DSH_HOME. Offline tests do not establish acceptance for every account, historical session, or Desktop feature.

```bash
dsh plugin --profile web add "github:Aisland-SJL/dsh-usage"
```

Alternatively, use the fixed-name Release TGZ (available after publication; use a tag-specific versioned asset for a reproducible installation):

```bash
dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-usage/releases/latest/download/dsh-usage.tgz"
```

For Desktop, fully quit first and run this with **that application's bundled dsh CLI**, not the Web CLI:

```bash
dsh plugin --profile desktop add "https://github.com/Aisland-SJL/dsh-usage/releases/latest/download/dsh-usage.tgz"
```

The runtime dependency is `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2`; normal package installation resolves it without manually adding official components. For a linked checkout, check the active profile's dependencies against its host. Do not install another version of an official UI component just to suppress a warning.

For Web, fully restart `dsh web` and hard-refresh; for Desktop, open the app manually. Update / remove commands for GitHub-sourced installations (for TGZ upgrades, repeat the corresponding `add` command):

```bash
dsh plugin --profile web update dsh-usage
dsh plugin --profile web remove dsh-usage
```

## Credentials

Configure credential references through Harness. Older hosts stored these in `~/.dsh/.credentials.yaml`; do not assume that path on 0.2 or a custom `DSH_HOME`:

```yaml
DEEPSEEK_API_KEY: sk-your-key-here            # official DeepSeek route
OPENROUTER_MANAGEMENT_KEY: sk-or-v1-...       # OpenRouter account (Management Key, not the inference key)
ZAI_API_KEY: your-zai-key                     # Z.ai open platform
```

Moonshot / Kimi profiles under `llm-pi-ai` are discovered automatically and reuse their `apiKeyEnv`. Providers without a public balance API show an explicit "no public balance interface" state — never a guess.

On 0.2 the provider directory addresses redacted live settings by entry id. Supported pi-ai routes may also use an API-key record; OAuth/grant payloads are not interpreted. OpenRouter still requires a Management Key, not its stored inference key. A missing endpoint or usable key is reported as not configured, not silently borrowed from another route.

For isolated tests set the plugin entry's `config.balanceEnabled: false` to prevent credential resolution and upstream balance requests (default: enabled). Set `CLAUDE_CONFIG_DIR` explicitly to a synthetic test directory; otherwise the existing default still scans `~/.claude/projects`. Token cache v4 rebuilds older caches. On 0.2 unchanged session revisions are cached, changed sessions are refolded through read-only handles, and inherited fork history is not billed twice. Real account queries and paid model runs are separate acceptance work.

Unreadable sessions no longer block the rest of the aggregation. The response's `coverage` describes the sessions listed by the host: `complete`, `partial`, or `unavailable`, with counted/skipped sessions. Partial totals carry a warning and show only readable subtotals (≥); if no session can be read, totals are unavailable (`total: null`, “—” in the UI), not zero. Failed records are retried without retaining stale counts. This does not repair unsupported historical formats or rewrite their logs. A failure to list sessions still returns an error.

## Supported providers

| Provider | Upstream endpoint | Default credential ref |
| --- | --- | --- |
| DeepSeek | `GET {origin}/user/balance` | `DEEPSEEK_API_KEY` |
| OpenRouter | `GET {origin}/api/v1/credits` | `OPENROUTER_MANAGEMENT_KEY` |
| Moonshot / Kimi | `GET {origin}/v1/users/me/balance` | pi-ai provider `apiKeyEnv` |
| Z.ai / GLM | `GET {origin}/api/paas/v4/balance` | `ZAI_API_KEY` |

## API

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/usage/providers` | Provider list, balance scheme, and status summary |
| `GET` | `/api/usage/balance?provider=<id>` | Unified balance snapshot; `refresh=1` forces an upstream query |
| `GET` | `/api/usage/usage` | Per-day/per-model token aggregates, cache hit rates, 24-hour buckets (`days[].hours`), coverage status (`coverage`), and the Claude Code channel (`claude`) |

Non-GET requests get `405`, non-loopback callers get `403`; every response is JSON with `Cache-Control: no-cache`.

## Development & testing

```bash
npm install           # react/react-dom/jsdom for offline tests only
npm run check         # syntax checks for every module and script
npm test              # 112 offline tests: balance schemes, token folding, server boundary, client, e2e flows, Claude aggregation, package + 0.2 contracts
npm run test:package # runtime dependency + client inject contract
```

Tests are fully offline — no network, and the real `~/.dsh` is never touched (server tests redirect `DSH_HOME` to a temp dir). Dry-run the real Claude data: `node scripts/validate-claude.mjs`.

## Privacy & security

- API keys never enter browser responses, plugin caches, or logs; they are resolved at request time through Harness's credentials seam.
- Upstream balance queries: HTTPS enforced, DNS pre-resolved and private/loopback ranges rejected, connections pinned to the checked address (DNS-rebinding defense), 1 MiB response cap, 15 s timeout.
- Usage caches under `~/.dsh/storages/` hold only aggregated token numbers and fold cursors — no prompts, no replies.
- Claude Code logs are parsed line-by-line and discarded; only aggregated numbers reach the cache.
- Do not expose these endpoints through a reverse proxy to LAN or the public internet.

## Credits

- [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) (MIT): reference for balance schemes, token folding semantics, bundle plugin structure, and the security boundary.

## License

[MIT](LICENSE)
