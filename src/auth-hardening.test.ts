import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliConfig } from "./api";
import {
	ACCESS_PREFIX,
	ACCESS_TTL,
	CLIENT_PREFIX,
	CODE_PREFIX,
	checkRedirect,
	consentPage,
	open,
	REFRESH_PREFIX,
	REFRESH_TTL,
	SESSION_TTL,
	seal,
	wantsReadOnly,
} from "./oauth";
import { buildServer, readOnlyView, toolNames } from "./server";

/**
 * Auth hardening (0.24.0, Block MCP playbook): short-lived access tokens with
 * rotating refresh, a `read` scope, no raw API key as Bearer, no pasted admin
 * cookie, the buyer session as a credential and lazy auth on /mcp.
 */
const SECRET = "test-secret-auth-hardening";
const HOST = "mcp.appfreeticket.com";
const CB = "https://claude.ai/api/mcp/auth_callback";

async function loadHandler(env: Record<string, string> = {}) {
	vi.resetModules();
	process.env.MCP_TOKEN_SECRET = SECRET;
	for (const [k, v] of Object.entries(env)) process.env[k] = v;
	return (await import("./handler")).handleHttp;
}

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.MCP_REQUIRE_AUTH;
	delete process.env.MCP_ANON_RPM;
	delete process.env.FT_API_URL;
	delete process.env.VERCEL;
});

function stubRes() {
	const out = { status: 0, headers: {} as Record<string, string>, body: "" };
	const res = {
		headersSent: false,
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
		on: () => res,
	};
	// biome-ignore lint/suspicious/noExplicitAny: minimal ServerResponse stub.
	return { res: res as any, out };
}

const req = (
	method: string,
	url: string,
	body?: unknown,
	headers: Record<string, string> = {},
) =>
	({
		method,
		url,
		headers: { host: HOST, ...headers },
		body,
		socket: { remoteAddress: "10.0.0.1" },
	}) as unknown as IncomingMessage;

/** free-admin's GET /api/v1/me, answering `scope` for any key but "revoked". */
function stubMe(scope: "read" | "write" = "write") {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push(String(url));
			const auth = new Headers(init?.headers).get("authorization") ?? "";
			if (auth.includes("revoked")) return new Response("{}", { status: 401 });
			if (auth.includes("down")) return new Response("{}", { status: 502 });
			return new Response(JSON.stringify({ data: { scope } }), {
				status: 200,
			});
		}),
	);
	return calls;
}

const tokenForm = (p: Record<string, string>) =>
	new URLSearchParams(p).toString();

describe("(a) token lifetimes and refresh", () => {
	it("access lives 1 h; the refresh rotates and re-validates the key", async () => {
		const handleHttp = await loadHandler();
		const calls = stubMe();
		const refresh = seal(
			{
				k: "ft_live_ok",
				w: "",
				c: "cl",
				ae: Date.now() / 1000 + SESSION_TTL,
				exp: Date.now() / 1000 + 600,
			},
			SECRET,
			REFRESH_PREFIX,
		);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: refresh,
					client_id: "cl",
				}),
			),
			res,
		);
		expect(out.status).toBe(200);
		const t = JSON.parse(out.body);
		expect(ACCESS_TTL).toBe(3600);
		expect(t.expires_in).toBe(3600);
		expect(t.refresh_token).not.toBe(refresh);
		const access = open(t.access_token, SECRET, ACCESS_PREFIX);
		expect(access?.exp).toBeLessThanOrEqual(Date.now() / 1000 + 3600 + 1);
		expect(access?.exp).toBeGreaterThanOrEqual(Date.now() / 1000 + 3600 - 5);
		expect(calls.some((u) => u.endsWith("/api/v1/me"))).toBe(true);
	});

	it("a key revoked in free-admin stops refreshing (invalid_grant)", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const refresh = seal(
			{ k: "ft_live_revoked", c: "cl", exp: Date.now() / 1000 + 600 },
			SECRET,
			REFRESH_PREFIX,
		);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: refresh,
					client_id: "cl",
				}),
			),
			res,
		);
		expect(out.status).toBe(400);
		expect(JSON.parse(out.body).error).toBe("invalid_grant");
	});

	it("free-admin down is a retry, not a forced sign-in", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const refresh = seal(
			{ k: "ft_live_down", c: "cl", exp: Date.now() / 1000 + 600 },
			SECRET,
			REFRESH_PREFIX,
		);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: refresh,
					client_id: "cl",
				}),
			),
			res,
		);
		expect(out.status).toBe(503);
	});

	it("a refresh token is bound to its client", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const refresh = seal(
			{ k: "ft_live_ok", c: "cl", exp: Date.now() / 1000 + 600 },
			SECRET,
			REFRESH_PREFIX,
		);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: refresh,
					client_id: "other",
				}),
			),
			res,
		);
		expect(out.status).toBe(400);
	});

	it("rotation never extends the session past its absolute end", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const ae = Date.now() / 1000 + 120;
		const refresh = seal(
			{ k: "ft_live_ok", c: "cl", ae, exp: ae },
			SECRET,
			REFRESH_PREFIX,
		);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: refresh,
					client_id: "cl",
				}),
			),
			res,
		);
		const t = JSON.parse(out.body);
		expect(open(t.refresh_token, SECRET, REFRESH_PREFIX)?.exp).toBe(ae);
		expect(open(t.access_token, SECRET, ACCESS_PREFIX)?.exp).toBe(ae);
		expect(SESSION_TTL).toBe(90 * 24 * 3600);
	});
});

