/**
 * dsh-usage — Claude Code JSONL aggregation.
 *
 * Scans `<claudeDir>/projects/**\/*.jsonl` and folds provider-reported usage
 * (assistant messages) into the same per-day/per-hour token buckets as the
 * DSH channel, so the panel can compare the two channels side by side.
 *
 * Privacy boundary: only usage NUMBERS are kept. Message content is parsed
 * line-by-line and discarded immediately; the persistent cache stores just
 * aggregated token buckets plus per-file read cursors — never any text.
 *
 * Incremental: each file is read from its last complete-line cursor; a
 * truncated/rewritten file is re-parsed whole; an in-progress tail line is
 * buffered in memory only (dropped on process restart, which merely skips
 * one line). A single-flight guard keeps concurrent requests cheap.
 *
 * @module dsh-usage/claude
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { cacheHitRate, dayKey, hourOf, totalTokens, zeroBuckets } from "./usage.js";

const CACHE_VERSION = 1;
const DEFAULT_REFRESH_MS = 300000;

/** Map a Claude usage object onto the shared token buckets. */
export function bucketsOfClaude(usage) {
	return {
		inputTokens: usage?.input_tokens ?? 0,
		outputTokens: usage?.output_tokens ?? 0,
		cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
		cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0
	};
}

function addInto(target, source) {
	target.inputTokens += source.inputTokens;
	target.outputTokens += source.outputTokens;
	target.cacheReadTokens += source.cacheReadTokens;
	target.cacheWriteTokens += source.cacheWriteTokens;
	return target;
}

/** One file's fold state: per-day buckets + per-day hour slots + total. */
export function createFileState() {
	return {
		cursor: 0,
		size: 0,
		days: new Map(),
		hours: new Map(),
		total: zeroBuckets()
	};
}

function addSample(fileState, timeMs, buckets) {
	const day = dayKey(timeMs);
	const hour = hourOf(timeMs);
	let entry = fileState.days.get(day);
	if (entry === void 0) {
		entry = zeroBuckets();
		fileState.days.set(day, entry);
	}
	addInto(entry, buckets);
	let hours = fileState.hours.get(day);
	if (hours === void 0) {
		hours = new Array(24).fill(0);
		fileState.hours.set(day, hours);
	}
	hours[hour] += totalTokens(buckets);
	addInto(fileState.total, buckets);
}

/**
 * Parse a chunk of JSONL text that starts at a line boundary. The final
 * line without a trailing newline is returned as the pending tail (the
 * caller feeds it back next time).
 * @param fileState - target fold state (mutated).
 * @param text - chunk text.
 * @param pendingPrefix - the previous partial line, prepended to the chunk.
 * @returns the new pending tail ("" when the chunk ends on a newline).
 */
export function parseChunk(fileState, text, pendingPrefix = "") {
	const buffer = pendingPrefix + text;
	const endsWithNewline = buffer.endsWith("\n");
	const lines = buffer.split("\n");
	const completeLines = endsWithNewline ? lines.slice(0, -1) : lines.slice(0, -1);
	const tail = endsWithNewline ? "" : lines[lines.length - 1];
	for (const line of completeLines) {
		if (line === "") continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue; // corrupt line — skip, never fail the whole scan
		}
		if (record?.type !== "assistant" || record.message?.usage === void 0) continue;
		const timeMs = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
		if (!Number.isFinite(timeMs)) continue;
		addSample(fileState, timeMs, bucketsOfClaude(record.message.usage));
	}
	return tail;
}

//#region cache serialization

function serializeFileState(state) {
	const days = {};
	for (const [date, buckets] of state.days) days[date] = { ...buckets };
	const hours = {};
	for (const [date, slots] of state.hours) hours[date] = [...slots];
	return {
		cursor: state.cursor,
		size: state.size,
		days,
		hours,
		total: { ...state.total }
	};
}

