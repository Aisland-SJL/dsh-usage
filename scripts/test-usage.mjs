#!/usr/bin/env node
/**
 * dsh-usage — offline token-usage aggregation tests.
 * Pure event logs; no harness, no network.
 */
import assert from "node:assert/strict";
import {
	applyUsageDelta,
	bucketsOf,
	cacheHitRate,
	createUsageState,
	dayKey,
	foldUsage,
	mergeHoursInto,
	mergeInto,
	renderUsage,
	totalTokens
} from "../lib/usage.js";

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

const DAY1 = Date.UTC(2025, 0, 10, 3, 0, 0);
const DAY2 = Date.UTC(2025, 0, 11, 3, 0, 0);

function header(time, model, provider = "deepseek-official") {
	return { seq: 1, time, type: "request/header", data: { header: { config: { model, provider } } } };
}

function usageChunk(seq, time, turn, step, usage) {
	return { seq, time, type: "assistant/chunk", data: { turn, step, chunk: { type: "usage", usage } } };
}

function message(seq, time, turn, step, usage, source) {
	return { seq, time, type: "assistant/message", data: { turn, step, usage, message: { source } } };
}

await test("dayKey uses local calendar boundaries", () => {
	assert.equal(dayKey(new Date(2025, 0, 10, 23, 59).getTime()).length, 10);
	assert.match(dayKey(DAY1), /^\d{4}-\d{2}-\d{2}$/);
});

await test("basic fold: header model attribution + chunk usage", () => {
	const events = [
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 })
	];
	const days = foldUsage(events);
	const entry = days.get(dayKey(DAY1));
	assert.equal(entry.totals.inputTokens, 100);
	assert.equal(entry.totals.outputTokens, 50);
	assert.equal(entry.totals.cacheReadTokens, 20);
	const model = entry.models.get("deepseek-official/deepseek-chat");
	assert.equal(model.outputTokens, 50);
});

await test("assistant/message usage path with explicit source attribution", () => {
	const events = [
		header(DAY1, "deepseek-chat"),
		message(2, DAY1, 1, 1, { inputTokens: 10, outputTokens: 5 }, { provider: "ark", model: "deepseek-chat" })
	];
	const entry = foldUsage(events).get(dayKey(DAY1));
	assert.equal(entry.totals.outputTokens, 5);
	assert.equal(entry.models.has("ark/deepseek-chat"), true);
	assert.equal(entry.models.has("deepseek-official/deepseek-chat"), false);
});

await test("same turn/step re-reported replaces instead of double counting", () => {
	const events = [
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 }),
		usageChunk(3, DAY1, 1, 1, { inputTokens: 120, outputTokens: 80 })
	];
	const entry = foldUsage(events).get(dayKey(DAY1));
	assert.equal(entry.totals.inputTokens, 120);
	assert.equal(entry.totals.outputTokens, 80);
	assert.equal(entry.models.get("deepseek-official/deepseek-chat").outputTokens, 80);
});

await test("replacement re-attributed to the later day across fold boundaries", () => {
	const state = createUsageState();
	// First slice ends with a partial sample on day 1.
	applyUsageDelta(state, [
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 })
	]);
	// Second slice continues the same turn/step on day 2 with a bigger sample.
	applyUsageDelta(state, [
		usageChunk(3, DAY2, 1, 1, { inputTokens: 150, outputTokens: 90 })
	]);
	const day1 = state.days.get(dayKey(DAY1));
	const day2 = state.days.get(dayKey(DAY2));
	assert.equal(day1.totals.inputTokens, 0, "day 1 sample subtracted back to zero");
	assert.equal(day1.totals.outputTokens, 0);
	assert.equal(day2.totals.inputTokens, 150);
	assert.equal(day2.totals.outputTokens, 90);
});

await test("distinct turn/step keys accumulate independently", () => {
	const events = [
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 }),
		usageChunk(3, DAY1, 1, 2, { inputTokens: 30, outputTokens: 10 }),
		usageChunk(4, DAY1, 2, 1, { inputTokens: 5, outputTokens: 2 })
	];
	const entry = foldUsage(events).get(dayKey(DAY1));
	assert.equal(entry.totals.inputTokens, 135);
	assert.equal(entry.totals.outputTokens, 62);
});

await test("samples without model info land in unknown/unknown", () => {
	const events = [usageChunk(2, DAY1, 1, 1, { inputTokens: 7, outputTokens: 3 })];
	const entry = foldUsage(events).get(dayKey(DAY1));
	assert.equal(entry.models.get("unknown/unknown").inputTokens, 7);
});

