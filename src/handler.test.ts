import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Captures what the handler wrote, without a socket. */
function stubRes() {
	const out = {
		status: 0,
		headers: {} as Record<string, string>,
		body: "",
	};
	const res = {
		setHeader: (k: string, v: string) => {
			out.headers[k.toLowerCase()] = v;
		},
		writeHead: (status: number, headers?: Record<string, string>) => {
			out.status = status;
			for (const [k, v] of Object.entries(headers ?? {}))
				out.headers[k.toLowerCase()] = v;
			return res;
		},
		end: (body?: string) => {
			out.body = body ?? "";
			return res;
		},
	};
	return { res: res as unknown as ServerResponse, out };
}

const get = (pathname: string) =>
	({
		method: "GET",
		url: pathname,
		headers: { host: "mcp.appfreeticket.com" },
	}) as unknown as IncomingMessage;

/**
 * The module reads its env once, at import time, so each case needs a fresh
 * module registry rather than a mutated global.
 */
async function loadHandler(challenge?: string) {
	vi.resetModules();
	if (challenge === undefined) delete process.env.OPENAI_APPS_CHALLENGE;
	else process.env.OPENAI_APPS_CHALLENGE = challenge;
	return (await import("./handler")).handleHttp;
}

afterEach(() => {
	delete process.env.OPENAI_APPS_CHALLENGE;
});

describe("/.well-known/openai-apps-challenge", () => {
	it("serves the configured token verbatim, as plain text", async () => {
		const handleHttp = await loadHandler("  token-from-the-portal\n");
		const { res, out } = stubRes();
		await handleHttp(get("/.well-known/openai-apps-challenge"), res);
		expect(out.status).toBe(200);
		// The portal compares bytes: no JSON envelope, no surrounding whitespace
		// from whatever dashboard field the value was pasted into.
		expect(out.body).toBe("token-from-the-portal");
		expect(out.headers["content-type"]).toBe("text/plain; charset=utf-8");
	});

	it("404s when nothing is configured instead of inventing a token", async () => {
		const handleHttp = await loadHandler();
		const { res, out } = stubRes();
		await handleHttp(get("/.well-known/openai-apps-challenge"), res);
		expect(out.status).toBe(404);
		// A verification that passes on a made-up value proves nothing, so the
		// answer names the variable to set instead.
		expect(out.body).toContain("OPENAI_APPS_CHALLENGE");
	});

	it("does not shadow the OAuth discovery routes next to it", async () => {
		const handleHttp = await loadHandler("token");
		const { res, out } = stubRes();
		await handleHttp(get("/.well-known/oauth-protected-resource"), res);
		expect(out.status).toBe(200);
		expect(JSON.parse(out.body).resource).toContain("mcp.appfreeticket.com");
	});
});
