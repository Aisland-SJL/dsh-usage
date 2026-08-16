#!/usr/bin/env node
/**
 * dsh-usage — proxy tunnel fetch tool.
 *
 * Fetches an https URL through a local HTTP CONNECT proxy (default
 * 127.0.0.1:7890) using Node's OpenSSL TLS stack — the only TLS stack that
 * works inside the DSH sandbox (Windows schannel is unavailable there).
 * The user's system proxy forwards the tunnel upstream.
 *
 * Usage:
 *   node scripts/proxy-fetch.mjs <url> [proxyHost] [proxyPort]
 *
 * Prints the response body to stdout; exits non-zero on failure.
 */
import net from "node:net";
import tls from "node:tls";

/** Decode an HTTP/1.1 chunked transfer body (Buffer in → Buffer out). */
function decodeChunked(buf) {
	const out = [];
	let i = 0;
	while (i < buf.length) {
		const lineEnd = buf.indexOf("\r\n", i);
		if (lineEnd === -1) break;
		const sizeHex = buf.slice(i, lineEnd).toString("latin1").split(";")[0].trim();
		const size = Number.parseInt(sizeHex, 16);
		i = lineEnd + 2;
		if (!Number.isFinite(size) || size === 0) break;
		out.push(buf.slice(i, i + size));
		i += size + 2;
	}
	return Buffer.concat(out);
}

export function fetchViaProxy(rawUrl, { proxyHost = "127.0.0.1", proxyPort = 7890, timeoutMs = 30000, method = "GET", headers = {}, body = "" } = {}) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:") throw new Error("only https URLs are supported");
	const host = url.hostname;
	const port = url.port === "" ? 443 : Number(url.port);
	const path = `${url.pathname}${url.search}`;
	return new Promise((resolve, reject) => {
		const socket = net.connect(proxyPort, proxyHost);
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error(`proxy fetch timed out after ${timeoutMs}ms: ${rawUrl}`));
		}, timeoutMs);
		socket.on("error", (error) => {
			clearTimeout(timer);
			reject(new Error(`proxy socket: ${error.message}`));
		});
		socket.on("connect", () => {
			socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
		});
		let head = Buffer.alloc(0);
		let upgraded = false;
		const onHead = (chunk) => {
			head = Buffer.concat([head, chunk]);
			const idx = head.indexOf("\r\n\r\n");
			if (idx === -1) return;
			const statusLine = head.slice(0, idx).toString("latin1");
			if (!/ 200 /.test(statusLine)) {
				clearTimeout(timer);
				socket.destroy();
				reject(new Error(`CONNECT failed: ${statusLine.split("\r\n")[0]}`));
				return;
			}
			upgraded = true;
			socket.removeListener("data", onHead);
			const tlsSocket = tls.connect({ socket, servername: host });
			const chunks = [];
			tlsSocket.on("error", (error) => {
				clearTimeout(timer);
				reject(new Error(`tls: ${error.message}`));
			});
			tlsSocket.on("secureConnect", () => {
				const bodyBytes = Buffer.from(String(body ?? ""), "utf8");
				const headerLines = [
					`${method} ${path} HTTP/1.1`,
					`Host: ${host}`,
					"User-Agent: dsh-usage-proxy-fetch/1.0",
					"Accept: application/vnd.github+json",
					...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
					`Content-Length: ${bodyBytes.length}`,
					"Connection: close",
					"",
					""
				];
				tlsSocket.write(headerLines.join("\r\n"));
				if (bodyBytes.length > 0) tlsSocket.write(bodyBytes);
			});
			tlsSocket.on("data", (chunk) => chunks.push(chunk));
			tlsSocket.on("end", () => {
				clearTimeout(timer);
				const raw = Buffer.concat(chunks);
				const headEnd = raw.indexOf("\r\n\r\n");
				const head = headEnd === -1 ? "" : raw.slice(0, headEnd).toString("latin1");
				const status = (head.match(/^HTTP\/1\.[01] (\d+)/) || [])[1];
				if (status === void 0 || Number(status) >= 400) {
					reject(new Error(`HTTP ${status ?? "invalid response"}`));
					return;
				}
				let bodyBuf = headEnd === -1 ? raw : raw.slice(headEnd + 4);
				if (/transfer-encoding:\s*chunked/i.test(head)) bodyBuf = decodeChunked(bodyBuf);
				// Resolve the raw Buffer: text callers decode, binary callers get bytes intact.
				resolve(bodyBuf);
			});
			const rest = head.slice(idx + 4);
			if (rest.length > 0) tlsSocket.emit("data", rest);
		};
		socket.on("data", onHead);
	});
}

// CLI: node proxy-fetch.mjs <url> [proxyHost] [proxyPort]
if (import.meta.url === `file://${process.argv[1]}`) {
	const [url, host = "127.0.0.1", port = "7890"] = process.argv.slice(2);
	if (url === void 0) {
		console.error("usage: node scripts/proxy-fetch.mjs <url> [proxyHost] [proxyPort]");
		process.exit(2);
	}
	try {
		const body = await fetchViaProxy(url, { proxyHost: host, proxyPort: Number(port) });
		// Binary-safe stdout: text bodies pass through byte-for-byte, binaries too.
		process.stdout.write(body);
	} catch (error) {
		console.error(`proxy-fetch: ${error.message}`);
		process.exit(1);
	}
}
