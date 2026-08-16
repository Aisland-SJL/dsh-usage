#!/usr/bin/env node
/**
 * dsh-usage — live Claude Code aggregation dry-run.
 * Runs the real aggregator against the real ~/.claude directory, printing
 * the channel view WITHOUT touching the runtime cache (temp cache path).
 * Usage: node scripts/validate-claude.mjs
 */
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { collectClaudeUsage, resetClaudeState } from "../lib/claude.js";

const cacheDir = await mkdtemp(join(tmpdir(), "dsh-claude-live-"));
resetClaudeState();
const t0 = Date.now();
const view = await collectClaudeUsage({
	claudeDir: join(homedir(), ".claude"),
	cachePath: join(cacheDir, "cache.json"),
	refreshMs: 0,
	logger: { warn: (message) => console.warn(`warn: ${message}`) }
});
const elapsed = Date.now() - t0;

console.log(`enabled: ${view.enabled}`);
if (!view.enabled) {
	console.log("No ~/.claude/projects found — the dual widget will show the disabled state.");
	process.exit(0);
}
console.log(`files: ${view.files} | days: ${view.days.length} | total tokens: ${view.total.tokens.toLocaleString("en-US")}`);
console.log(`input: ${view.total.inputTokens.toLocaleString("en-US")} | output: ${view.total.outputTokens.toLocaleString("en-US")} | cacheRead: ${view.total.cacheReadTokens.toLocaleString("en-US")} | cacheWrite: ${view.total.cacheWriteTokens.toLocaleString("en-US")}`);
console.log(`cache hit rate: ${view.total.cacheHitRate}`);
console.log(`scan time: ${elapsed}ms`);
const top = [...view.days].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
console.log(`top days: ${top.map((day) => `${day.date}=${day.tokens.toLocaleString("en-US")}`).join("  ")}`);
process.exit(0);
