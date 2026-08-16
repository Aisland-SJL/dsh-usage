/**
 * dsh-usage — server half.
 *
 * Registers three read-only, loopback-only endpoints on the web server:
 *   GET /api/usage/providers — configured providers + balance scheme/status
 *   GET /api/usage/balance   — balance for one provider (?provider=<id>)
 *   GET /api/usage/usage     — per-day token usage across every session
 *
 * Provider configuration is read straight from the harness settings
 * (`llm-deepseek` for the official DeepSeek route, `llm-pi-ai` for every
 * configured pi-ai provider profile), and each provider's API key is resolved
 * through the credentials seam at request time — nothing secret is stored by
 * this plugin. Upstream balance queries go through lib/safe-fetch.js (HTTPS,
 * private-network rejection, DNS pinning).
 *
 * The endpoints live under the `/api` prefix as exact routes, so they win
 * over the connection plugin's `/api` prefix handler; each handler applies
 * its own peer-socket loopback fence. Host is checked only as an additional
 * defense.
 *
 * Usage aggregation is INCREMENTAL: per-session fold state (day/model
 * buckets plus the last usage sample) is cached in memory and persisted to
 * `<DSH_HOME>/storages/usage-cache.json`, so steady-state cost stays
 * O(new events) no matter how large the logs grow.
 *
 * Background refresh queries every configured balance and folds token usage
 * immediately at startup and then every five minutes.
 *
 * @module dsh-usage
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { balanceSchemeOf, queryBalance } from "./balance.js";
import { safeFetch } from "./safe-fetch.js";
import { collectClaudeUsage } from "./claude.js";
import { applyUsageDelta, createUsageState, mergeHoursInto, mergeInto, renderUsage } from "./usage.js";

/** Stable Cordis plugin name. */
const name = "usage";

/** Services required before this plugin activates. */
const inject = ["webServer", "credentials", "sessions", "sessionPersistence", "settings"];

const USAGE_PATH = "/api/usage/usage";
const PROVIDERS_PATH = "/api/usage/providers";
const BALANCE_PATH = "/api/usage/balance";
const UPSTREAM_TIMEOUT_MS = 15000;
const REFRESH_MS = 300000;
const CACHE_VERSION = 2;

/** Default DeepSeek connection facts when the settings namespace is absent. */
const DEEPSEEK_DEFAULTS = {
	apiKeyEnv: "DEEPSEEK_API_KEY",
	baseURL: "https://api.deepseek.com"
};

/** Legacy balance providers shown even without a pi-ai profile. */
const LEGACY_PROVIDERS = [
	{ id: "openrouter", displayName: "OpenRouter", apiKeyEnv: "OPENROUTER_MANAGEMENT_KEY", baseURL: "https://openrouter.ai/api/v1" },
	{ id: "zai", displayName: "Z.ai", apiKeyEnv: "ZAI_API_KEY", baseURL: "https://api.z.ai" }
];

/** Write a JSON response. */
function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}

/**
 * Loopback fence, primary on the PEER SOCKET address (not the
 * client-controllable Host header): the request must come from a loopback
 * interface. IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is normalized. The Host
 * header is kept as an additional check, never as the deciding one.
 */
export function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const ipv4 = a.startsWith("::ffff:") ? a.slice(7) : a;
	const octets = ipv4.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Parse a Host header without breaking bracketed or bare IPv6 literals. */
function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return host;
	if (lastColon === -1) return host.replace(/\.$/, "");
	if (!/^\d+$/.test(host.slice(lastColon + 1))) return null;
	return host.slice(0, lastColon).replace(/\.$/, "");
}

function isLoopbackHostHeader(req) {
	const name = hostNameOf(req.headers.host);
	return name === "localhost" || isLoopbackAddress(name);
}

/** Refuse non-loopback callers and non-GET methods before any work. */
export function rejectForeignCaller(req, res) {
	if (req.method !== "GET") {
		res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
		return true;
	}
	const peer = req.socket?.remoteAddress;
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	json(res, 403, { ok: false, error: "forbidden" });
	return true;
}

//#region balance service