describe("(b) read scope", () => {
	it("only an explicit `read` without `b2b` asks for read-only", () => {
		expect(wantsReadOnly("read")).toBe(true);
		// Claude requests every advertised scope when it has no hint.
		expect(wantsReadOnly("b2b read")).toBe(false);
		expect(wantsReadOnly("")).toBe(false);
		expect(wantsReadOnly(null)).toBe(false);
	});

	it("a read-only server lists only readOnly tools, in every layer", () => {
		const creds = {
			apiUrl: "http://x",
			apiKey: "k",
			customerSession: "s",
			adminSession: "a",
		};
		const full = buildServer(creds);
		const ro = buildServer({ ...creds, readOnly: true });
		const annotations = (s: McpServer) =>
			(
				s as unknown as {
					_registeredTools: Record<
						string,
						{ annotations?: { readOnlyHint?: boolean } }
					>;
				}
			)._registeredTools;
		const roTools = annotations(ro);
		expect(Object.keys(roTools).length).toBeGreaterThan(20);
		for (const [n, t] of Object.entries(roTools))
			expect(t.annotations?.readOnlyHint, n).toBe(true);
		for (const n of ["events_list", "customer_tickets", "public_events_list"])
			expect(roTools[n], n).toBeDefined();
		for (const n of ["events_create", "sales_refund", "customer_logout"]) {
			expect(annotations(full)[n], n).toBeDefined();
			expect(roTools[n], n).toBeUndefined();
		}
	});

	it("readOnlyView drops a tool registered without annotations (fail-closed)", () => {
		const server = new McpServer({ name: "t", version: "0" });
		const view = readOnlyView(server);
		view.tool("no_hints", "x", async () => ({ content: [] }));
		view.tool("a_read", "x", { readOnlyHint: true }, async () => ({
			content: [],
		}));
		expect([...toolNames(server)]).toEqual(["a_read"]);
	});

	it("the device flow pre-ticks Solo lectura and seals the read scope", async () => {
		const handleHttp = await loadHandler();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (String(url).endsWith("/auth/device/code"))
					return new Response(
						JSON.stringify({
							device_code: "dc",
							user_code: "ABCD",
							verification_uri_complete: "https://admin.x/device?code=ABCD",
							interval: 5,
							expires_in: 600,
						}),
					);
				if (String(url).endsWith("/auth/device/token"))
					return new Response(
						JSON.stringify({ access_token: "ft_live_new", workspaces: [] }),
					);
				// /me: the user left the box unticked — the key is write.
				return new Response(JSON.stringify({ data: { scope: "write" } }));
			}),
		);
		const start = stubRes();
		await handleHttp(
			req("POST", "/device-start", {
				client_id: "",
				redirect_uri: CB,
				code_challenge: "ch",
				scope: "read",
			}),
			start.res,
		);
		expect(JSON.parse(start.out.body).verification_uri_complete).toContain(
			"scope=read",
		);

		const poll = stubRes();
		await handleHttp(
			req("POST", "/device-token", {
				client_id: "",
				redirect_uri: CB,
				code_challenge: "ch",
				device_code: "dc",
				scope: "read",
			}),
			poll.res,
		);
		const code = new URL(JSON.parse(poll.out.body).redirect).searchParams.get(
			"code",
		);
		// The client asked for read: honoured even with a write key.
		expect(open(code ?? "", SECRET, CODE_PREFIX)?.s).toBe("read");
	});

	it("a read-scoped key yields a read connection even without asking", async () => {
		const handleHttp = await loadHandler();
		const meCalls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (String(url).endsWith("/auth/device/token"))
					return new Response(
						JSON.stringify({ access_token: "ft_live_ro", workspaces: [] }),
					);
				// /me: the user ticked "Solo lectura" on /device — the key is read.
				meCalls.push(String(url));
				return new Response(JSON.stringify({ data: { scope: "read" } }));
			}),
		);
		const verifier = "v".repeat(43);
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const poll = stubRes();
		// No scope requested: only /me can make this connection read-only.
		await handleHttp(
			req("POST", "/device-token", {
				client_id: "cl",
				redirect_uri: CB,
				code_challenge: challenge,
				device_code: "dc",
			}),
			poll.res,
		);
		expect(meCalls.length).toBe(1);
		const code =
			new URL(JSON.parse(poll.out.body).redirect).searchParams.get("code") ??
			"";
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "authorization_code",
					code,
					code_verifier: verifier,
					redirect_uri: CB,
					client_id: "cl",
				}),
			),
			res,
		);
		const t = JSON.parse(out.body);
		expect(t.scope).toBe("read");
		expect(open(t.access_token, SECRET, ACCESS_PREFIX)?.s).toBe("read");
	});

	it("the manual form also derives read from /me", async () => {
		const handleHttp = await loadHandler();
		stubMe("read");
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/authorize",
				new URLSearchParams({
					client_id: "",
					redirect_uri: CB,
					code_challenge: "ch",
					api_key: "ft_live_ro",
				}).toString(),
			),
			res,
		);
		const code = new URL(out.headers.location).searchParams.get("code") ?? "";
		expect(open(code, SECRET, CODE_PREFIX)?.s).toBe("read");
	});

	it("discovery advertises b2b and read, not admin", async () => {
		const handleHttp = await loadHandler();
		const { res, out } = stubRes();
		await handleHttp(req("GET", "/.well-known/oauth-protected-resource"), res);
		expect(JSON.parse(out.body).scopes_supported).toEqual(["b2b", "read"]);
	});
});