function parseFileState(raw) {
	const state = createFileState();
	if (raw === null || typeof raw !== "object") return state;
	state.cursor = Number.isSafeInteger(raw.cursor) && raw.cursor >= 0 ? raw.cursor : 0;
	state.size = Number.isSafeInteger(raw.size) && raw.size >= 0 ? raw.size : 0;
	if (raw.days !== null && typeof raw.days === "object") {
		for (const [date, buckets] of Object.entries(raw.days)) {
			if (buckets === null || typeof buckets !== "object") continue;
			state.days.set(date, {
				inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens : 0,
				outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens : 0,
				cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens : 0,
				cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens : 0
			});
		}
	}
	if (raw.hours !== null && typeof raw.hours === "object") {
		for (const [date, slots] of Object.entries(raw.hours)) {
			if (!Array.isArray(slots)) continue;
			state.hours.set(date, slots.map((value) => Number.isFinite(value) ? value : 0).concat(new Array(Math.max(0, 24 - slots.length)).fill(0)).slice(0, 24));
		}
	}
	if (raw.total !== null && typeof raw.total === "object") {
		state.total = {
			inputTokens: Number.isFinite(raw.total.inputTokens) ? raw.total.inputTokens : 0,
			outputTokens: Number.isFinite(raw.total.outputTokens) ? raw.total.outputTokens : 0,
			cacheReadTokens: Number.isFinite(raw.total.cacheReadTokens) ? raw.total.cacheReadTokens : 0,
			cacheWriteTokens: Number.isFinite(raw.total.cacheWriteTokens) ? raw.total.cacheWriteTokens : 0
		};
	}
	return state;
}

//#endregion

//#region scan orchestration (module-level single-flight + memory cache)

let loadedCache = null;
let lastRefreshedAt = 0;
let inflight = null;
const pendingTails = new Map();

async function loadCacheFile(cachePath) {
	try {
		const raw = JSON.parse(await readFile(cachePath, "utf8"));
		if (raw !== null && typeof raw === "object" && raw.version === CACHE_VERSION && raw.files !== null && typeof raw.files === "object") {
			const files = {};
			for (const [path, entry] of Object.entries(raw.files)) files[path] = parseFileState(entry);
			return { version: CACHE_VERSION, files };
		}
	} catch {
		/* first run or corrupt cache */
	}
	return { version: CACHE_VERSION, files: {} };
}

async function saveCacheFile(cachePath, cache, logger) {
	try {
		const { mkdir, writeFile, rename } = await import("node:fs/promises");
		const { dirname, join: pathJoin } = await import("node:path");
		const dir = dirname(cachePath);
		await mkdir(dir, { recursive: true });
		const serialized = { version: CACHE_VERSION, files: {} };
		for (const [path, state] of Object.entries(cache.files)) serialized.files[path] = serializeFileState(state);
		const tmp = pathJoin(dir, `${cachePath.split(/[\\/]/).pop()}.tmp`);
		await writeFile(tmp, JSON.stringify(serialized), "utf8");
		await rename(tmp, cachePath);
	} catch (error) {
		logger?.warn?.(`usage: saving claude cache failed: ${String(error)}`);
	}
}

async function listJsonl(projectsDir, logger) {
	try {
		const names = await readdir(projectsDir, { withFileTypes: true });
		const files = [];
		async function walk(dir) {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(full);
				} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
					files.push(full);
				}
			}
		}
		await walk(projectsDir);
		return files;
	} catch (error) {
		if (error?.code === "ENOENT") return null; // no Claude dir at all
		logger?.warn?.(`usage: listing claude projects failed: ${String(error)}`);
		return [];
	}
}

/**
 * Fold a file incrementally. Returns `{ state, tail }` — the fold state and
 * the new pending tail (memory only). Returns null when the file vanished.
 * @param filePath - absolute path.
 * @param cachedState - previous fold state (or undefined).
 * @param pendingTail - previous partial line (memory only).
 */