/** Resolve a credential reference through the harness credentials seam. */
async function resolveCredential(credentials, ref) {
	if (typeof ref !== "string" || ref === "") return "";
	if (credentials === null || credentials === void 0 || typeof credentials.resolve !== "function") return "";
	try {
		const hit = await credentials.resolve(ref);
		const value = typeof hit?.value === "string" ? hit.value.trim() : "";
		return value;
	} catch {
		return "";
	}
}

/**
 * Enumerate the harness's configured providers: the official DeepSeek route
 * (`llm-deepseek` settings namespace) plus every pi-ai provider profile
 * (`llm-pi-ai` settings namespace), plus legacy balance providers when no
 * pi-ai profile of the same id exists. Each entry carries the connection
 * facts (credential ref + base URL) needed to query a balance — no keys.
 */
export async function configuredProviders(ctx) {
	const settings = ctx.get("settings");
	const providers = [];
	const deepseek = settings?.get?.("llm-deepseek");
	if (deepseek !== void 0 && deepseek !== null && typeof deepseek === "object") {
		providers.push({
			id: "deepseek-official",
			displayName: "DeepSeek",
			apiKeyEnv: typeof deepseek.apiKeyEnv === "string" ? deepseek.apiKeyEnv : DEEPSEEK_DEFAULTS.apiKeyEnv,
			baseURL: typeof deepseek.baseURL === "string" ? deepseek.baseURL : DEEPSEEK_DEFAULTS.baseURL
		});
	} else {
		providers.push({
			id: "deepseek-official",
			displayName: "DeepSeek",
			apiKeyEnv: DEEPSEEK_DEFAULTS.apiKeyEnv,
			baseURL: DEEPSEEK_DEFAULTS.baseURL
		});
	}
	const pi = settings?.get?.("llm-pi-ai");
	if (pi !== void 0 && pi !== null && typeof pi === "object" && pi.providers !== void 0 && typeof pi.providers === "object") {
		for (const [route, profile] of Object.entries(pi.providers)) {
			if (profile === null || typeof profile !== "object") continue;
			providers.push({
				id: route,
				displayName: typeof profile.displayName === "string" && profile.displayName.length > 0 ? profile.displayName : route,
				apiKeyEnv: typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : void 0,
				baseURL: typeof profile.baseURL === "string" ? profile.baseURL : void 0
			});
		}
	}
	for (const legacy of LEGACY_PROVIDERS) {
		if (!providers.some((provider) => provider.id === legacy.id)) providers.push({ ...legacy });
	}
	return providers;
}

/**
 * In-memory balance cache with per-provider single-flight and forced bulk
 * refresh. Background scheduling is owned by the server plugin so it can also
 * refresh local token-usage aggregation in the same five-minute cycle.
 */