await test("cacheHitRate over the whole prompt side, null without prompt tokens", () => {
	assert.equal(cacheHitRate(bucketsOf({ inputTokens: 40, cacheReadTokens: 40, cacheWriteTokens: 20, outputTokens: 999 })), 40);
	assert.equal(cacheHitRate(bucketsOf({ outputTokens: 999 })), null);
	assert.equal(cacheHitRate(bucketsOf({ cacheReadTokens: 0, inputTokens: 10 })), 0);
});

await test("totalTokens sums every bucket", () => {
	assert.equal(totalTokens(bucketsOf({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })), 10);
});

await test("mergeInto combines sessions per day", () => {
	const byDay = new Map();
	const a = foldUsage([
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 })
	]);
	const b = foldUsage([
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 20, outputTokens: 10 }),
		usageChunk(3, DAY2, 2, 1, { inputTokens: 5, outputTokens: 2 })
	]);
	mergeInto(byDay, a);
	mergeInto(byDay, b);
	assert.equal(byDay.get(dayKey(DAY1)).totals.inputTokens, 120);
	assert.equal(byDay.get(dayKey(DAY2)).totals.outputTokens, 2);
});

await test("renderUsage sorts days ascending and models by tokens descending", () => {
	const byDay = new Map();
	mergeInto(byDay, foldUsage([
		header(DAY2, "deepseek-chat"),
		usageChunk(2, DAY2, 1, 1, { inputTokens: 5, outputTokens: 2 })
	]));
	mergeInto(byDay, foldUsage([
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 }),
		usageChunk(3, DAY1, 1, 2, { inputTokens: 10, outputTokens: 3 })
	]));
	const rendered = renderUsage(byDay, new Map(), 42);
	assert.deepEqual(rendered.days.map((d) => d.date), [dayKey(DAY1), dayKey(DAY2)]);
	assert.equal(rendered.days[0].tokens, 163);
	assert.equal(rendered.days[0].models.length, 1);
	assert.equal(rendered.days[0].hours.length, 24, "hour slots always rendered");
	assert.equal(rendered.total.tokens, 170);
	assert.equal(rendered.updatedAt, 42);
});

await test("renderUsage models sorted descending within a day", () => {
	const byDay = new Map();
	mergeInto(byDay, foldUsage([
		header(DAY1, "big-model"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 10, outputTokens: 90 }),
		header(DAY1, "small-model"),
		usageChunk(3, DAY1, 2, 1, { inputTokens: 5, outputTokens: 5 })
	]));
	const rendered = renderUsage(byDay, new Map(), 0);
	assert.deepEqual(rendered.days[0].models.map((m) => m.model), ["deepseek-official/big-model", "deepseek-official/small-model"]);
});

await test("hour buckets attribute samples to local hours", () => {
	const events = [
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 })
	];
	const state = createUsageState();
	applyUsageDelta(state, events);
	const hours = state.hours.get(dayKey(DAY1));
	assert.ok(hours !== void 0, "hour slots exist");
	assert.equal(hours.length, 24);
	const expectedHour = new Date(DAY1).getHours();
	assert.equal(hours[expectedHour], 150, "all tokens land in the event hour");
	assert.equal(hours[(expectedHour + 1) % 24], 0);
});

await test("hour buckets follow the replace-last-sample semantics across days", () => {
	const state = createUsageState();
	const hour1 = new Date(DAY1).getHours();
	const hour2 = new Date(DAY2).getHours();
	applyUsageDelta(state, [
		header(DAY1, "deepseek-chat"),
		usageChunk(2, DAY1, 1, 1, { inputTokens: 100, outputTokens: 50 })
	]);
	// Same turn/step re-reported on the next day: subtract day1/hour1, add day2/hour2.
	applyUsageDelta(state, [
		usageChunk(3, DAY2, 1, 1, { inputTokens: 150, outputTokens: 90 })
	]);
	const day1 = state.hours.get(dayKey(DAY1));
	const day2 = state.hours.get(dayKey(DAY2));
	assert.equal(day1?.[hour1] ?? 0, 0, "day 1 hour bucket replaced back to zero");
	assert.equal(day2[hour2], 240);
});

await test("mergeHoursInto combines sessions per day", () => {
	const a = createUsageState();
	applyUsageDelta(a, [header(DAY1, "deepseek-chat"), usageChunk(2, DAY1, 1, 1, { inputTokens: 10, outputTokens: 5 })]);
	const b = createUsageState();
	applyUsageDelta(b, [header(DAY1, "deepseek-chat"), usageChunk(2, DAY1, 1, 1, { inputTokens: 20, outputTokens: 10 })]);
	const byHour = new Map();
	mergeHoursInto(byHour, a.hours);
	mergeHoursInto(byHour, b.hours);
	const expectedHour = new Date(DAY1).getHours();
	assert.equal(byHour.get(dayKey(DAY1))[expectedHour], 45);
});

console.log(`\n${passed} usage tests passed`);