describe("(c) raw API key as Bearer", () => {
	it("is refused with 401 invalid_token, not served", async () => {
		const handleHttp = await loadHandler();
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/mcp",
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authorization: "Bearer ft_live_raw", "x-admin-session": "c" },
			),
			res,
		);
		expect(out.status).toBe(401);
		expect(out.headers["www-authenticate"]).toContain('error="invalid_token"');
		expect(out.body).toContain("FT_API_KEY");
	});

	it("an expired access token is a 401 too, so the client refreshes", async () => {
		const handleHttp = await loadHandler();
		const expired = seal(
			{ k: "ft_live_ok", exp: Date.now() / 1000 - 1 },
			SECRET,
			ACCESS_PREFIX,
		);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/mcp",
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authorization: `Bearer ${expired}` },
			),
			res,
		);
		expect(out.status).toBe(401);
	});
});

describe("(d) admin cookie on the consent page", () => {
	it("the form no longer asks for it", () => {
		const html = consentPage(new URLSearchParams({ redirect_uri: CB }));
		expect(html).not.toContain("admin_session");
		expect(html).not.toContain("better-auth.session_token");
		expect(html).toContain('name="read_only"');
	});

	it("a posted admin_session is ignored: the code seals no admin layer", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/authorize",
				new URLSearchParams({
					client_id: "",
					redirect_uri: CB,
					code_challenge: "ch",
					api_key: "ft_live_ok",
					admin_session: "stolen-cookie",
				}).toString(),
			),
			res,
		);
		expect(out.status).toBe(302);
		const code = new URL(out.headers.location).searchParams.get("code") ?? "";
		const p = open(code, SECRET, CODE_PREFIX);
		expect(p?.k).toBe("ft_live_ok");
		expect(p?.a).toBeUndefined();
	});

	it("an admin cookie alone no longer authorizes anything", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/authorize",
				new URLSearchParams({
					client_id: "",
					redirect_uri: CB,
					code_challenge: "ch",
					admin_session: "cookie",
				}).toString(),
			),
			res,
		);
		expect(out.status).toBe(200);
		expect(out.body).toContain("Ingresa una API key");
	});
});