async function foldFile(filePath, cachedState, pendingTail, logger) {
	const state = cachedState ?? createFileState();
	let info;
	try {
		info = await stat(filePath);
	} catch {
		return null; // vanished — caller drops it
	}
	const size = info.size;
	if (size < state.cursor) {
		// Truncated or rewritten: re-parse the whole file into a fresh state;
		// the buffered tail no longer matches the new content either.
		Object.assign(state, createFileState());
		pendingTail = "";
	}
	state.size = size;
	if (size <= state.cursor) return { state, tail: pendingTail ?? "" };
	let text = "";
	try {
		const { open } = await import("node:fs/promises");
		const handle = await open(filePath, "r");
		try {
			const start = state.cursor;
			const length = size - start;
			const buffer = Buffer.alloc(length);
			await handle.read(buffer, 0, length, start);
			text = buffer.toString("utf8");
		} finally {
			await handle.close();
		}
	} catch (error) {
		logger?.warn?.(`usage: reading claude log "${filePath}" failed: ${String(error)}`);
		return { state, tail: pendingTail ?? "" };
	}
	const prefix = pendingTail ?? "";
	const lastNewline = text.lastIndexOf("\n");
	let complete = text;
	let tail = "";
	if (lastNewline === -1) {
		// No newline at all: the whole chunk is still one partial line.
		tail = prefix + text;
		complete = "";
	} else if (lastNewline < text.length - 1) {
		tail = text.slice(lastNewline + 1);
		complete = text.slice(0, lastNewline + 1);
	}
	if (complete !== "") tail = parseChunk(state, complete, prefix);
	// The cursor always advances by the bytes READ; the unfinished tail line
	// lives in memory (pendingTails) and gets completed on the next append.
	state.cursor += Buffer.byteLength(text, "utf8");
	return { state, tail };
}

/** Render the merged channel view (all files combined). */
function renderMerged(cache) {
	const days = new Map();
	const hours = new Map();
	const total = zeroBuckets();
	for (const state of Object.values(cache.files)) {
		addInto(total, state.total);
		for (const [date, buckets] of state.days) {
			const target = days.get(date) ?? zeroBuckets();
			addInto(target, buckets);
			days.set(date, target);
		}
		for (const [date, slots] of state.hours) {
			const target = hours.get(date) ?? new Array(24).fill(0);
			for (let i = 0; i < 24; i += 1) target[i] += slots[i] ?? 0;
			hours.set(date, target);
		}
	}
	const renderedDays = [...days.entries()]
		.map(([date, buckets]) => ({
			date,
			...buckets,
			tokens: totalTokens(buckets),
			cacheHitRate: cacheHitRate(buckets),
			hours: hours.get(date) ?? new Array(24).fill(0)
		}))
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return {
		files: Object.keys(cache.files).length,
		days: renderedDays,
		total: {
			...total,
			tokens: totalTokens(total),
			cacheHitRate: cacheHitRate(total)
		}
	};
}

/**
 * Collect Claude Code usage for all JSONL logs under `<claudeDir>/projects`.
 * Cached for refreshMs (default 5 minutes); the first call performs the full
 * scan. Returns `{ enabled: false }` when no Claude dir exists.
 * @param deps - { claudeDir, cachePath, logger, refreshMs, now, disableCache }
 */
export async function collectClaudeUsage(deps = {}) {
	const { claudeDir, cachePath, logger } = deps;
	const refreshMs = deps.refreshMs ?? DEFAULT_REFRESH_MS;
	const now = deps.now ?? Date.now;
	const projectsDir = join(claudeDir, "projects");
	if (loadedCache === null && deps.disableCache !== true) loadedCache = await loadCacheFile(cachePath);
	const cache = loadedCache ?? { version: CACHE_VERSION, files: {} };
	if (inflight !== null) return inflight;
	if (now() - lastRefreshedAt < refreshMs) return { enabled: true, ...renderMerged(cache) };
	inflight = (async () => {
		const files = await listJsonl(projectsDir, logger);
		if (files === null) {
			lastRefreshedAt = now();
			return { enabled: false };
		}
		const seen = new Set();
		for (const filePath of files) {
			const key = filePath;
			seen.add(key);
			const pending = pendingTails.get(key) ?? "";
			const result = await foldFile(filePath, cache.files[key], pending, logger);
			if (result === null) {
				delete cache.files[key];
				pendingTails.delete(key);
				continue;
			}
			cache.files[key] = result.state;
			if (result.tail !== "") pendingTails.set(key, result.tail);
			else pendingTails.delete(key);
		}
		for (const key of Object.keys(cache.files)) {
			if (!seen.has(key)) delete cache.files[key];
		}
		if (deps.disableCache !== true) await saveCacheFile(cachePath, cache, logger);
		lastRefreshedAt = now();
		return { enabled: true, updatedAt: lastRefreshedAt, ...renderMerged(cache) };
	})().finally(() => {
		inflight = null;
	});
	return inflight;
}

/** Test seam: reset module state between scans. */
export function resetClaudeState() {
	loadedCache = null;
	lastRefreshedAt = 0;
	inflight = null;
	pendingTails.clear();
}
