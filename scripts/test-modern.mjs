#!/usr/bin/env node
/** Synthetic v2 logs and redacted settings only. No account, network or user data. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToString } from "react-dom/server";

const packageRoot = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const serverURL = pathToFileURL(join(packageRoot, "lib", "index.js"));
const { collectUsage, configuredProviders, createBalanceService, dshHomeOf, apply, BALANCE_PATH, PROVIDERS_PATH, USAGE_PATH } = await import(serverURL.href);
const { createUsageState, applyUsageDelta, totalTokens } = await import(pathToFileURL(join(packageRoot, "lib", "usage.js")).href);
const home = await mkdtemp(join(tmpdir(), "dsh-usage-modern-"));
const originalHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
let passed = 0;
async function test(label, fn) {
	await fn();
	console.log(`ok ${label}`);
	passed += 1;
}
const time = new Date(2026, 9, 1, 12).getTime();
const header = { seq: 0, time, type: "request/header", data: { header: { config: { provider: "deepseek-official", model: "fixture-model" } }, reason: "initial" } };
function settlement(seq, tokens, { type = "assistant/message", turn = 1, step = 1, direct = true } = {}) {
	const usage = { inputTokens: tokens, outputTokens: 5, cacheReadTokens: 2 };
	return { seq, time, type, data: {
		turn, step,
		...(type === "assistant/message" ? { message: { source: { provider: "deepseek-official", model: "fixture-model" }, content: [{ type: "text", text: "SYNTHETIC-TEXT-NOT-FOR-CACHE" }] } } : {}),
		...(direct ? { usage } : {}),
		stream: [{ type: "chunk", time, chunk: { type: "usage", usage } }]
	} };
}
function store(entries) {
	const records = new Map(entries.map(([id, events, inherited = 0]) => [id, { events, inherited, revision: Symbol(id) }]));
	const stats = { reads: [], closes: 0 };
	return {
		identity: Symbol("service"), records, stats,
		list: async () => [...records].map(([id, record]) => ({ header: { id }, revision: record.revision, eventCount: record.events.length })),
		open: async (id, access) => {
			assert.equal(access, "read");
			const record = records.get(id);
			if (record.openFail) throw record.openFail;
			return {
				inheritedEventCount: record.inherited,
				read: async (offset) => { stats.reads.push(offset); if (record.fail) throw new Error("fixture read failure"); return { events: record.events.slice(offset) }; },
				close: async () => { stats.closes += 1; if (record.closeFail) throw new Error("fixture close failure"); }
			};
		}
	};
}
function context(persistence) {
	return { get: (name) => name === "sessionPersistence" ? persistence : name === "sessions" ? { list: () => { throw new Error("v2 must not read synchronous live events"); } } : void 0, logger: { warn() {} } };
}
function mutate(persistence, id, events) {
	Object.assign(persistence.records.get(id), { events, revision: Symbol("changed") });
}

try {
	const persistence = store([["parent", [header, settlement(1, 100)]]]);
	const ctx = context(persistence);
	await test("v2 read uses inclusive offset 0 and always closes", async () => {
		const result = await collectUsage(ctx);
		assert.equal(result.total.tokens, 107);
		assert.equal(result.days[0].models[0].model, "deepseek-official/fixture-model");
		assert.deepEqual(persistence.stats.reads, [0]);
		assert.equal(persistence.stats.closes, 1);
	});
	await test("unchanged opaque revision skips a second read", async () => {
		assert.equal((await collectUsage(ctx)).total.tokens, 107);
		assert.equal(persistence.stats.reads.length, 1);
	});
	await test("changed log refolds without double counting", async () => {
		mutate(persistence, "parent", [header, settlement(1, 100), settlement(2, 10, { step: 2 })]);
		assert.equal((await collectUsage(ctx)).total.tokens, 124);
	});
	await test("truncation and same-length rewrite replace cached counts", async () => {
		mutate(persistence, "parent", [header, settlement(1, 30)]);
		assert.equal((await collectUsage(ctx)).total.tokens, 37);
		mutate(persistence, "parent", [header, settlement(1, 60)]);
		assert.equal((await collectUsage(ctx)).total.tokens, 67);
	});
	await test("fork inherited prefix establishes model but is not billed twice", async () => {
		persistence.records.set("child", { revision: Symbol("fork"), inherited: 2, events: [header, settlement(1, 60), settlement(2, 20, { type: "assistant/attempt", direct: false, step: 2 })] });
		const result = await collectUsage(ctx);
		assert.equal(result.total.tokens, 94);
		assert.equal(result.days[0].models[0].model, "deepseek-official/fixture-model");
	});
	await test("read failures close handles, exclude stale counts and report incomplete totals", async () => {
		const record = persistence.records.get("child");
		record.fail = true;
		record.revision = Symbol("failure");
		const closes = persistence.stats.closes;
		const partial = await collectUsage(ctx);
		assert.equal(partial.total.tokens, 67);
		assert.deepEqual(partial.coverage, { status: "partial", totalSessions: 2, countedSessions: 1, skippedSessions: [{ sessionId: "child", reason: "read-failed" }] });
		assert.equal(persistence.stats.closes, closes + 1);
		delete record.fail;
		const recovered = await collectUsage(ctx);
		assert.equal(recovered.total.tokens, 94);
		assert.equal(recovered.coverage.status, "complete");
	});
	await test("replacement service identity forces reread even for identical revision", async () => {
		persistence.identity = Symbol("replacement");
		persistence.records.get("parent").events = [header, settlement(1, 80)];
		assert.equal((await collectUsage(ctx)).total.tokens, 114);
	});
	await test("removed sessions disappear and no opaque revision/text is cached", async () => {
		persistence.records.delete("child");
		assert.equal((await collectUsage(ctx)).total.tokens, 87);
		const raw = await readFile(join(home, "storages", "usage-cache.json"), "utf8");
		assert.equal(JSON.parse(raw).version, 4);
		assert.ok(!raw.includes('"revision"'));
		assert.ok(!raw.includes("SYNTHETIC-TEXT-NOT-FOR-CACHE"));
	});
	await test("cold process ignores saved revision baselines and rereads", async () => {
		const cold = await import(`${serverURL.href}?cold=1`);
		persistence.records.get("parent").events = [header, settlement(1, 40)];
		assert.equal((await cold.collectUsage(ctx)).total.tokens, 47);
	});
	await test("cache does not cross DSH_HOME roots", async () => {
		process.env.DSH_HOME = join(home, "second-root");
		assert.equal((await collectUsage(context(store([])))).total.tokens, 0);
		process.env.DSH_HOME = home;
	});
	await test("unsupported legacy descriptor at open does not block later healthy sessions or leak diagnostics", async () => {
		const mixed = store([["legacy-child", []], ["healthy", [header, settlement(1, 25)]]]);
		const error = new Error("subagent/descriptor uses unsupported descriptor version 2; SYNTHETIC-PRIVATE-PATH");
		error.name = "SessionFormatUnsupportedError";
		mixed.records.get("legacy-child").openFail = error;
		const result = await collectUsage(context(mixed));
		assert.equal(result.total.tokens, 32);
		assert.equal(result.coverage.status, "partial");
		assert.deepEqual(result.coverage.skippedSessions, [{ sessionId: "legacy-child", reason: "unsupported-format" }]);
		assert.equal(mixed.stats.closes, 1);
		assert.ok(!JSON.stringify(result).includes("SYNTHETIC-PRIVATE-PATH"));
		assert.ok(!JSON.stringify(result).includes("SYNTHETIC-TEXT-NOT-FOR-CACHE"));
		const raw = JSON.parse(await readFile(join(home, "storages", "usage-cache.json"), "utf8"));
		assert.ok(!Object.hasOwn(raw.sessions, "legacy-child"));
		delete mixed.records.get("legacy-child").openFail; // unchanged revision must still be retried
		assert.equal((await collectUsage(context(mixed))).coverage.status, "complete");
	});
	await test("all unreadable sessions return unavailable totals, distinct from genuinely empty usage", async () => {
		const broken = store([["bad", [header]]]);
		broken.records.get("bad").fail = true;
		const result = await collectUsage(context(broken));
		assert.equal(result.coverage.status, "unavailable");
		assert.equal(result.coverage.countedSessions, 0);
		assert.equal(result.total, null);
		const empty = await collectUsage(context(store([])));
		assert.equal(empty.coverage.status, "complete");
		assert.equal(empty.total.tokens, 0);
	});
	await test("close failure and invalid logs are excluded and do not poison healthy totals", async () => {
		const mixed = store([["close-fail", [header]], ["gap", [{ ...header, seq: 1 }]], ["bad-prefix", [header], 2], ["healthy", [header, settlement(1, 10)]]]);
		mixed.records.get("close-fail").closeFail = true;
		const result = await collectUsage(context(mixed));
		assert.equal(result.total.tokens, 17);
		assert.equal(result.coverage.skippedSessions.length, 3);
		assert.equal(result.coverage.countedSessions, 1);
		assert.equal(mixed.stats.closes, 4);
	});
	await test("global persistence listing failure remains an error, not fabricated partial success", async () => {
		const broken = store([]);
		broken.list = async () => { throw new Error("fixture list failure"); };
		await assert.rejects(collectUsage(context(broken)), /fixture list failure/);
	});
	await test("real usage handler returns 200 plus explicit coverage with balance and Claude reads isolated", async () => {
		const mixed = store([["bad", [header]], ["healthy", [header, settlement(1, 15)]]]);
		mixed.records.get("bad").fail = true;
		const routes = [];
		const ctx = { ...context(mixed), webServer: { register: (route) => routes.push(route) }, effect: (fn) => fn() };
		await apply(ctx, { balanceEnabled: false }, { disableBackgroundRefresh: true, service: { validate: async () => {} }, claudeDir: join(home, "no-claude"), claudeCachePath: join(home, "claude-test-cache.json") });
		let status; let body;
		await routes.find((route) => route.path === USAGE_PATH).handler({ method: "GET", headers: { host: "127.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } }, { writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); } });
		assert.equal(status, 200);
		assert.equal(body.ok, true);
		assert.equal(body.coverage.status, "partial");
		assert.equal(body.total.tokens, 22);
	});
	await test("home normalization matches blank, relative and tilde rules", () => {
		for (const [raw, expected] of [["   ", join(homedir(), ".dsh")], ["~/fixture", join(homedir(), "fixture")], ["~\\fixture", join(homedir(), "fixture")], ["relative-fixture", resolve("relative-fixture")], [" fixture ", resolve(" fixture ")]]) {
			process.env.DSH_HOME = raw;
			assert.equal(dshHomeOf(), resolve(expected));
		}
		process.env.DSH_HOME = home;
	});
	const v2Events = [header, settlement(1, 30, { type: "assistant/attempt", direct: false }), { seq: 2, time, type: "llm/retry-started", data: { turn: 1, step: 1 } }, settlement(3, 100, { direct: false })];
	await test("embedded attempt usage + retry adds independently across fold boundaries", () => {
		const state = createUsageState();
		applyUsageDelta(state, v2Events.slice(0, 2));
		applyUsageDelta(state, v2Events.slice(2));
		assert.equal(totalTokens([...state.days.values()][0].totals), 144);
	});
	await test("explicit settlement usage wins over embedded stream and last sample wins", () => {
		const event = settlement(1, 50);
		event.data.stream.push({ type: "chunk", time, chunk: { type: "usage", usage: { inputTokens: 999, outputTokens: 0 } } });
		const state = createUsageState();
		applyUsageDelta(state, [header, event]);
		assert.equal(totalTokens([...state.days.values()][0].totals), 57);
		delete event.data.usage;
		const embedded = createUsageState();
		applyUsageDelta(embedded, [header, event]);
		assert.equal(totalTokens([...embedded.days.values()][0].totals), 999);
	});
	const forms = [{ ns: "custom-deepseek-entry", value: { apiKeyEnv: "FIXTURE_DS", baseURL: "https://api.deepseek.com/anthropic" } }, { ns: "custom-pi-entry", value: { providers: { moonshotai: { apiKeyEnv: "FIXTURE_MOON", baseURL: "https://api.moonshot.ai/v1" }, openrouter: {} } } }];
	const directory = [{ provider: "deepseek-official", displayName: "DeepSeek", settingsNs: forms[0].ns, settingsPath: [] }, ...["moonshotai", "openrouter", "absent"].map((provider) => ({ provider, displayName: provider, settingsNs: forms[1].ns, settingsPath: ["providers", provider] }))];
	const providerCtx = { get: (name) => name === "settings" ? { describe: (options) => { assert.equal(options.redactSecrets, true); return forms; } } : name === "llm" ? { listConfigurableProviders: () => directory } : void 0 };
	await test("redacted forms follow directory entry ids and paths, not fixed namespaces", async () => {
		const providers = await configuredProviders(providerCtx);
		assert.equal(providers.find((p) => p.id === "deepseek-official").apiKeyEnv, "FIXTURE_DS");
		assert.equal(providers.find((p) => p.id === "moonshotai").apiKeyEnv, "FIXTURE_MOON");
		assert.ok(!providers.some((p) => p.id === "absent"));
		assert.equal(providers.find((p) => p.id === "openrouter").apiKeyEnv, "OPENROUTER_MANAGEMENT_KEY");
	});
	await test("stored API-key record is supported but OAuth grants stay opaque", async () => {
		delete forms[1].value.providers.moonshotai.apiKeyEnv;
		let kind = "api-key";
		const service = createBalanceService({ credentials: { readRecord: async (key) => { assert.equal(key, "llm-pi-ai/moonshotai"); return { kind, key: "SYNTHETIC-KEY", payload: { secret: "NEVER-INTERPRET" } }; } }, getProviders: () => configuredProviders(providerCtx), deps: { fetchImpl: async () => ({ ok: true, json: async () => ({ data: { available_balance: 9 } }) }) } });
		assert.equal((await service.get("moonshotai", { force: true })).status, "ok");
		kind = "grant";
		assert.equal((await service.get("moonshotai", { force: true })).status, "not-configured");
	});
	await test("balanceEnabled=false prevents all credential resolution and requests", async () => {
		const routes = [];
		let reads = 0;
		const credentials = { resolve: () => { reads += 1; throw new Error("credential access forbidden"); }, readRecord: () => { reads += 1; throw new Error("credential record access forbidden"); } };
		await apply({ ...providerCtx, webServer: { register: (route) => routes.push(route) }, effect: (fn) => fn(), get: (name) => name === "credentials" ? credentials : providerCtx.get(name) }, { balanceEnabled: false }, { disableBackgroundRefresh: true, fetchImpl: () => { throw new Error("network forbidden"); } });
		for (const path of [PROVIDERS_PATH, BALANCE_PATH]) {
			let body;
			await routes.find((route) => route.path === path).handler({ method: "GET", url: path, headers: { host: "localhost" }, socket: { remoteAddress: "127.0.0.1" } }, { writeHead: (status) => assert.equal(status, 200), end: (value) => { body = JSON.parse(value); } });
			assert.equal(body.account?.status ?? body.providers[0].status, "disabled");
		}
		assert.equal(reads, 0);
	});
	await test("v2 exact icon exports render the real client dock (no wildcard mock)", async () => {
		let declaration;
		const primitives = { Tooltip: (props) => props.children };
		for (const key of ["IconChevronLeftOutlineRegular", "IconRefreshOutlineRegular", "IconSettingsOutlineRegular", "IconDataOutlineRegular", "IconCloseOutlineRegular"]) primitives[key] = () => react.createElement("span", { "data-fixture-icon": key });
		const sandbox = { window: { __ModuleLoader__: { load: (entry) => { declaration = entry; } } }, console };
		vm.runInNewContext(await readFile(join(packageRoot, "lib", "client.js"), "utf8"), sandbox, { timeout: 1000 });
		const client = declaration.factory((name) => {
			if (name === "react") return react;
			if (name === "react/jsx-runtime") return jsxRuntime;
			if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
			throw new Error(`unexpected require: ${name}`);
		});
		const html = renderToString(react.createElement(client.UsagePanel, { wide: true, t: (key) => key }));
		assert.ok(html.includes("data-dsh-usage-dock"));
		assert.ok(html.includes("IconSettingsOutlineRegular"));
		assert.equal(primitives.IconSettingsOutline14, void 0, "shared module was not mutated");
	});
	if (process.argv[3]) {
		await test("same fixture totals match the actual 0.2 token-meter fold", async () => {
			const sdk = resolve(process.argv[3]);
			const { tokenUsageProjectionDefinition: definition } = await import(pathToFileURL(join(sdk, "@deepseek-ai", "dsh-token-meter", "lib", "types", "usage-projection.js")).href);
			let state = definition.init();
			for (const event of v2Events) state = definition.apply(state, event);
			assert.equal(state.totals.uncachedInputTokens + state.totals.outputTokens + state.totals.cacheReadTokens + state.totals.cacheWriteTokens, 144);
		});
	}
	console.log(`${passed} modern tests passed`);
} finally {
	if (originalHome === void 0) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome;
	await rm(home, { recursive: true, force: true }); // Exact mkdtemp-owned fixture only.
}
