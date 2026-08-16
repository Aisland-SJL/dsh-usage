/**
 * dsh-usage — safe upstream fetch for balance queries.
 *
 * HTTPS only, DNS pre-resolution with private-network rejection, and
 * connection pinning to the checked address (DNS-rebinding defense), plus a
 * response size cap and timeout. The policy approach mirrors dsh-usage-stats
 * (MIT, https://github.com/Ychris12138/dsh-usage-stats); it is reimplemented
 * here so this plugin stays self-contained.
 *
 * @module dsh-usage/safe-fetch
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function statusError(status, message) {
	const error = new Error(message);
	error.providerStatus = status;
	return error;
}

/** True for loopback, private, link-local, documentation, multicast, and reserved IPv4 space. */
export function ipv4Private(parts) {
	const [a, b, c] = parts;
	if (![a, b, c, parts[3]].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 0 && c === 0) return true;
	if (a === 192 && b === 168) return true;
	if (a === 192 && (b === 0 && c === 2 || b === 88 && c === 99)) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	if (a === 198 && b === 51 && c === 100) return true;
	if (a === 203 && b === 0 && c === 113) return true;
	if (a >= 224) return true;
	return false;
}

/** True for non-public IP space (IPv4 + IPv6), following the same conservative policy as dsh-usage-stats. */
export function isPrivateAddress(address) {
	const value = String(address ?? "").trim().replace(/^\[|\]$/g, "");
	if (isIP(value) === 4) return ipv4Private(value.split(".").map(Number));
	if (isIP(value) !== 6) return true;
	const halves = value.split("::");
	if (halves.length > 2) return true;
	const left = halves[0] === "" ? [] : halves[0].split(":");
	const right = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
	if (right.length > 0 && right[right.length - 1].includes(".")) {
		const v4 = right.pop().split(".").map(Number);
		if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
		right.push(((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16));
	}
	const missing = 8 - left.length - right.length;
	if (missing < 0 || halves.length === 1 && missing !== 0) return true;
	const parts = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part || "0", 16));
	if (parts.length !== 8 || parts.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return true;
	if (parts.every((w, i) => i < 7 ? w === 0 : w === 1)) return true; // ::1
	if (parts.every((w) => w === 0)) return true; // ::
	if (parts.slice(0, 5).every((w) => w === 0) && parts[5] === 0xffff) {
		return ipv4Private([parts[6] >> 8, parts[6] & 0xff, parts[7] >> 8, parts[7] & 0xff]);
	}
	const global = (parts[0] & 0xe000) === 0x2000;
	const documentation = parts[0] === 0x2001 && parts[1] === 0x0db8;
	return !global || documentation;
}

/** Resolve a URL's hostname, rejecting private targets; returns the pinned address. */
export async function resolvePublicAddress(url, deps = {}) {
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(hostname) !== 0) {
		if (isPrivateAddress(hostname)) throw statusError("unsupported", "balance hostname resolves to a private network");
		return { address: hostname, family: isIP(hostname) };
	}
	let addresses;
	try {
		addresses = await (deps.lookup ?? dnsLookup)(hostname, { all: true, verbatim: true });
	} catch {
		throw statusError("unavailable", "balance hostname could not be resolved");
	}
	if (!Array.isArray(addresses)) addresses = [addresses];
	if (addresses.length === 0) throw statusError("unavailable", "balance hostname resolved to no addresses");
	if (addresses.some((entry) => isPrivateAddress(entry?.address))) {
		throw statusError("unsupported", "balance hostname resolves to a private network");
	}
	const selected = addresses[0];
	return { address: selected.address, family: selected.family ?? isIP(selected.address) };
}

/**
 * Fetch a balance URL over HTTPS, pinning the connection to the DNS answer
 * checked by the policy layer. Returns a minimal fetch-like response
 * ({ok, status, headers, arrayBuffer, json, text}) for queryBalance.
 */
export async function safeFetch(rawUrl, init = {}, deps = {}) {
	const url = new URL(rawUrl);
	if (url.username !== "" || url.password !== "") throw statusError("unsupported", "balance URL must not contain credentials");
	if (url.protocol !== "https:") throw statusError("unsupported", "balance requires HTTPS");
	const target = { url, ...await resolvePublicAddress(url, deps) };
	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = deps.maxResponseBytes ?? MAX_RESPONSE_BYTES;
	const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
	const transport = deps.transport ?? { httpsRequest, httpRequest };
	return new Promise((resolve, reject) => {
		const request = transport.httpsRequest(target.url, {
			method: init.method ?? "GET",
			headers: init.headers,
			signal,
			servername: isIP(target.url.hostname.replace(/^\[|\]$/g, "")) === 0 ? target.url.hostname : void 0,
			lookup: (_hostname, options, callback) => {
				if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
				else callback(null, target.address, target.family);
			}
		}, (response) => {
			const chunks = [];
			let size = 0;
			response.on("data", (chunk) => {
				size += chunk.length;
				if (size > maxBytes) request.destroy(statusError("invalid-response", "upstream response exceeds the size limit"));
				else chunks.push(chunk);
			});
			response.on("end", () => {
				const body = Buffer.concat(chunks);
				const headers = {
					get: (name) => {
						const value = response.headers?.[String(name).toLowerCase()];
						return Array.isArray(value) ? value.join(", ") : value === void 0 ? null : String(value);
					}
				};
				resolve({
					ok: response.statusCode >= 200 && response.statusCode < 300,
					status: response.statusCode,
					headers,
					arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
					json: async () => JSON.parse(body.toString("utf8")),
					text: async () => body.toString("utf8")
				});
			});
		});
		request.on("error", reject);
		request.end();
	});
}
