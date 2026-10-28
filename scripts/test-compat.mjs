#!/usr/bin/env node
/**
 * Host-compatibility contract tests: older DSH session APIs (0.1.x `events`
 * array, 0.1.5 `snapshotEvents`/`ownEvents`) must never take the usage
 * endpoint down, and hosts without a persisted-log reader must degrade to a
 * reported skip instead of a 500 or a silent zero.
 *
 * Everything is synthetic; DSH_HOME is redirected to a temp directory.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const { collectUsage } = await import(pathToFileURL(join(packageRoot, "lib", "index.js")).href);

const home = await mkdtemp(join(tmpdir(), "dsh-usage-compat-"));
const originalHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;

let passed = 0;
async function test(label, fn) {
	await fn();
	console.log(`ok ${label}`);
	passed += 1;
}

const time = new Date(2026, 9, 1, 12).getTime();
const header = {
	seq: 0, time, type: "request/header",
	data: { header: { config: { provider: "deepseek-official", model: "fixture-model" } }, reason: "initial" }
};

function settlement(seq, tokens) {
	const usage = { inputTokens: tokens, outputTokens: 5, cacheReadTokens: 2 };
	return {
		seq, time, type: "assistant/message",
		data: {
			turn: 1, step: 1,
			message: { source: { provider: "deepseek-official", model: "fixture-model" }, content: [{ type: "text", text: "SYNTHETIC" }] },
			usage,
			stream: [{ type: "chunk", time, chunk: { type: "usage", usage } }]
		}
	};
}

const context = (sessions, persistence) => ({
	get: (name) => name === "sessions" ? { list: () => sessions } : name === "sessionPersistence" ? persistence : void 0,
	logger: { warn() {} }
});

try {
	await test("0.1.x shape: live events array + persisted readFrom stay complete", async () => {
		const persistence = {
			listSnapshots: async () => [{ header: { id: "persisted-b" }, revision: 1 }],
			readFrom: async () => ({ events: [header, settlement(1, 40)] })
		};
		const result = await collectUsage(context([{ id: "live-a", events: [header, settlement(1, 100)] }], persistence));
		assert.equal(result.total.tokens, 107 + 47);
		assert.equal(result.coverage.status, "complete");
		assert.equal(result.coverage.totalSessions, 2);
		assert.equal(result.coverage.countedSessions, 2);
	});

	await test("0.1.5 shape: live snapshotEvents works and a host without a reader degrades to skipped", async () => {
		const persistence = { listSnapshots: async () => [{ header: { id: "persisted-d" }, revision: 1 }] };
		const sessions = [{ id: "live-c", snapshotEvents: () => [header, settlement(1, 30)] }];
		const result = await collectUsage(context(sessions, persistence));
		assert.equal(result.total.tokens, 37, "readable live session is still counted");
		assert.equal(result.coverage.status, "partial");
		assert.equal(result.coverage.countedSessions, 1);
		assert.deepEqual(result.coverage.skippedSessions.map((entry) => entry.reason), ["unsupported-host"]);
	});

	await test("ownEvents fallback is accepted for forked live sessions", async () => {
		const sessions = [{ id: "fork-child", ownEvents: () => [header, settlement(1, 12)] }];
		const result = await collectUsage(context(sessions, void 0));
		assert.equal(result.total.tokens, 19);
		assert.equal(result.coverage.status, "complete");
	});

	await test("unknown live contract is skipped, never billed as zero and never fatal", async () => {
		const result = await collectUsage(context([{ id: "mystery" }], void 0));
		assert.equal(result.total, null, "unavailable, not a fake zero");
		assert.equal(result.coverage.status, "unavailable");
		assert.deepEqual(result.coverage.skippedSessions, [{ sessionId: "mystery", reason: "unsupported-session-api" }]);
	});

	await test("a throwing snapshotEvents only drops that session", async () => {
		const sessions = [
			{ id: "broken", snapshotEvents: () => { throw new Error("fixture failure"); } },
			{ id: "healthy", events: [header, settlement(1, 8)] }
		];
		const result = await collectUsage(context(sessions, void 0));
		assert.equal(result.total.tokens, 15);
		assert.equal(result.coverage.status, "partial");
		assert.equal(result.coverage.skippedSessions.length, 1);
		assert.equal(result.coverage.skippedSessions[0].sessionId, "broken");
	});

	console.log(`\n${passed} compat tests passed`);
} finally {
	if (originalHome === void 0) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = originalHome;
	await rm(home, { recursive: true, force: true });
}
