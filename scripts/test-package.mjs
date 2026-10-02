#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, ".."));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const client = readFileSync(join(root, "lib", "client.js"), "utf8");
const runtimePackage = "@deepseek-ai/dsh-client-ui-primitives";

// Optional root lets release checks inspect the installed final TGZ, not the checkout.
const server = await import(pathToFileURL(join(root, "lib", "index.js")).href);
assert.equal(pkg.name, "dsh-usage");
assert.equal(server.name, "usage");
assert.equal(typeof server.apply, "function");
assert.deepEqual(server.inject, ["webServer", "credentials", "sessions", "sessionPersistence", "settings", "llm"]);
assert.equal(server.USAGE_PATH, "/api/usage/usage");
assert.equal(server.PROVIDERS_PATH, "/api/usage/providers");
assert.equal(server.BALANCE_PATH, "/api/usage/balance");
assert.equal(pkg.dsh.client.platform, "web");
assert.deepEqual(pkg.dsh.client.inject, ["@deepseek-ai/dsh-client-locale", runtimePackage]);
assert.match(readFileSync(join(root, "cordis.patch.yml"), "utf8"), /^- insert:\r?\n    - id: usage\r?\n      name: dsh-usage\s*$/m);

assert.equal(
	pkg.dependencies?.[runtimePackage],
	"0.2.0-rc.2",
	`${runtimePackage} must be an exact runtime dependency`
);
assert.ok(
	pkg.dsh?.client?.inject?.includes(runtimePackage),
	`${runtimePackage} must remain in dsh.client.inject`
);
assert.ok(
	client.includes(`require("${runtimePackage}")`),
	"package contract test must track the real client import"
);
assert.ok(!pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-runtime"), "retired runtime must not be loaded");
{
	const m = client.match(/const LOCAL_VERSION = "([^"]+)"/);
	assert.ok(m, "client.js must declare LOCAL_VERSION");
	assert.equal(m[1], pkg.version, "LOCAL_VERSION must match package.json version");
}

// Exercise the real instruction block without evaluating browser widgets.
{
	const block = client.match(/const DESKTOP_HOST = [\s\S]*?(?=const UPDATE_CHECK_KEY)/)?.[0];
	assert.ok(block, "client must select its update profile from the active surface");
	for (const [protocol, profile] of [["https:", "web"], ["dsh-app:", "desktop"]]) {
		const context = { location: { protocol } };
		runInNewContext(block + "\nglobalThis.result = {command: UPGRADE_CMD, prompt: UPGRADE_AI};", context);
		assert.equal(context.result.command, `dsh plugin --profile ${profile} update dsh-usage`);
		if (profile === "desktop") {
			assert.match(context.result.prompt, /桌面端自带的 dsh CLI/);
			assert.match(context.result.prompt, /不要修改 web profile/);
			assert.match(context.result.prompt, /手动重新打开桌面端/);
		} else assert.match(context.result.prompt, /重启 dsh web/);
	}
}

console.log("ok package declares and injects client UI runtime dependency");
