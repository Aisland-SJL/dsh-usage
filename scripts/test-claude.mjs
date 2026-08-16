#!/usr/bin/env node
/**
 * dsh-usage — offline Claude Code JSONL aggregation tests.
 * Runs against temporary directories; verifies the privacy boundary too
 * (message text must never reach the persistent cache).
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bucketsOfClaude, collectClaudeUsage, parseChunk, resetClaudeState, createFileState } from "../lib/claude.js";
import { totalTokens } from "../lib/usage.js";

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

const TIMESTAMP = "2026-08-15T10:30:00.000Z";

function assistantLine(usage, timestamp = TIMESTAMP, model = "deepseek-v4-pro") {
	return JSON.stringify({
		type: "assistant",
		timestamp,
		message: { model, usage }
	}) + "\n";
}

function userLine(secret) {
	return JSON.stringify({ type: "user", timestamp: TIMESTAMP, message: { content: secret } }) + "\n";
}

async function freshHome() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-usage-claude-"));
	const projects = join(dir, "projects");
	await mkdir(projects, { recursive: true });
	return { dir, projects };
}

function depsFor(home) {
	return {
		claudeDir: home.dir,
		cachePath: join(home.dir, "cache.json"),
		refreshMs: 0,
		logger: { warn: () => {} }
	};
}

await test("bucketsOfClaude maps Claude usage fields onto shared buckets", () => {
	const buckets = bucketsOfClaude({
		input_tokens: 100,
		output_tokens: 50,
		cache_read_input_tokens: 30,
		cache_creation_input_tokens: 20
	});
	assert.deepEqual(buckets, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 20 });
	assert.equal(totalTokens(bucketsOfClaude({})), 0, "missing fields default to zero");
});

await test("parseChunk folds assistant usage, skips other types, survives corrupt lines", () => {
	const state = createFileState();
	const tail = parseChunk(state, [
		assistantLine({ input_tokens: 10, output_tokens: 5 }),
		userLine("secret text"),
		"not json at all\n",
		assistantLine({ input_tokens: 2, output_tokens: 1 })
	].join(""));
	assert.equal(tail, "", "chunk ending on newline has no tail");
	assert.equal(state.total.inputTokens, 12);
	assert.equal(state.total.outputTokens, 6);
	const day = [...state.days.keys()][0];
	assert.ok(day !== void 0, "day bucket created");
});

await test("parseChunk returns the unterminated tail line", () => {
	const state = createFileState();
	const tail = parseChunk(state, assistantLine({ input_tokens: 1, output_tokens: 1 }) + '{"type":"assistant","timestamp":"2026-08-15T11:00:00Z","message":{"usage":{"inp');
	assert.ok(tail.startsWith('{"type":"assistant"'), "partial line returned as tail");
	assert.equal(state.total.inputTokens, 1, "complete line folded, partial not");
	// Feeding the tail back with the remainder completes the line.
	const state2 = createFileState();
	const tail2 = parseChunk(state2, 'ut_tokens":7,"output_tokens":3}}}\n', tail);
	assert.equal(tail2, "");
	assert.equal(state2.total.inputTokens, 7);
});

await test("collect: missing claude dir reports disabled", async () => {
	resetClaudeState();
	const home = await freshHome();
	const missing = { ...depsFor(home), claudeDir: join(home.dir, "nope") };
	const view = await collectClaudeUsage(missing);
	assert.deepEqual(view, { enabled: false });
	await rm(home.dir, { recursive: true, force: true });
});

await test("collect: full scan folds every assistant usage into day and hour buckets", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	await writeFile(log, assistantLine({ input_tokens: 40, output_tokens: 20 }) + assistantLine({ input_tokens: 4, output_tokens: 2 }));
	const view = await collectClaudeUsage(depsFor(home));
	assert.equal(view.enabled, true);
	assert.equal(view.files, 1);
	assert.equal(view.total.tokens, 66);
	assert.equal(view.days.length, 1);
	const hour = new Date(TIMESTAMP).getHours();
	assert.equal(view.days[0].hours[hour], 66, "hour bucket attributed");
	await rm(home.dir, { recursive: true, force: true });
});

await test("collect: incremental tail reads only appended bytes", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	await writeFile(log, assistantLine({ input_tokens: 10, output_tokens: 5 }));
	const first = await collectClaudeUsage(depsFor(home));
	assert.equal(first.total.tokens, 15);
	await appendFile(log, assistantLine({ input_tokens: 3, output_tokens: 2 }));
	const second = await collectClaudeUsage(depsFor(home));
	assert.equal(second.total.tokens, 20, "appended line folded");
	// Idempotent: unchanged file adds nothing.
	const third = await collectClaudeUsage(depsFor(home));
	assert.equal(third.total.tokens, 20);
	await rm(home.dir, { recursive: true, force: true });
});

await test("collect: truncated file is re-parsed whole without double counting", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	await writeFile(log, assistantLine({ input_tokens: 10, output_tokens: 5 }));
	assert.equal((await collectClaudeUsage(depsFor(home))).total.tokens, 15);
	// Truncate: only a smaller tail remains.
	await writeFile(log, assistantLine({ input_tokens: 2, output_tokens: 1 }));
	const view = await collectClaudeUsage(depsFor(home));
	assert.equal(view.total.tokens, 3, "truncation refolds, no stale data");
	await rm(home.dir, { recursive: true, force: true });
});

await test("collect: pending tail completes across refreshes", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	const full = assistantLine({ input_tokens: 6, output_tokens: 4 });
	await writeFile(log, full.slice(0, 40)); // half-written line
	const first = await collectClaudeUsage(depsFor(home));
	assert.equal(first.total.tokens, 0, "half line not yet folded");
	await appendFile(log, full.slice(40));
	const second = await collectClaudeUsage(depsFor(home));
	assert.equal(second.total.tokens, 10, "completed line folded exactly once");
	await rm(home.dir, { recursive: true, force: true });
});

await test("collect: removed files leave the view", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	await writeFile(log, assistantLine({ input_tokens: 10, output_tokens: 5 }));
	assert.equal((await collectClaudeUsage(depsFor(home))).files, 1);
	await rm(log);
	const view = await collectClaudeUsage(depsFor(home));
	assert.equal(view.files, 0);
	assert.equal(view.total.tokens, 0);
	await rm(home.dir, { recursive: true, force: true });
});

await test("collect: fresh cache path still reports enabled", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	await writeFile(log, assistantLine({ input_tokens: 10, output_tokens: 5 }));
	const deps = { ...depsFor(home), refreshMs: 60000 };
	const first = await collectClaudeUsage(deps);
	assert.equal(first.enabled, true);
	const second = await collectClaudeUsage(deps);
	assert.equal(second.enabled, true, "cached view keeps the enabled flag");
	assert.equal(second.total.tokens, 15);
	await rm(home.dir, { recursive: true, force: true });
});

await test("privacy: message text never reaches the persistent cache", async () => {
	resetClaudeState();
	const home = await freshHome();
	const log = join(home.projects, "session.jsonl");
	await writeFile(log, userLine("SUPER-SECRET-PROMPT-98231") + assistantLine({ input_tokens: 10, output_tokens: 5 }));
	const view = await collectClaudeUsage(depsFor(home));
	assert.equal(view.total.tokens, 15);
	const cacheRaw = await readFile(join(home.dir, "cache.json"), "utf8");
	assert.ok(!cacheRaw.includes("SUPER-SECRET"), "prompt text absent from cache");
	assert.ok(!cacheRaw.includes("SECRET"), "cache holds only aggregates and cursors");
	assert.ok(cacheRaw.includes('"cursor"'), "per-file cursor persisted");
	await rm(home.dir, { recursive: true, force: true });
});

console.log(`\n${passed} claude tests passed`);