export function createBalanceService({ credentials, getProviders, deps = {} }) {
	const cache = new Map();
	const inflight = new Map();
	const refreshMs = deps.refreshMs ?? REFRESH_MS;

	async function queryOne(provider, force) {
		const scheme = balanceSchemeOf(provider.id);
		const configKey = `${scheme ?? "none"}|${provider.baseURL ?? ""}|${provider.apiKeyEnv ?? ""}`;
		const hit = cache.get(provider.id);
		const age = (deps.now ?? Date.now)() - (hit?.account?.fetchedAt ?? 0);
		if (!force && hit?.configKey === configKey && age >= 0 && age < refreshMs) return hit.account;
		const existing = inflight.get(provider.id);
		if (existing !== void 0) return existing;
		const promise = (async () => {
			const account = {
				id: provider.id,
				displayName: provider.displayName,
				scheme,
				mode: scheme === null ? "unsupported" : "balance",
				status: "pending",
				balance: null,
				fetchedAt: (deps.now ?? Date.now)()
			};
			if (scheme === null) return account;
			if (typeof provider.baseURL !== "string" || provider.baseURL === "") {
				account.status = "not-configured";
				account.missingCredentials = ["baseURL"];
				return account;
			}
			const apiKey = await resolveCredential(credentials, provider.apiKeyEnv);
			if (apiKey === "") {
				account.status = "not-configured";
				account.missingCredentials = [provider.apiKeyEnv];
				return account;
			}
			try {
				const fetchImpl = deps.fetchImpl ?? ((url, init) => safeFetch(url, init, deps));
				account.balance = await queryBalance(scheme, provider.baseURL, apiKey, deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS, fetchImpl);
				account.status = "ok";
			} catch (error) {
				account.status = error?.providerStatus ?? (error?.name === "TimeoutError" || error?.name === "AbortError" ? "unavailable" : "unavailable");
				account.error = error instanceof Error ? error.message : String(error);
			}
			return account;
		})();
		inflight.set(provider.id, promise);
		try {
			const account = await promise;
			cache.set(provider.id, { configKey, account });
			return account;
		} finally {
			inflight.delete(provider.id);
		}
	}

	async function get(providerId, { force = false } = {}) {
		const provider = (await getProviders()).find((entry) => entry.id === providerId);
		if (provider === void 0) return null;
		return queryOne(provider, force);
	}

	async function refreshAll() {
		const providers = await getProviders();
		return Promise.allSettled(providers.filter((provider) => balanceSchemeOf(provider.id) !== null).map((provider) => queryOne(provider, true)));
	}

	async function providerViews() {
		const providers = await getProviders();
		return Promise.all(providers.map(async (provider) => {
			const cached = cache.get(provider.id)?.account;
			const scheme = balanceSchemeOf(provider.id);
			let configured = false;
			if (cached !== void 0) configured = cached.status !== "not-configured";
			else if (scheme !== null) configured = await resolveCredential(credentials, provider.apiKeyEnv) !== "";
			return {
				id: provider.id,
				displayName: provider.displayName,
				scheme,
				configured,
				status: cached?.status ?? "pending",
				fetchedAt: cached?.fetchedAt ?? null,
				balance: cached?.balance ?? null
			};
		}));
	}

	return {
		get,
		refreshAll,
		providerViews,
		validate: async () => { await getProviders(); },
		cached: (providerId) => cache.get(providerId)?.account ?? null
	};
}

//#endregion

//#region incremental usage cache

/** Cache file location under the dsh home. */
function cachePath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "usage-cache.json");
}

/** Claude Code project dir (configurable; defaults to ~/.claude). */
export function claudeDirOf() {
	return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/** Claude aggregation cache location. */
export function claudeCachePath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "usage-cache-claude.json");
}

/** Collect the Claude Code channel view for the dual comparison (never throws). */
export async function collectClaude(logger, deps = {}) {
	try {
		return await collectClaudeUsage({
			claudeDir: deps.claudeDir ?? claudeDirOf(),
			cachePath: deps.claudeCachePath ?? claudeCachePath(),
			logger
		});
	} catch (error) {
		logger.warn(`usage: claude aggregation failed: ${String(error)}`);
		return { enabled: false, error: String(error) };
	}
}

let loadedCache = null;
let loadPromise = null;
let inflight = null;

/** Serialize one session's fold state (Maps → plain objects). */
function serializeSession(state) {
	const days = {};
	for (const [date, entry] of state.days) {
		const models = {};
		for (const [model, buckets] of entry.models) models[model] = { ...buckets };
		days[date] = { totals: { ...entry.totals }, models };
	}
	const hours = {};
	for (const [date, slots] of state.hours) hours[date] = [...slots];
	return {
		kind: state.kind ?? "persisted",
		consumed: state.consumed ?? 0,
		...(state.revision === void 0 ? {} : { revision: state.revision }),
		days,
		hours,
		lastSample: state.lastSample === null ? null : {
			key: state.lastSample.key,
			day: state.lastSample.day,
			hour: state.lastSample.hour,
			model: state.lastSample.model,
			buckets: { ...state.lastSample.buckets }
		},
		currentModel: state.currentModel
	};
}

