#!/usr/bin/env node
/**
 * dsh-usage — jsdom end-to-end client test (v0.2 widget architecture).
 * Mounts the real bundle inside a DOM, feeds it mock endpoint data shaped
 * exactly like the live server responses, and drives the customization
 * flows: dock render → open panel → pin/collapse/hide/restore → theme
 * customization → provider switch → day drilldown. No browser, no network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import react from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { Simulate, act } from "react-dom/test-utils";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "lib", "client.js"), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

//#region environment

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
	url: "http://127.0.0.1:3080/",
	runScripts: "dangerously",
	pretendToBeVisual: true
});
const globals = {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	HTMLSelectElement: dom.window.HTMLSelectElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	SVGElement: dom.window.SVGElement,
	Event: dom.window.Event,
	MouseEvent: dom.window.MouseEvent,
	CustomEvent: dom.window.CustomEvent,
	Node: dom.window.Node,
	MessageChannel: dom.window.MessageChannel,
	getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
	requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
	cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
	IS_REACT_ACT_ENVIRONMENT: false
};
for (const [key, value] of Object.entries(globals)) {
	try {
		Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
	} catch {
		/* skip read-only built-ins */
	}
}

let declaration = null;
dom.window.__ModuleLoader__ = { load: (handoff) => { declaration = handoff; } };

//#endregion

//#region fixtures (mirror the live endpoint shapes)

