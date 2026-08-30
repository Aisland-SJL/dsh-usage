#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const client = readFileSync(join(root, "lib", "client.js"), "utf8");
const runtimePackage = "@deepseek-ai/dsh-client-ui-primitives";

assert.equal(
	pkg.dependencies?.[runtimePackage],
	"0.1.1-rc.2",
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
{
	const m = client.match(/const LOCAL_VERSION = "([^"]+)"/);
	assert.ok(m, "client.js must declare LOCAL_VERSION");
	assert.equal(m[1], pkg.version, "LOCAL_VERSION must match package.json version");
}

console.log("ok package declares and injects client UI runtime dependency");