/** Parse a serialized session entry back into fold state (lenient). */
function parseSession(raw) {
	const state = createUsageState();
	if (raw === null || typeof raw !== "object") return state;
	state.kind = typeof raw.kind === "string" ? raw.kind : "persisted";
	state.consumed = Number.isSafeInteger(raw.consumed) ? raw.consumed : 0;
	if (typeof raw.revision === "string") state.revision = raw.revision;
	if (raw.days !== null && typeof raw.days === "object") {
		for (const [date, entry] of Object.entries(raw.days)) {
			if (entry === null || typeof entry !== "object") continue;
			const target = { totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, models: new Map() };
			const totals = entry.totals;
			if (totals !== null && typeof totals === "object") {
				target.totals.inputTokens = Number.isFinite(totals.inputTokens) ? totals.inputTokens : 0;
				target.totals.outputTokens = Number.isFinite(totals.outputTokens) ? totals.outputTokens : 0;
				target.totals.cacheReadTokens = Number.isFinite(totals.cacheReadTokens) ? totals.cacheReadTokens : 0;
				target.totals.cacheWriteTokens = Number.isFinite(totals.cacheWriteTokens) ? totals.cacheWriteTokens : 0;
			}
			if (entry.models !== null && typeof entry.models === "object") {
				for (const [model, buckets] of Object.entries(entry.models)) {
					if (buckets === null || typeof buckets !== "object") continue;
					target.models.set(model, {
						inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens : 0,
						outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens : 0,
						cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens : 0,
						cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens : 0
					});
				}
			}
			state.days.set(date, target);
		}
	}
	if (raw.hours !== null && typeof raw.hours === "object") {
		for (const [date, slots] of Object.entries(raw.hours)) {
			if (!Array.isArray(slots)) continue;
			state.hours.set(date, slots.map((value) => Number.isFinite(value) ? value : 0).concat(new Array(Math.max(0, 24 - slots.length)).fill(0)).slice(0, 24));
		}
	}
	if (raw.lastSample !== null && raw.lastSample !== void 0 && typeof raw.lastSample === "object" && typeof raw.lastSample.key === "string" && typeof raw.lastSample.day === "string") {
		const buckets = raw.lastSample.buckets ?? {};
		state.lastSample = {
			key: raw.lastSample.key,
			day: raw.lastSample.day,
			hour: Number.isSafeInteger(raw.lastSample.hour) && raw.lastSample.hour >= 0 && raw.lastSample.hour < 24 ? raw.lastSample.hour : void 0,
			model: typeof raw.lastSample.model === "string" ? raw.lastSample.model : "unknown",
			buckets: {
				inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens : 0,
				outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens : 0,
				cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens : 0,
				cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens : 0
			}
		};
	}
	if (typeof raw.currentModel === "string") state.currentModel = raw.currentModel;
	return state;
}

/** Load the cache once per process; any corruption degrades to a fresh cache. */
async function loadCache() {
	if (loadedCache !== null) return loadedCache;
	loadPromise ??= (async () => {
		const fresh = { version: CACHE_VERSION, sessions: {} };
		try {
			const raw = await readFile(cachePath(), "utf8");
			const parsed = JSON.parse(raw);
			if (parsed !== null && typeof parsed === "object" && parsed.version === CACHE_VERSION && parsed.sessions !== null && typeof parsed.sessions === "object") {
				const sessions = {};
				for (const [id, entry] of Object.entries(parsed.sessions)) {
					if (typeof id === "string" && id.length > 0) sessions[id] = parseSession(entry);
				}
				return { version: CACHE_VERSION, sessions };
			}
		} catch {
			/* first run or corrupt cache */
		}
		return fresh;
	})();
	loadedCache = await loadPromise;
	return loadedCache;
}

/** Persist the cache atomically (temp + rename); failures are logged, never fatal. */
async function saveCache(ctx, cache) {
	try {
		const path = cachePath();
		await mkdir(dirname(path), { recursive: true });
		const serialized = { version: CACHE_VERSION, sessions: {} };
		for (const [id, state] of Object.entries(cache.sessions)) serialized.sessions[id] = serializeSession(state);
		const tmp = `${path}.tmp`;
		await writeFile(tmp, JSON.stringify(serialized), "utf8");
		await rename(tmp, path);
	} catch (error) {
		ctx.logger.warn(`usage: saving usage cache failed: ${String(error)}`);
	}
}

/** Single-flight guard: concurrent requests share one aggregation run. */
function withLock(run) {
	if (inflight !== null) return inflight;
	inflight = run().finally(() => {
		inflight = null;
	});
	return inflight;
}

/**
 * Collect per-day usage across live and persisted sessions, incrementally.
 * Live sessions fold only the in-memory events added since the last fold;
 * persisted sessions are skipped when the backend's opaque revision is
 * unchanged, and a gap or truncation triggers a full refold of that session.
 */
