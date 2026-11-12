import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliConfig } from "./api";
import {
	ACCESS_PREFIX,
	ACCESS_TTL,
	CODE_PREFIX,
	consentPage,
	open,
	REFRESH_PREFIX,
	SESSION_TTL,
	seal,
	wantsReadOnly,
} from "./oauth";
import { buildServer, readOnlyView, toolNames } from "./server";

/**
 * Auth hardening (0.23.0, Block MCP playbook): short-lived access tokens with
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
			{ k: "ft_live_ok", w: "", c: "cl", exp: Date.now() / 1000 + 600 },
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
		const page = stubRes();
		await handleHttp(
			req(
				"GET",
				`/authorize?${new URLSearchParams({ client_id: "", redirect_uri: CB, code_challenge: "ch", scope: "read" })}`,
			),
			page.res,
		);
		expect(page.out.body).toContain("scope=read");

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
		stubMe("read");
		const verifier = "v".repeat(43);
		const code = seal(
			{
				k: "ft_live_ro",
				s: "read",
				c: "cl",
				ch: createHash("sha256").update(verifier).digest("base64url"),
				ru: CB,
				exp: Date.now() / 1000 + 60,
			},
			SECRET,
			CODE_PREFIX,
		);
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
		await start({ MCP_ANON_RPM: "2" });
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
});