const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const dayLabelOf = (date) => `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const PROVIDERS = [
	{ id: "deepseek-official", displayName: "DeepSeek", scheme: "deepseek", configured: true, status: "ok", fetchedAt: Date.now(), balance: { isAvailable: true, currency: "CNY", total: "128.00", granted: "0.00", toppedUp: "128.00" } },
	{ id: "openrouter", displayName: "OpenRouter", scheme: "openrouter", configured: false, status: "not-configured", fetchedAt: Date.now(), balance: null },
	{ id: "zai", displayName: "Z.ai", scheme: "zai", configured: false, status: "not-configured", fetchedAt: Date.now(), balance: null }
];
const ACCOUNT = { id: "deepseek-official", displayName: "DeepSeek", scheme: "deepseek", mode: "balance", status: "ok", balance: { isAvailable: true, currency: "CNY", total: "128.00", granted: "0.00", toppedUp: "128.00" }, fetchedAt: Date.now() };
const OPENROUTER_ACCOUNT = { id: "openrouter", displayName: "OpenRouter", scheme: "openrouter", mode: "balance", status: "not-configured", balance: null, missingCredentials: ["OPENROUTER_MANAGEMENT_KEY"], fetchedAt: Date.now() };
const USAGE = {
	ok: true,
	days: [{
		date: todayKey,
		inputTokens: 100,
		outputTokens: 50,
		cacheReadTokens: 1000,
		cacheWriteTokens: 0,
		tokens: 1150,
		cacheHitRate: 87,
		hours: (() => {
			const hours = new Array(24).fill(0);
			hours[10] = 400;
			hours[11] = 750;
			return hours;
		})(),
		models: [{ model: "deepseek-official/deepseek-v4-pro", inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 0, tokens: 1150, cacheHitRate: 87 }]
	}],
	total: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 0, tokens: 1150, cacheHitRate: 87 },
	claude: {
		enabled: true,
		files: 1,
		days: [{
			date: todayKey,
			inputTokens: 300,
			outputTokens: 120,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			tokens: 420,
			cacheHitRate: 0,
			hours: new Array(24).fill(0)
		}],
		total: { inputTokens: 300, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: 420, cacheHitRate: 0 }
	},
	updatedAt: Date.now()
};

const fetchCalls = [];
const okResponse = (data) => ({ ok: true, status: 200, json: async () => data });
dom.window.fetch = async (input) => {
	const url = String(input);
	fetchCalls.push(url);
	if (url.includes("/api/usage/providers")) return okResponse({ ok: true, providers: PROVIDERS });
	if (url.includes("/api/usage/balance")) {
		const account = url.includes("openrouter") ? OPENROUTER_ACCOUNT : ACCOUNT;
		return okResponse({ ok: true, account });
	}
	if (url.includes("/api/usage/usage")) return okResponse(USAGE);
	throw new Error(`unexpected fetch: ${url}`);
};

//#endregion

//#region primitives mock + bundle load

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

dom.window.eval(clientSource);
assert.ok(declaration !== null, "bundle registered on the mock sink");
const clientExports = declaration.factory(mockRequire);
const { UsagePanel } = clientExports;

// Dictionaries captured from the plugin body.
const captured = { dictionaries: null };
const captureCtx = {
	effect: (fn) => fn(),
	locale: { register: (ns, dicts) => { captured.dictionaries = dicts; } },
	slots: {
		inject: (_name, callback) => { callback(); },
		register: (spec) => spec
	}
};
clientExports.apply(captureCtx);
const t = (key) => captured.dictionaries?.zh[key] ?? key;

let currentRoot = null;
const freshMount = async () => {
	dom.window.localStorage.clear();
	if (currentRoot !== null) currentRoot.unmount();
	const container = document.getElementById("root");
	container.innerHTML = "";
	currentRoot = createRoot(container);
	currentRoot.render(react.createElement(UsagePanel, { wide: true, t }));
	await sleep(180);
};

function setNativeValue(element, value) {
	const proto = Object.getPrototypeOf(element);
	const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
	setter.call(element, value);
}

const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];

//#region flows

await test("dock renders pinned compacts with live values", async () => {
	await freshMount();
	const dock = q("[data-dsh-usage-dock]");
	assert.ok(dock !== null, "dock rendered");
	const items = qa(".u_dockItem");
	assert.equal(items.length, 4, "default pinned widgets: balance + today + month + hit");
	const balanceItem = q(".u_dockItem[data-widget=balance] .u_floatValue");
	assert.equal(balanceItem.textContent, "¥128.00");
	assert.equal(balanceItem.getAttribute("data-tone"), "ok", "healthy balance renders green");
	const todayItem = q(".u_dockItem[data-widget=today] .u_floatValue");
	assert.equal(todayItem.textContent, "1.1k");
	assert.ok(q(".u_dockItem[data-widget=month]") !== null, "month pinned by default");
	assert.ok(q(".u_dockItem[data-widget=hit]") !== null, "hit pinned by default");
});

await test("clicking a dock item opens the panel with all widgets", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const panel = q("[data-dsh-usage-panel]");
	assert.ok(panel !== null, "panel rendered");
	const widgets = qa("[data-dsh-usage-panel] .u_widget");
	assert.equal(widgets.length, 7, "all seven widgets visible (incl. heatmap + dual)");
	assert.ok(panel.textContent.includes("¥128.00"), "balance detail shown");
	assert.ok(panel.textContent.includes(t("widget.today")), "today widget present");
	// Breakdown items must carry the real bucket values, not zeroes.
	const breakItems = [...q("[data-dsh-usage-panel] .u_widget[data-widget=today]").querySelectorAll(".u_statBreakItem")];
	assert.equal(breakItems.length, 3, "input/output/cacheRead items present");
	assert.deepEqual(breakItems.map((el) => el.textContent), ["输入 100", "输出 50", "缓存读 1.0k"], "bucket values populated");
});

await test("dual widget compares the DSH and Claude Code channels", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const dual = q("[data-dsh-usage-panel] .u_widget[data-widget=dual]");
	assert.ok(dual !== null, "dual widget present");
	const rows = qa("[data-dsh-usage-panel] .u_widget[data-widget=dual] .u_dualRow");
	assert.equal(rows.length, 2);
	// DSH 1150 / (1150 + 420) ≈ 73%; Claude ≈ 27%.
	assert.ok(rows[0].textContent.includes("DSH 通道"), "dsh channel row");
	assert.ok(rows[0].textContent.includes("73%"), "dsh share shown");
	assert.ok(rows[1].textContent.includes("Claude Code"), "claude channel row");
	assert.ok(rows[1].textContent.includes("27%"), "claude share shown");
	const bar = q("[data-dsh-usage-panel] .u_widget[data-widget=dual] .u_dualBar");
	assert.ok(bar !== null, "ratio bar rendered");
});

await test("heatmap widget renders the 28×6 activity grid with date labels", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const grid = q("[data-dsh-usage-panel] .u_widget[data-widget=heatmap] .u_heatGrid");
	assert.ok(grid !== null, "heatmap grid rendered");
	const cells = qa("[data-dsh-usage-panel] .u_widget[data-widget=heatmap] .u_heatCell");
	assert.equal(cells.length, 28 * 6, "28 day columns × 6 four-hour rows");
	const hourLabels = qa("[data-dsh-usage-panel] .u_widget[data-widget=heatmap] .u_heatHour");
	assert.equal(hourLabels.length, 6);
	assert.equal(hourLabels[0].textContent, "00");
	assert.equal(hourLabels[2].textContent, "08");
	assert.equal(hourLabels[5].textContent, "20");
	// GitHub-style date labels above the columns (window start + month starts).
	const monthLabels = qa("[data-dsh-usage-panel] .u_widget[data-widget=heatmap] .u_heatMonthLabel");
	assert.equal(monthLabels.length, 28);
	assert.ok(monthLabels.some((label) => label.textContent !== ""), "at least one date label rendered");
	assert.equal(monthLabels[0].textContent, dayLabelOf(new Date(Date.now() - 27 * 86400000)), "window start labeled");
	// Today 10-12h has usage → row 2 (8-12h) today cell carries the aggregate.
	const todayColumn = cells.filter((cell) => cell.getAttribute("title")?.includes(todayKey));
	assert.equal(todayColumn.length, 6, "today column present");
	const hotCell = todayColumn.find((cell) => cell.getAttribute("title")?.includes("08:00–12:00"));
	assert.ok(hotCell !== undefined, "8-12h cell present");
	assert.ok(hotCell.getAttribute("title").includes("1,150"), "four-hour aggregate in tooltip");
	assert.ok(todayColumn.some((cell) => cell.className.includes("u_heatToday")), "today column marked");
});

await test("pin toggles a widget out of and back into the dock", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const balanceHead = q("[data-dsh-usage-panel] .u_widget[data-widget=balance] .u_widgetHead");
	const pinButton = [...balanceHead.querySelectorAll(".u_wIconBtn")].find((b) => b.getAttribute("aria-label") === t("action.unpin"));
	assert.ok(pinButton !== null, "unpin button present (balance pinned by default)");
	pinButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(qa(".u_dockItem").length, 3, "balance left the dock");
	assert.equal(q(".u_dockItem[data-widget=balance]"), null, "balance compact removed");
	// Pin it back.
	pinButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(qa(".u_dockItem").length, 4, "balance rejoined the dock");
	assert.ok(q(".u_dockItem[data-widget=balance]") !== null, "balance compact restored");
	assert.equal(pinButton.getAttribute("data-pinned"), "true", "pin state toggled");
});

await test("cards lay out two-per-row with drag grip, hover actions, and renamed titles", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const panel = q("[data-dsh-usage-panel]");
	// Two-column grid with full/half width classes.
	const grid = q("[data-dsh-usage-panel] .u_grid");
	assert.ok(grid !== null, "grid container present");
	assert.equal(q(".u_widget[data-widget=balance]").getAttribute("data-width"), "full");
	assert.equal(q(".u_widget[data-widget=today]").getAttribute("data-width"), "half");
	assert.equal(q(".u_widget[data-widget=dual]").getAttribute("data-width"), "half");
	assert.equal(q(".u_widget[data-widget=recent]").getAttribute("data-width"), "full");
	// Renamed titles.
	assert.ok(panel.textContent.includes("用量记录"), "recent renamed to 用量记录");
	assert.ok(panel.textContent.includes("通道比例"), "dual renamed to 通道比例");
	// Drag grip present; arrow move buttons gone.
	const todayHead = q(".u_widget[data-widget=today] .u_widgetHead");
	assert.ok(todayHead.querySelectorAll("svg rect").length >= 3, "grip icon rendered");
	assert.equal([...todayHead.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t("action.moveUp")), undefined, "no move-up button");
	assert.equal([...todayHead.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t("action.moveDown")), undefined, "no move-down button");
	// Pin/hide carry the hover-only class; cards are draggable. (hit is pinned
	// by default now, so its aria-label reads "unpin".)
	const hitHead = q(".u_widget[data-widget=hit] .u_widgetHead");
	const pin = [...hitHead.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t("action.unpin"));
	assert.ok(pin !== undefined, "pin button present");
	assert.ok(pin.className.includes("u_wHoverBtn"), "pin is hover-only");
	assert.equal(q(".u_widget[data-widget=today]").getAttribute("draggable"), "true", "card draggable");
});

await test("drag shows a ghost slot and commits the order on drop", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const monthCard = q(".u_widget[data-widget=month]");
	monthCard.dispatchEvent(new dom.window.Event("dragstart", { bubbles: true, cancelable: true }));
	await sleep(40);
	assert.equal(monthCard.getAttribute("data-dragging"), "true", "dragged card dimmed");
	// Hover the balance card: a dashed ghost placeholder appears at its slot.
	q(".u_widget[data-widget=balance]").dispatchEvent(new dom.window.Event("dragover", { bubbles: true, cancelable: true }));
	await sleep(60);
	const ghost = q(".u_widget[data-widget=__ghost__]");
	assert.ok(ghost !== null, "ghost placeholder shown");
	// Drop commits the reorder once.
	monthCard.dispatchEvent(new dom.window.Event("dragend", { bubbles: true }));
	await sleep(100);
	assert.equal(q(".u_widget[data-widget=__ghost__]"), null, "ghost removed after drop");
	const order = [...qa("[data-dsh-usage-panel] .u_widget")].map((el) => el.getAttribute("data-widget")).filter((id) => id !== null);
	assert.ok(order.indexOf("month") < order.indexOf("balance"), "month moved before balance");
	assert.equal(monthCard.getAttribute("data-dragging"), null, "dim state cleared");
});

await test("gear toggles the panel and the refresh button sits beside it", async () => {
	await freshMount();
	assert.ok(q(".u_dockRefresh") !== null, "refresh button beside gear");
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "panel opened via gear");
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-panel]"), null, "second gear click closes the panel");
});

await test("rail mode: balance button reveals the dock and scrim closes it", async () => {
	await freshMount();
	// Remount with wide=false for the rail flow.
	dom.window.localStorage.clear();
	if (currentRoot !== null) currentRoot.unmount();
	const container = document.getElementById("root");
	container.innerHTML = "";
	currentRoot = createRoot(container);
	currentRoot.render(react.createElement(UsagePanel, { wide: false, t }));
	await sleep(150);
	const railBtn = q("[data-dsh-usage-rail]");
	assert.ok(railBtn !== null, "rail button rendered");
	assert.ok(railBtn.textContent.includes("余额"), "balance label shown");
	assert.equal(q("[data-dsh-usage-dock]"), null, "dock hidden initially");
	railBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.ok(q("[data-dsh-usage-dock]") !== null, "dock revealed on click");
	assert.ok(q(".u_railScrim") !== null, "scrim present");
	// Gear opens the detail panel from the dock.
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "detail panel opened from dock gear");
	// Close the panel; scrim click collapses the dock back to the button.
	const closeButton = [...qa("[data-dsh-usage-panel] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.close"));
	closeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	q(".u_railScrim").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]"), null, "dock collapsed after scrim click");
	assert.ok(q("[data-dsh-usage-rail]") !== null, "rail button back");
});

await test("collapse hides a widget body, hide removes it and restore brings it back", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	// Collapse today.
	const todayWidget = q("[data-dsh-usage-panel] .u_widget[data-widget=today]");
	todayWidget.querySelector(".u_widgetTitle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(todayWidget.querySelector(".u_wBody"), null, "collapsed body removed");
	// Expand again.
	todayWidget.querySelector(".u_widgetTitle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.ok(todayWidget.querySelector(".u_wBody") !== null, "expanded body restored");
	// Hide hit.
	const hitWidget = q("[data-dsh-usage-panel] .u_widget[data-widget=hit]");
	const hideButton = [...hitWidget.querySelectorAll(".u_wIconBtn")].find((b) => b.getAttribute("aria-label") === t("action.hide"));
	hideButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-panel] .u_widget[data-widget=hit]"), null, "hidden widget gone from panel");
	assert.ok(q("[data-dsh-usage-panel]").textContent.includes("已隐藏 1 项"), "hidden manager shows count");
	// Restore.
	q("[data-dsh-usage-panel] .u_restore").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.ok(q("[data-dsh-usage-panel] .u_widget[data-widget=hit]") !== null, "widget restored");
});

await test("theme customizer changes accent, background, and opacity", async () => {
	await freshMount();
	// Open via dock gear: the customizer stays collapsed by default.
	q(".u_dockSettings").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.equal(q("[data-dsh-usage-panel] .u_themeBox"), null, "customizer collapsed on open");
	// Expand it via the header customize button.
	const customizeButton = [...qa("[data-dsh-usage-panel] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.customize"));
	assert.ok(customizeButton !== undefined, "customize button present");
	customizeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	const themeBox = q("[data-dsh-usage-panel] .u_themeBox");
	assert.ok(themeBox !== null, "customizer expanded on demand");
	// Accent: pick the second preset swatch (#0ea5e9).
	const accentSwatches = qa("[data-dsh-usage-panel] .u_themeRow")[0].querySelectorAll(".u_swatch");
	accentSwatches[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]").style.getPropertyValue("--u-accent"), "#0ea5e9", "dock accent updated");
	// Background: pick the dark preset (#0d1117, second button in row 2).
	const bgSwatches = qa("[data-dsh-usage-panel] .u_themeRow")[1].querySelectorAll(".u_swatch");
	bgSwatches[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]").style.getPropertyValue("--u-bg"), "#0d1117", "dock background updated");
	// Opacity slider to 0.5 (React controlled ranges need Simulate in jsdom).
	const slider = q("[data-dsh-usage-panel] .u_range");
	act(() => {
		Simulate.change(slider, { target: { value: "0.5" } });
	});
	await sleep(80);
	assert.equal(q("[data-dsh-usage-dock]").style.opacity, "0.5", "dock opacity updated");
});

await test("switching provider shows its not-configured state", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const select = q("[data-dsh-usage-panel] .u_providerSelect");
	setNativeValue(select, "openrouter");
	select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
	await sleep(100);
	const panel = q("[data-dsh-usage-panel]");
	assert.ok(panel.textContent.includes("OPENROUTER_MANAGEMENT_KEY"), "missing credential ref shown");
	assert.ok(fetchCalls.some((url) => url.includes("/api/usage/balance?provider=openrouter")), "balance fetched for switched provider");
});

await test("clicking a recent day opens the model breakdown", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	const dayRow = q("[data-dsh-usage-panel] .u_day");
	assert.ok(dayRow !== null, "recent day row present");
	dayRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(50);
	const panel = q("[data-dsh-usage-panel]");
	assert.ok(panel.textContent.includes("deepseek-official/deepseek-v4-pro"), "model breakdown rendered");
	const backButton = q("[data-dsh-usage-panel] .u_back");
	assert.ok(backButton !== null, "back button present");
	assert.equal(backButton.getAttribute("aria-label"), t("action.back"));
});

await test("closing the panel keeps the dock alive", async () => {
	await freshMount();
	q(".u_dockItem[data-widget=balance]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(100);
	assert.ok(q("[data-dsh-usage-panel]") !== null, "panel open");
	const closeButton = [...qa("[data-dsh-usage-panel] .u_iconButton")].find((b) => b.getAttribute("aria-label") === t("action.close"));
	closeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await sleep(80);
	assert.equal(q("[data-dsh-usage-panel]"), null, "panel closed");
	assert.ok(q("[data-dsh-usage-dock]") !== null, "dock persists");
	assert.equal(qa(".u_dockItem").length, 4, "pinned compacts persist");
});

//#endregion

if (currentRoot !== null) currentRoot.unmount();
dom.window.close();
console.log(`\n${passed} e2e tests passed`);
process.exit(0);