export async function collectUsage(ctx) {
	return withLock(async () => {
		const cache = await loadCache();
		const live = ctx.get("sessions");
		const attached = new Set();
		if (live !== void 0) {
			for (const session of live.list()) {
				attached.add(session.id);
				const state = cache.sessions[session.id] ?? createUsageState();
				if (state.kind !== "live") {
					// Live/persisted transition: refold the whole in-memory log.
					state.days = new Map();
					state.hours = new Map();
					state.lastSample = null;
					state.currentModel = null;
					state.consumed = 0;
				}
				const count = session.events.length;
				if ((state.consumed ?? 0) < count) {
					applyUsageDelta(state, session.events.slice(state.consumed ?? 0));
					state.consumed = count;
				}
				state.kind = "live";
				cache.sessions[session.id] = state;
			}
		}
		const persistence = ctx.get("sessionPersistence");
		const persistedIds = new Set();
		if (persistence !== void 0) {
			let snapshots = null;
			if (typeof persistence.listSnapshots === "function") {
				try {
					snapshots = await persistence.listSnapshots();
				} catch (error) {
					ctx.logger.warn(`usage: listSnapshots failed, falling back to list(): ${String(error)}`);
				}
			}
			const metas = snapshots !== null ? snapshots.map((entry) => entry.header) : await persistence.list();
			const revisionOf = new Map();
			if (snapshots !== null) for (const entry of snapshots) revisionOf.set(entry.header.id, entry.revision);
			for (const meta of metas) {
				persistedIds.add(meta.id);
				if (attached.has(meta.id)) continue;
				const state = cache.sessions[meta.id] ?? createUsageState();
				const revision = revisionOf.get(meta.id);
				const changed = state.kind !== "persisted" || revision !== void 0 && revision !== state.revision || revision === void 0;
				if (changed) {
					try {
						const wasPersisted = state.kind === "persisted";
						const fromSeq = wasPersisted ? state.consumed : 0;
						const { events } = await persistence.readFrom(meta.id, fromSeq);
						if (!wasPersisted) {
							state.days = new Map();
							state.hours = new Map();
							state.lastSample = null;
							state.currentModel = null;
							state.consumed = 0;
						}
						const fresh = wasPersisted ? events.filter((event) => event.seq > (state.consumed ?? 0)) : events;
						const contiguous = fresh.length === 0 ? state.consumed === 0 : fresh[0].seq === state.consumed + 1;
						if (!contiguous && state.consumed > 0) {
							// Log truncated or rewritten: refold the whole log.
							state.days = new Map();
							state.hours = new Map();
							state.lastSample = null;
							state.currentModel = null;
							state.consumed = 0;
							const { events: allEvents } = await persistence.readFrom(meta.id, 0);
							applyUsageDelta(state, allEvents);
							state.consumed = allEvents.length > 0 ? allEvents[allEvents.length - 1].seq : 0;
						} else if (fresh.length > 0) {
							applyUsageDelta(state, fresh);
							state.consumed = fresh[fresh.length - 1].seq;
						}
						state.kind = "persisted";
						if (revision !== void 0) state.revision = revision;
					} catch (error) {
						ctx.logger.warn(`usage: reading persisted session "${meta.id}" failed: ${String(error)}`);
					}
				}
				cache.sessions[meta.id] = state;
			}
		}
		for (const id of Object.keys(cache.sessions)) {
			if (!attached.has(id) && !persistedIds.has(id)) delete cache.sessions[id];
		}
		const byDay = new Map();
		const byHour = new Map();
		for (const state of Object.values(cache.sessions)) {
			mergeInto(byDay, state.days);
			mergeHoursInto(byHour, state.hours);
		}
		// Keep the atomic cache write inside the single-flight section. Otherwise
		// overlapping saves can race on the same temporary file.
		await saveCache(ctx, cache);
		return renderUsage(byDay, byHour, Date.now());
	});
}

//#endregion

//#region route handlers

