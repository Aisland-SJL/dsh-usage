#!/usr/bin/env node
/**
 * dsh-usage — one-off GitHub research: star counts for similar plugins.
 * Uses proxy-fetch to query the GitHub API through the local proxy tunnel.
 * Not part of the npm test suite (network dependent).
 */
import { fetchViaProxy } from "./proxy-fetch.mjs";

const API = "https://api.github.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ghJson(path) {
	let lastError = null;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const body = await fetchViaProxy(`${API}${path}`);
			const json = JSON.parse(body.toString("utf8"));
			// Renamed/transferred repos answer "Moved Permanently": follow the target.
			if (json?.message === "Moved Permanently" && typeof json.url === "string") {
				const target = new URL(json.url);
				return JSON.parse((await fetchViaProxy(`${target.origin}${target.pathname}`)).toString("utf8"));
			}
			return json;
		} catch (error) {
			lastError = error;
			if (attempt < 3) await sleep(2500);
		}
	}
	throw lastError;
}

const searches = [
	["deepseek-harness", "DSH 生态核心"],
	["dsh plugin token", "DSH 插件 token"],
	["dsh usage balance", "DSH 用量余额"],
	["token usage monitor ai coding", "token 监控类"]
];

console.log("== 搜索结果（按 star 排序）==");
for (const [query, label] of searches) {
	console.log(`\n## ${label} — q=${query}`);
	try {
		const json = await ghJson(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`);
		for (const item of json.items ?? []) {
			console.log(`${String(item.stargazers_count).padStart(6)} | ${item.full_name.padEnd(45)} | ${(item.description ?? "").slice(0, 80)} | ${item.html_url}`);
		}
	} catch (error) {
		console.log(`  FAILED: ${error.message}`);
	}
	await sleep(2500);
}

const repos = [
	"Ychris12138/dsh-usage-stats",
	"Make0209/dsh-usage-stats",
	"yingjunnan/dsh-deepseek-quota",
	"feiyang-dev/dsh-usage-plugin",
	"ryoppippi/ccusage",
	"Javis603/token-monitor",
	"xiaoqi20/dsh-opencode-go-usage",
	"awesome-dsh-plugin/awesome-dsh-plugin"
];

console.log("\n== 指定仓库 star 数 ==");
for (const repo of repos) {
	try {
		const json = await ghJson(`/repos/${repo}`);
		console.log(`${String(json.stargazers_count).padStart(6)} | ${repo.padEnd(45)} | ${(json.description ?? "").slice(0, 80)} | ${json.html_url}`);
	} catch (error) {
		console.log(`  FAILED | ${repo} — ${error.message}`);
	}
	await sleep(2500);
}