describe("(f) stdio reads the ft CLI config", () => {
	it("reads the legacy layout and the multi-account one", () => {
		expect(cliConfig(JSON.stringify({ apiKey: "k1" })).apiKey).toBe("k1");
		expect(
			cliConfig(JSON.stringify({ accounts: { a: { apiKey: "k2" } } })).apiKey,
		).toBe("k2");
		expect(
			cliConfig(
				JSON.stringify({
					activeAccount: "b",
					accounts: { a: { apiKey: "k2" }, b: { apiKey: "k3" } },
				}),
			).apiKey,
		).toBe("k3");
		// Several accounts, none pinned: no key in effect (same rule as `ft`).
		expect(
			cliConfig(
				JSON.stringify({
					accounts: { a: { apiKey: "k2" }, b: { apiKey: "k3" } },
				}),
			).apiKey,
		).toBeUndefined();
		expect(cliConfig("not json")).toEqual({});
	});
});

describe("(e, g) anonymous /mcp: lazy auth and the buyer layer", () => {
	let server: Server;
	let base: string;
	const rpc = (
		body: unknown,
		headers: Record<string, string> = {},
		path = "/mcp",
	) =>
		fetch(`${base}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify(body),
		});
	const listTools = async (headers?: Record<string, string>, path?: string) =>
		(
			(await (
				await rpc(
					{ jsonrpc: "2.0", id: 1, method: "tools/list" },
					headers,
					path,
				)
			).json()) as { result: { tools: { name: string }[] } }
		).result.tools.map((t) => t.name);

	const start = async (env: Record<string, string> = {}) => {
		// Unreachable API: tool calls that pass the gate fail fast, offline.
		const handleHttp = await loadHandler({
			FT_API_URL: "http://127.0.0.1:9",
			...env,
		});
		server = createServer(handleHttp);
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	};
	beforeEach(() => start());
	afterEach(() => new Promise<void>((r) => server.close(() => r())));

	it("lists public and B2B tools without a token, never admin_ or customer_", async () => {
		const names = await listTools();
		expect(names).toContain("public_events_list");
		expect(names).toContain("events_list");
		expect(names.some((n) => n.startsWith("admin_"))).toBe(false);
		expect(names.some((n) => n.startsWith("customer_"))).toBe(false);
	});

	it("a public tool call passes the gate", async () => {
		const r = await rpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "public_events_list", arguments: { limit: "x" } },
		});
		expect(r.status).toBe(200);
	});

	it("a protected tool call answers 401 + WWW-Authenticate before the SDK", async () => {
		const r = await rpc({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "events_list", arguments: {} },
		});
		expect(r.status).toBe(401);
		const h = r.headers.get("www-authenticate") ?? "";
		expect(h).toContain("resource_metadata=");
		expect(h).toContain('scope="b2b"');
	});

	it("X-Customer-Session alone adds the buyer layer, and only it", async () => {
		const names = await listTools({ "x-customer-session": "sess" });
		expect(names).toContain("customer_tickets");
		const r = await rpc(
			{
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: "customer_profile", arguments: {} },
			},
			{ "x-customer-session": "sess" },
		);
		// Passes the gate (free-admin is unreachable here; the point is no 401).
		expect(r.status).toBe(200);
	});

	it("/mcp/public stays public-only, even with a buyer session", async () => {
		const names = await listTools({ "x-customer-session": "s" }, "/mcp/public");
		expect(names.every((n) => n.startsWith("public_"))).toBe(true);
	});

	it("MCP_REQUIRE_AUTH=1 restores the old upfront 401", async () => {
		await new Promise<void>((r) => server.close(() => r()));
		await start({ MCP_REQUIRE_AUTH: "1" });
		const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
		expect(r.status).toBe(401);
	});

	it("rate limits anonymous traffic per IP", async () => {
		await new Promise<void>((r) => server.close(() => r()));
		await start({ MCP_ANON_RPM: "2", VERCEL: "1" });
		const call = () =>
			rpc(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ "x-forwarded-for": "203.0.113.9" },
			);
		expect((await call()).status).toBe(200);
		expect((await call()).status).toBe(200);
		const third = await call();
		expect(third.status).toBe(429);
		expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
	});

	it("off Vercel, X-Forwarded-For is ignored: rotating it does not reset the limit", async () => {
		await new Promise<void>((r) => server.close(() => r()));
		await start({ MCP_ANON_RPM: "2" });
		const call = (ip: string) =>
			rpc(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ "x-forwarded-for": ip },
			);
		expect((await call("203.0.113.1")).status).toBe(200);
		expect((await call("203.0.113.2")).status).toBe(200);
		expect((await call("203.0.113.3")).status).toBe(429);
	});

	it("a valid Bearer plus X-Customer-Session adds the buyer layer and merch_orders_lookup", async () => {
		const access = seal(
			{ k: "ft_live_ok", c: "cl", exp: Date.now() / 1000 + 600 },
			SECRET,
			ACCESS_PREFIX,
		);
		const names = await listTools({
			authorization: `Bearer ${access}`,
			"x-customer-session": "sess",
		});
		expect(names).toContain("events_list");
		expect(names).toContain("customer_tickets");
		expect(names).toContain("merch_orders_lookup");
		const without = await listTools({ authorization: `Bearer ${access}` });
		expect(without).not.toContain("merch_orders_lookup");
		expect(without.some((n) => n.startsWith("customer_"))).toBe(false);
	});

	it("an empty or whitespace X-Customer-Session is no session", async () => {
		for (const v of ["", "   "]) {
			const names = await listTools({ "x-customer-session": v });
			expect(names.some((n) => n.startsWith("customer_"))).toBe(false);
		}
	});

	it("a batch mixing a public and a protected tool answers 401", async () => {
		const r = await rpc([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "public_events_list", arguments: {} },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "events_list", arguments: {} },
			},
		]);
		expect(r.status).toBe(401);
	});

	it("a body that is not JSON is a 400 parse error, not a 500", async () => {
		const r = await fetch(`${base}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: "{not json",
		});
		expect(r.status).toBe(400);
		expect(((await r.json()) as { error: { code: number } }).error.code).toBe(
			-32700,
		);
		const d = await fetch(`${base}/device-token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(d.status).toBe(400);
	});
});

/** Security review of #45 (P1–P3). */
describe("security review", () => {
	const DAY = 24 * 3600;
	const now = () => Date.now() / 1000;
	const client = (rus: string[], n = "Claude") =>
		seal({ rus, n, exp: now() + 60 }, SECRET, CLIENT_PREFIX);
	const refreshWith = async (
		p: Parameters<typeof seal>[0],
		clientId: string,
		handleHttp: Awaited<ReturnType<typeof loadHandler>>,
	) => {
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: seal(p, SECRET, REFRESH_PREFIX),
					client_id: clientId,
				}),
			),
			res,
		);
		return out;
	};

	it("P1-a: another path on a known host is an unknown destination", () => {
		const id = client(["https://claude.ai/x"], "Claude");
		const r = checkRedirect(id, "https://claude.ai/x", SECRET);
		expect(r).toMatchObject({ ok: true, unknownHost: true });
		const page = consentPage(new URLSearchParams(), { redirect: r });
		expect(page).toContain("no es un cliente conocido");
		expect(page).toContain("https://claude.ai/x");
		// The registrant-chosen name is quoted as unverified, never the title.
		expect(page).not.toContain("<b>Claude</b>");
		expect(page).toContain("no está verificado");
		// The real callback keeps its name and shows no warning.
		const known = checkRedirect(client([CB]), CB, SECRET);
		expect(known.unknownHost).toBe(false);
		const ok = consentPage(new URLSearchParams(), { redirect: known });
		expect(ok).toContain("<b>Claude</b>");
		expect(ok).not.toContain("no es un cliente conocido");
	});

	it("P1-b: GET /authorize starts no device flow", async () => {
		const handleHttp = await loadHandler();
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"GET",
				`/authorize?${new URLSearchParams({ client_id: "", redirect_uri: CB, code_challenge: "ch" })}`,
			),
			res,
		);
		expect(out.status).toBe(200);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("P1-b: /device-start refuses a request that could never end in a code", async () => {
		const handleHttp = await loadHandler();
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const { res, out } = stubRes();
		await handleHttp(
			req("POST", "/device-start", {
				client_id: "",
				redirect_uri: "https://evil.example/cb",
				code_challenge: "ch",
			}),
			res,
		);
		expect(out.status).toBe(400);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("P1-b: device flows started per IP are capped", async () => {
		const handleHttp = await loadHandler();
		const fetchSpy = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						device_code: "dc",
						user_code: "ABCD",
						verification_uri_complete: "https://admin.x/device?code=ABCD",
						interval: 5,
						expires_in: 600,
					}),
				),
		);
		vi.stubGlobal("fetch", fetchSpy);
		const start = async () => {
			const { res, out } = stubRes();
			await handleHttp(
				req("POST", "/device-start", {
					client_id: "",
					redirect_uri: CB,
					code_challenge: "ch",
				}),
				res,
			);
			return out;
		};
		for (let i = 0; i < 5; i++) expect((await start()).status).toBe(200);
		const sixth = await start();
		expect(sixth.status).toBe(429);
		expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
		expect(fetchSpy).toHaveBeenCalledTimes(5);
	});

	it("P1-b: /authorize and /device-token are rate limited per IP", async () => {
		const handleHttp = await loadHandler();
		vi.stubGlobal("fetch", vi.fn());
		const get = async () => {
			const { res, out } = stubRes();
			await handleHttp(
				req(
					"GET",
					`/authorize?${new URLSearchParams({ client_id: "", redirect_uri: CB, code_challenge: "ch" })}`,
				),
				res,
			);
			return out.status;
		};
		for (let i = 0; i < 60; i++) expect(await get()).toBe(200);
		expect(await get()).toBe(429);
		// Same bucket: the poll is told to slow down, not failed.
		const { res, out } = stubRes();
		await handleHttp(
			req("POST", "/device-token", {
				client_id: "",
				redirect_uri: CB,
				code_challenge: "ch",
				device_code: "dc",
			}),
			res,
		);
		expect(out.status).toBe(429);
		expect(JSON.parse(out.body)).toMatchObject({ pending: true, slow: true });
	});

	it("P1-b/P3: one refresh token cannot fan out to /me", async () => {
		const handleHttp = await loadHandler();
		const calls = stubMe();
		const p = { k: "ft_live_ok", c: "cl", ae: now() + DAY, exp: now() + 600 };
		const raw = seal(p, SECRET, REFRESH_PREFIX);
		const statuses: number[] = [];
		for (let i = 0; i < 7; i++) {
			const { res, out } = stubRes();
			await handleHttp(
				req(
					"POST",
					"/token",
					tokenForm({
						grant_type: "refresh_token",
						refresh_token: raw,
						client_id: "cl",
					}),
				),
				res,
			);
			statuses.push(out.status);
		}
		expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
		expect(statuses[6]).toBe(429);
		expect(calls.filter((u) => u.endsWith("/api/v1/me")).length).toBe(6);
	});

	it("P2-a: 429 and 408 from /me are a retry (503), not a forced sign-in", async () => {
		for (const status of [429, 408]) {
			const handleHttp = await loadHandler();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response("{}", { status })),
			);
			const out = await refreshWith(
				{ k: "ft_live_ok", c: "cl", ae: now() + DAY, exp: now() + 600 },
				"cl",
				handleHttp,
			);
			expect(out.status).toBe(503);
			expect(JSON.parse(out.body).error).toBe("temporarily_unavailable");
		}
	});

	it('P3: a grant bound to client_id "" is not redeemable by another client', async () => {
		const handleHttp = await loadHandler();
		stubMe();
		const out = await refreshWith(
			{ k: "ft_live_ok", c: "", ae: now() + DAY, exp: now() + 600 },
			"other",
			handleHttp,
		);
		expect(out.status).toBe(400);
		const verifier = "v".repeat(43);
		const code = seal(
			{
				k: "ft_live_ok",
				c: "",
				ch: createHash("sha256").update(verifier).digest("base64url"),
				ru: CB,
				exp: now() + 60,
			},
			SECRET,
			CODE_PREFIX,
		);
		const r = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "authorization_code",
					code,
					code_verifier: verifier,
					redirect_uri: CB,
					client_id: "other",
				}),
			),
			r.res,
		);
		expect(r.out.status).toBe(400);
		// The right client ("") still redeems it, and stays bound to "".
		const ok = await refreshWith(
			{ k: "ft_live_ok", c: "", ae: now() + DAY, exp: now() + 600 },
			"",
			handleHttp,
		);
		expect(ok.status).toBe(200);
		expect(
			open(JSON.parse(ok.body).refresh_token, SECRET, REFRESH_PREFIX)?.c,
		).toBe("");
	});

	it("P3: a refresh past its absolute end is invalid_grant", async () => {
		const handleHttp = await loadHandler();
		const calls = stubMe();
		const out = await refreshWith(
			{ k: "ft_live_ok", c: "cl", ae: now() - 1, exp: now() + 600 },
			"cl",
			handleHttp,
		);
		expect(out.status).toBe(400);
		expect(JSON.parse(out.body).error).toBe("invalid_grant");
		expect(calls.length).toBe(0);
	});

	it("P3: a legacy refresh (no ae, no c) is capped and bound once", async () => {
		const handleHttp = await loadHandler();
		stubMe();
		// Sealed by 0.22: refresh lived 90 d, no client, no absolute end.
		const first = await refreshWith(
			{ k: "ft_live_ok", w: "", exp: now() + 80 * DAY },
			"cl",
			handleHttp,
		);
		expect(first.status).toBe(200);
		const t = JSON.parse(first.body);
		const rotated = open(t.refresh_token, SECRET, REFRESH_PREFIX);
		expect(rotated?.c).toBe("cl");
		// Not a fresh 90 days: at most 30 more.
		expect(rotated?.ae).toBeLessThanOrEqual(now() + REFRESH_TTL + 1);
		expect(rotated?.ae).toBeGreaterThan(now() + REFRESH_TTL - 60);
		// Bound now: another client cannot take it over.
		const { res, out } = stubRes();
		await handleHttp(
			req(
				"POST",
				"/token",
				tokenForm({
					grant_type: "refresh_token",
					refresh_token: t.refresh_token,
					client_id: "attacker",
				}),
			),
			res,
		);
		expect(out.status).toBe(400);
		// A legacy token about to expire keeps its own end.
		const late = await refreshWith(
			{ k: "ft_live_ok", exp: now() + 2 * DAY },
			"cl",
			handleHttp,
		);
		const lateAe = open(
			JSON.parse(late.body).refresh_token,
			SECRET,
			REFRESH_PREFIX,
		)?.ae;
		expect(lateAe).toBeLessThanOrEqual(now() + 2 * DAY + 1);
		// With an issue time, the cap counts from it.
		const iat = now() - 85 * DAY;
		const old = await refreshWith(
			{ k: "ft_live_ok", iat, exp: now() + 20 * DAY },
			"cl",
			handleHttp,
		);
		expect(
			open(JSON.parse(old.body).refresh_token, SECRET, REFRESH_PREFIX)?.ae,
		).toBeCloseTo(iat + SESSION_TTL, 0);
	});
});