async function handleUsage(ctx, req, res, deps = {}) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const result = await collectUsage(ctx);
		const claude = await collectClaude(ctx.logger, deps);
		json(res, 200, { ok: true, ...result, claude });
	} catch (error) {
		ctx.logger.warn(`usage: usage aggregation failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

async function handleProviders(ctx, service, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		json(res, 200, { ok: true, providers: await service.providerViews() });
	} catch (error) {
		ctx.logger.warn(`usage: providers enumeration failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

async function selectedProviderId(req, service) {
	const url = new URL(req.url ?? "/", "http://x");
	const requested = url.searchParams.get("provider");
	if (requested !== null && requested !== "") return requested;
	const providers = await service.providerViews();
	return providers.find((entry) => entry.id === "deepseek-official")?.id
		?? providers.find((entry) => entry.configured)?.id
		?? providers[0]?.id
		?? null;
}

async function handleBalance(ctx, service, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const url = new URL(req.url ?? "/", "http://x");
		const providerId = await selectedProviderId(req, service);
		const account = providerId === null ? null : await service.get(providerId, { force: url.searchParams.get("refresh") === "1" });
		if (account === null) {
			json(res, 200, { ok: false, error: "unknown-provider", message: `provider "${providerId}" is not configured` });
			return;
		}
		json(res, 200, { ok: true, account });
	} catch (error) {
		ctx.logger.warn(`usage: balance fetch failed: ${String(error)}`);
		json(res, 502, { ok: false, error: "failed", message: error instanceof Error ? error.message : String(error) });
	}
}

//#endregion

/** Start an immediate refresh and repeat account + local usage refresh every 5 minutes. */
export function startBackgroundRefresh(ctx, service, deps = {}) {
	let running = false;
	let stopped = false;
	let active = Promise.resolve();
	const run = async () => {
		if (running || stopped) return;
		running = true;
		active = (async () => {
			const results = await Promise.allSettled([service.refreshAll(), collectUsage(ctx), collectClaude(ctx.logger, deps)]);
			for (const result of results) if (result.status === "rejected") ctx.logger.warn(`usage: background refresh failed: ${String(result.reason)}`);
		})().finally(() => {
			running = false;
		});
		return active;
	};
	void run();
	const setTimer = deps.setInterval ?? setInterval;
	const clearTimer = deps.clearInterval ?? clearInterval;
	const timer = setTimer(run, deps.intervalMs ?? REFRESH_MS);
	timer?.unref?.();
	const stop = async () => {
		stopped = true;
		clearTimer(timer);
		await active;
	};
	stop.refreshNow = async () => {
		await active;
		return run();
	};
	/** Resolves when the startup refresh round settles (test seam + diagnostics). */
	stop.ready = active;
	return stop;
}

/** Plugin config schema: everything is optional; unknown keys are tolerated. */
const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-usage",
		validate(value) {
			const config = value !== null && typeof value === "object" ? value : {};
			return { value: config };
		}
	}
};

/**
 * Plugin body: register the three exact routes and start background refresh.
 * @param ctx - plugin context carrying webServer, credentials, sessions, sessionPersistence, and settings.
 * @param deps - test seams: {service, disableBackgroundRefresh, intervalMs, setInterval, clearInterval, lookup, transport, fetchImpl}.
 */
async function apply(ctx, rawConfig = {}, deps = {}) {
	const service = deps.service ?? createBalanceService({
		credentials: ctx.get("credentials") ?? ctx.credentials,
		getProviders: () => configuredProviders(ctx),
		deps: { timeoutMs: UPSTREAM_TIMEOUT_MS, lookup: deps.lookup, transport: deps.transport, fetchImpl: deps.fetchImpl }
	});
	// Provider ids come from the async Harness settings service, so this
	// dynamic part of config validation must finish before routes start.
	await service.validate();
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: USAGE_PATH,
		handler: (req, res) => handleUsage(ctx, req, res, deps)
	}), "usage: usage route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: PROVIDERS_PATH,
		handler: (req, res) => handleProviders(ctx, service, req, res)
	}), "usage: providers route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BALANCE_PATH,
		handler: (req, res) => handleBalance(ctx, service, req, res)
	}), "usage: balance route");
	if (deps.disableBackgroundRefresh !== true) ctx.effect(() => startBackgroundRefresh(ctx, service, deps), "usage: background refresh");
}

export { apply, Config, inject, name, USAGE_PATH, PROVIDERS_PATH, BALANCE_PATH };
