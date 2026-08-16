#!/usr/bin/env node
/**
 * dsh-usage — offline client smoke tests (v0.2 widget architecture).
 * Captures the __ModuleLoader__ declaration, renders the dock server-side
 * with mocked primitives, exercises the settings engine, and materializes
 * the bundle through the real DSH client module loader. No browser, no
 * harness, no network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToString } from "react-dom/server";

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
async function test(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`ok ${name}`);
	} catch (error) {
		console.error(`FAIL ${name}`);
		throw error;
	}
}

//#region harness mock (must exist before importing the client bundle)

let capturedDeclaration = null;
globalThis.window = {
	__ModuleLoader__: {
		load: (declaration) => {
			capturedDeclaration = declaration;
		}
	}
};

function iconComponent(name) {
	return function Icon(props) {
		return react.createElement("span", { "data-icon": name, "data-size": props.size ?? null });
	};
}

const primitives = new Proxy({}, {
	get: (_target, name) => name === "Tooltip"
		? function Tooltip(props) {
			return react.createElement(react.Fragment, null, props.children);
		}
		: iconComponent(String(name))
});

const mockRequire = (name) => {
	if (name === "react") return react;
	if (name === "react/jsx-runtime") return jsxRuntime;
	if (name === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${name}`);
};

//#endregion

// The client bundle registers itself on window.__ModuleLoader__ at import time.
await import("../lib/client.js");
assert.ok(capturedDeclaration !== null, "declaration captured at import time");
const clientExports = capturedDeclaration.factory(mockRequire);
const {
	UsagePanel, fmtTokens, fmtCompact, fmtCurrency, fmtHit, heatLevel,
	heatColor, defaultSettings, normalizeSettings, createLoader
} = clientExports;

// Dictionaries are captured from the plugin body so tests never drift.
const captured = { dictionaries: null, slot: null };
const captureCtx = {
	effect: (fn) => fn(),
	locale: { register: (ns, dicts) => { captured.dictionaries = dicts; } },
	slots: {
		inject: (_name, callback) => { captured.slot = callback(); },
		register: (spec, component) => ({ spec, component })
	}
};
clientExports.apply(captureCtx);
const t = (key) => captured.dictionaries?.zh[key] ?? key;

await test("module loader captures the dsh-usage declaration", async () => {
	assert.equal(capturedDeclaration.id, "dsh-usage");
	assert.equal(typeof clientExports.apply, "function");
	assert.deepEqual(clientExports.inject, ["slots", "locale"]);
	assert.equal(typeof UsagePanel, "function");
});

await test("pure formatters and heat helpers", async () => {
	assert.equal(fmtTokens(12345), "12,345");
	assert.equal(fmtCompact(1234), "1.2k");
	assert.equal(fmtCompact(42800000), "42.8M");
	assert.equal(fmtCompact(1400000000), "1.4B");
	assert.equal(fmtCompact(999), "999");
	assert.equal(fmtCompact("nope"), "–");
	assert.equal(fmtCurrency(110.5, "CNY"), "¥110.50");
	assert.equal(fmtHit(null), "–");
	assert.equal(fmtHit(12.3), "12.3%");
	assert.equal(heatLevel(0, 100), 0);
	assert.equal(heatLevel(10, 100), 1);
	assert.equal(heatLevel(30, 100), 2);
	assert.equal(heatLevel(60, 100), 3);
	assert.equal(heatLevel(90, 100), 4);
	assert.ok(heatColor(4).includes("100%"), "max heat is full accent");
});

await test("settings: defaults, normalization, and persistence guard", async () => {
	const base = defaultSettings();
	assert.equal(base.theme.accent, "#1f6feb");
	assert.deepEqual(base.order, ["balance", "today", "month", "hit", "dual", "recent", "heatmap"]);
	assert.equal(base.widgets.balance.pinned, true);
	assert.equal(base.widgets.heatmap.pinned, true, "preset mirrors the user's settings");
	// Normalization clamps garbage and appends newly added widget ids.
	const normalized = normalizeSettings({ theme: { accent: "red", opacity: 0.1, background: "not-a-color" }, order: ["bogus", "balance"], widgets: { balance: { visible: false, pinned: true, collapsed: true } } });
	assert.equal(normalized.theme.accent, "#1f6feb", "invalid accent falls back");
	assert.equal(normalized.theme.opacity, 0.3, "opacity clamped to minimum");
	assert.equal(normalized.theme.background, null, "invalid background falls back");
	assert.deepEqual(normalized.order, ["balance", "today", "month", "hit", "dual", "recent", "heatmap"], "unknown ids dropped, new ids appended");
	assert.equal(normalized.widgets.balance.visible, false);
	assert.equal(normalized.widgets.today.visible, true, "missing widget state defaults");
	assert.equal(normalized.widgets.heatmap.visible, true, "new widget defaults visible");
});

await test("SSR: closed state renders only the floating dock", async () => {
	const html = renderToString(react.createElement(UsagePanel, { wide: true, t }));
	assert.ok(html.includes("data-dsh-usage-dock"), "dock rendered");
	assert.ok(html.includes("u_dockFrame"), "framed container rendered");
	assert.ok(html.includes("u_dockItem"), "pinned compact rows present");
	assert.ok(html.includes("u_dockDivider"), "dividers between rows");
	assert.ok(html.includes(t("widget.balance")), "balance label present");
	assert.ok(html.includes(t("widget.today")), "today label present");
	assert.ok(!html.includes("data-dsh-usage-panel"), "panel not rendered when closed");
	assert.ok(!html.includes("u_rail"), "no sidebar badge remnants");
});

await test("SSR: rail mode renders only the round balance button", async () => {
	const html = renderToString(react.createElement(UsagePanel, { wide: false, t }));
	assert.ok(html.includes("data-dsh-usage-rail"), "rail button rendered");
	assert.ok(html.includes("u_railLabel"), "balance label on the button");
	assert.ok(!html.includes("data-dsh-usage-dock"), "dock hidden until the button is clicked");
	assert.ok(!html.includes("data-dsh-usage-panel"), "panel hidden");
});

await test("plugin body registers dictionaries and the sidebar footer slot", async () => {
	assert.ok(captured.dictionaries !== null, "dictionaries captured");
	assert.equal(typeof captured.dictionaries.zh["widget.balance"], "string");
	assert.equal(typeof captured.dictionaries.en["widget.balance"], "string");
	assert.equal(captured.slot.spec.id, "usage");
	assert.equal(captured.slot.spec.locale, "dsh-usage");
	assert.equal(captured.slot.spec.order, 10);
	assert.equal(typeof captured.slot.component, "function");
});

await test("loader guards against stale responses", async () => {
	const loader = createLoader();
	const first = loader.start();
	assert.equal(loader.isCurrent(first), true);
	const second = loader.start();
	assert.equal(loader.isCurrent(first), false);
	assert.equal(loader.isCurrent(second), true);
});

await test("real DSH client module loader materializes the bundle", async () => {
	let loaderFactory = null;
	const loaderContext = vm.createContext({ console });
	loaderContext.window = loaderContext;
	loaderContext.__ModuleLoader__ = { load: (handoff) => { loaderFactory = handoff.factory; } };
	vm.runInContext(readFileSync(join(here, "..", "vendor", "dsh-client-modules-client.js"), "utf8"), loaderContext, { filename: "dsh-client-modules-client.js" });
	assert.ok(loaderFactory !== null, "loader factory captured");
	const { ClientModuleSystem } = loaderFactory(() => {
		throw new Error("the loader factory requires nothing");
	});
	delete loaderContext.__ModuleLoader__;
	const system = new ClientModuleSystem({
		staticModules: {
			react,
			"react/jsx-runtime": jsxRuntime,
			"@deepseek-ai/dsh-client-ui-primitives": primitives
		},
		modules: [{ id: "dsh-usage", url: "/plugins/dsh-usage/client.js?rev=test", rev: "test", inject: ["@deepseek-ai/dsh-client-locale"] }],
		loadBundle: async () => {
			globalThis.window = loaderContext;
			(0, eval)(readFileSync(join(here, "..", "lib", "client.js"), "utf8"));
		}
	});
	const row = system.graphRows.get("dsh-usage");
	await system.arrive(row);
	const record = system.materialize("dsh-usage");
	assert.equal(record.id, "dsh-usage");
	assert.equal(typeof record.exports.apply, "function");
	assert.deepEqual(record.exports.inject, ["slots", "locale"]);
	assert.equal(typeof record.exports.UsagePanel, "function");
	assert.ok(record.edges.has("react"), "react edge recorded");
	assert.ok(record.edges.has("react/jsx-runtime"), "jsx-runtime edge recorded");
	assert.ok(record.edges.has("@deepseek-ai/dsh-client-ui-primitives"), "primitives edge recorded");
	const imported = await system.import("dsh-usage");
	assert.equal(imported, record.exports);
});

console.log(`\n${passed} client tests passed`);
