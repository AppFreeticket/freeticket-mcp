/**
 * HTTP request handler for the FreeTicket MCP — shared between the standalone
 * entrypoint (src/http.ts, `createServer` + listen) and the Vercel Function
 * (api/server.ts, which default-exports it).
 *
 * Auth (consistent with the OAuth flow claude.ai requires, Add custom
 * connector):
 *   POST /mcp          lazy auth. Without a Bearer it serves the public_* tools
 *                      and LISTS the B2B ones; calling one of those answers
 *                      401 + WWW-Authenticate before the SDK runs, which is what
 *                      makes Claude show its inline Connect card. With a Bearer
 *                      it must be an access token issued here (`ftmcp_…`,
 *                      sealed credentials); anything else — an expired token, a
 *                      raw API key — is 401 invalid_token, so the client
 *                      refreshes or signs in again. Raw API keys are no longer
 *                      accepted as Bearer (0.23.0): use OAuth, or stdio with
 *                      FT_API_KEY.
 *                      Optional `X-Customer-Session`: a buyer session that adds
 *                      the customer_* layer (with or without a Bearer).
 *   POST /mcp/public   anonymous: public B2C tools only (the buyer has no
 *                      cuenta). Para agentes compradores.
 * Anonymous requests are rate limited per IP (see RateLimiter).
 *
 * OAuth 2.1 embebido (ver src/oauth.ts): discovery RFC 8414/9728, registro
 * RFC 7591 dynamic registration, /authorize with a consent page + PKCE, /token
 * with refresh. Stateless tokens sealed with MCP_TOKEN_SECRET — no database.
 *
 * Env:
 *   FT_API_URL        B2B/admin API base (default https://admin.appfreeticket.com)
 *   MCP_PUBLIC_URL    public URL of the /mcp endpoint (for the issuer and
 *                     `resource`); without it, derived from Host + X-Forwarded-Proto
 *   MCP_TOKEN_SECRET  secret that seals the tokens. Required on Vercel (production
 *                     and preview): without it every instance would seal with its
 *                     own key. Locally an ephemeral one is generated per process
 *                     (tokens die on restart — dev only)
 *   FT_OAUTH_ISSUER   delegates to an external authorization server (for
 *                     instance once free-admin publishes its own); turns the
 *                     embedded AS off
 *   MCP_REQUIRE_AUTH  "1" turns lazy auth off: /mcp without a Bearer answers
 *                     401 at once, as before 0.23.0 (kill switch for a client
 *                     that cannot sign in on a tool call)
 *   MCP_ANON_RPM      anonymous requests per minute per IP (default 120)
 *   OPENAI_APPS_CHALLENGE
 *                     domain-verification token issued by the OpenAI plugin
 *                     submission portal, served as plain text at
 *                     /.well-known/openai-apps-challenge. Unset → that path 404s
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type Creds, normalizeApiUrl } from "./api";
import { FAVICON_SVG } from "./brand";
import {
	ACCESS_PREFIX,
	ACCESS_TTL,
	authServerMetadata,
	CLIENT_PREFIX,
	CLIENT_TTL,
	CODE_PREFIX,
	CODE_TTL,
	checkRedirect,
	consentPage,
	type DeviceStart,
	grantedScope,
	open,
	pkceMatches,
	REFRESH_PREFIX,
	REFRESH_TTL,
	SCOPES,
	SESSION_TTL,
	type Sealed,
	seal,
	sealedToCreds,
	wantsReadOnly,
} from "./oauth";
import { buildServer, toolNames } from "./server";

const API_URL = normalizeApiUrl(
	process.env.FT_API_URL ?? "https://admin.appfreeticket.com",
);
const REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH === "1";
const ANON_RPM = Number(process.env.MCP_ANON_RPM) || 120;
const EXTERNAL_ISSUER = process.env.FT_OAUTH_ISSUER?.replace(/\/$/, "");
/**
 * Domain-verification token for the OpenAI plugin directory, served verbatim at
 * /.well-known/openai-apps-challenge. Trimmed because a value pasted into a
 * dashboard field arrives with a trailing newline more often than not, and the
 * portal compares the bytes.
 */
const OPENAI_APPS_CHALLENGE = process.env.OPENAI_APPS_CHALLENGE?.trim();
const TOKEN_SECRET =
	process.env.MCP_TOKEN_SECRET?.trim() ||
	(() => {
		// Fail closed where instances are many: each one would mint its own
		// secret and reject the tokens of the others at random.
		const env = process.env.VERCEL_ENV;
		if (env === "production" || env === "preview")
			throw new Error("MCP_TOKEN_SECRET is required on Vercel");
		process.stderr.write(
			"MCP_TOKEN_SECRET not set: ephemeral secret, tokens do not survive a restart\n",
		);
		return randomBytes(32).toString("hex");
	})();

type RequestAuth =
	| { kind: "anonymous"; creds: Creds }
	| { kind: "invalid" }
	| { kind: "ok"; creds: Creds };

/**
 * Request credentials. Only an access token sealed by this server counts as a
 * Bearer: the raw-API-key fallback is gone (0.23.0). Besides being the
 * credential-in-plaintext path the audit flagged, it turned an EXPIRED access
 * token into a "raw key" that free-admin then rejected tool by tool, so the
 * client never learnt it had to refresh. The buyer session rides in its own
 * header and is never mixed into the B2B credential.
 */
export function authFromRequest(
	headers: IncomingMessage["headers"],
	secret: string,
	apiUrl: string,
): RequestAuth {
	const customerSession =
		(headers["x-customer-session"] as string | undefined)?.trim() || undefined;
	const extra = customerSession ? { customerSession } : {};
	const auth = (headers.authorization as string) ?? "";
	const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!bearer) return { kind: "anonymous", creds: { apiUrl, ...extra } };
	const sealed = open(bearer, secret, ACCESS_PREFIX);
	if (!sealed) return { kind: "invalid" };
	return { kind: "ok", creds: { ...sealedToCreds(sealed, apiUrl), ...extra } };
}

/**
 * Best-effort per-IP limiter for anonymous traffic: a fixed one-minute window
 * held in memory, so it is per instance (Fluid Compute reuses instances, which
 * is what makes it bite). It caps one client hammering free-admin's public API
 * through us; it is not a quota. Authenticated traffic is limited by
 * free-admin per key.
 */
export class RateLimiter {
	private hits = new Map<string, { n: number; reset: number }>();
	constructor(
		private limit: number,
		private windowMs = 60_000,
	) {}
	/** Seconds to wait, or 0 when the request may pass. */
	check(key: string, now = Date.now()): number {
		if (this.hits.size > 10_000)
			for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
		const h = this.hits.get(key);
		if (!h || h.reset <= now) {
			this.hits.set(key, { n: 1, reset: now + this.windowMs });
			return 0;
		}
		h.n++;
		return h.n > this.limit ? Math.ceil((h.reset - now) / 1000) : 0;
	}
}
const anonLimiter = new RateLimiter(ANON_RPM);

function clientIp(req: IncomingMessage): string {
	const fwd = (req.headers["x-forwarded-for"] as string) ?? "";
	return (
		fwd.split(",")[0].trim() ||
		(req.headers["x-real-ip"] as string) ||
		req.socket?.remoteAddress ||
		"unknown"
	);
}

/**
 * What an anonymous session really has: public_*, plus customer_* with a buyer
 * session. Names only depend on which layers are on, so they are computed once
 * per layer set and reused.
 */
const anonymousToolCache = new Map<boolean, Set<string>>();
function anonymousTools(withCustomer: boolean): Set<string> {
	let names = anonymousToolCache.get(withCustomer);
	if (!names) {
		names = toolNames(
			buildServer({
				apiUrl: API_URL,
				...(withCustomer ? { customerSession: "names-only" } : {}),
			}),
		);
		anonymousToolCache.set(withCustomer, names);
	}
	return names;
}

/** Names of the tools a JSON-RPC body (single or batch) calls. */
export function calledTools(body: unknown): string[] {
	const msgs = Array.isArray(body) ? body : [body];
	return msgs.flatMap((m) => {
		const name =
			m &&
			typeof m === "object" &&
			(m as { method?: unknown }).method === "tools/call"
				? (m as { params?: { name?: unknown } }).params?.name
				: undefined;
		return typeof name === "string" ? [name] : [];
	});
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function html(res: ServerResponse, body: string): void {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(body);
}

/**
 * The request body. On plain Node it is read from the stream; on Vercel the
 * runtime already consumed the stream and leaves the parsed result (an object
 * or a string) in req.body.
 */
async function readBody(req: IncomingMessage): Promise<unknown> {
	const pre = (req as IncomingMessage & { body?: unknown }).body;
	if (pre !== undefined && pre !== null) return pre;
	const raw = await new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c as Buffer));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
	return raw || undefined;
}

/** Normalizes a form-urlencoded body that may arrive raw or already parsed. */
export function asForm(body: unknown): URLSearchParams {
	if (typeof body === "string") return new URLSearchParams(body);
	const params = new URLSearchParams();
	if (body && typeof body === "object") {
		for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
			if (typeof v === "string") params.set(k, v);
		}
	}
	return params;
}

/** Normalizes a JSON body that may arrive raw or already parsed. */
function asJson(body: unknown): unknown {
	return typeof body === "string" && body ? JSON.parse(body) : body;
}

type KeyCheck =
	| { status: "ok"; scope: "read" | "write" }
	| { status: "invalid" }
	| { status: "unavailable" };

/**
 * Validates an API key against free-admin (GET /api/v1/me) and reads its
 * scope. `unavailable` = free-admin did not answer (network, 5xx): not proof
 * the key is dead, so a refresh is told to retry rather than to sign in again.
 */
async function checkKey(
	apiKey: string,
	workspaceId?: string,
): Promise<KeyCheck> {
	const r = await fetch(`${API_URL}/api/v1/me`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
		},
	}).catch(() => null);
	if (!r || r.status >= 500) return { status: "unavailable" };
	if (!r.ok) return { status: "invalid" };
	const me = (await r.json().catch(() => ({}))) as {
		data?: { scope?: string };
	};
	return { status: "ok", scope: me.data?.scope === "read" ? "read" : "write" };
}

/** Sella un authorization code atado al PKCE challenge y al redirect. */
function mintCode(
	creds: { apiKey: string; workspaceId?: string; readOnly: boolean },
	challenge: string,
	redirectUri: string,
	clientId: string,
): string {
	return seal(
		{
			c: clientId,
			k: creds.apiKey,
			w: creds.workspaceId ?? "",
			...(creds.readOnly ? { s: "read" as const } : {}),
			ch: challenge,
			ru: redirectUri,
			exp: Date.now() / 1000 + CODE_TTL,
		},
		TOKEN_SECRET,
		CODE_PREFIX,
	);
}

/** Access + rotated refresh for a grant. The refresh never outlives `ae`. */
function issueTokens(p: Sealed, clientId: string) {
	const now = Date.now() / 1000;
	const ae = p.ae ?? now + SESSION_TTL;
	const base = {
		k: p.k,
		w: p.w,
		...(p.s === "read" ? { s: "read" as const } : {}),
		c: clientId || p.c,
		ae,
	};
	return {
		access_token: seal(
			{ ...base, exp: Math.min(now + ACCESS_TTL, ae) },
			TOKEN_SECRET,
			ACCESS_PREFIX,
		),
		token_type: "Bearer",
		expires_in: Math.round(Math.min(ACCESS_TTL, ae - now)),
		refresh_token: seal(
			{ ...base, exp: Math.min(now + REFRESH_TTL, ae) },
			TOKEN_SECRET,
			REFRESH_PREFIX,
		),
		scope: grantedScope(p),
	};
}

function redirectWithCode(
	redirectUri: string,
	code: string,
	state: string | null,
): string {
	const target = new URL(redirectUri);
	target.searchParams.set("code", code);
	if (state) target.searchParams.set("state", state);
	return target.toString();
}

/**
 * Starts the device flow (RFC 8628) against free-admin — the same backend as
 * `ft login`. If it fails (old backend, network), the consent page falls back
 * to the manual form.
 */
async function startDeviceFlow(
	readOnly: boolean,
): Promise<DeviceStart | undefined> {
	const r = await fetch(`${API_URL}/api/v1/auth/device/code`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	}).catch(() => null);
	if (!r?.ok) return undefined;
	const d = (await r.json()) as DeviceStart;
	if (!d.device_code || !d.verification_uri_complete) return undefined;
	// free-admin's /device pre-ticks "Solo lectura" with ?scope=read (#1220).
	if (readOnly) {
		const u = new URL(d.verification_uri_complete);
		u.searchParams.set("scope", "read");
		d.verification_uri_complete = u.toString();
	}
	return d;
}

async function handleMcp(
	req: IncomingMessage,
	res: ServerResponse,
	creds: Creds,
	body: unknown,
	opts: { listProtected?: boolean } = {},
): Promise<void> {
	// Stateless: server + transport nuevos por request, cerrados al terminar.
	const mcp = buildServer(creds, opts);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	res.on("close", () => {
		transport.close();
		mcp.close();
	});
	await mcp.connect(transport);
	await transport.handleRequest(req, res, body);
}

export async function handleHttp(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
	const url = new URL(req.url ?? "/", `${proto}://${req.headers.host}`);
	const publicUrl =
		process.env.MCP_PUBLIC_URL ?? `${url.protocol}//${req.headers.host}/mcp`;
	const origin = new URL(publicUrl).origin;
	const issuer = EXTERNAL_ISSUER ?? origin;

	// CORS: clientes MCP en browser + discovery OAuth.
	res.setHeader("access-control-allow-origin", "*");
	res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
	res.setHeader(
		"access-control-allow-headers",
		"content-type, authorization, mcp-protocol-version, mcp-session-id, x-customer-session",
	);
	res.setHeader("access-control-expose-headers", "mcp-session-id");
	if (req.method === "OPTIONS") {
		res.writeHead(204).end();
		return;
	}

	try {
		// Domain verification for the OpenAI plugin directory: the submission
		// portal issues a token and then fetches it back from this exact path, as
		// plain text and nothing else. The value lives in the deployment config,
		// never in the repo — a committed challenge is one anybody can serve from
		// a fork of it. Unset, this answers 404 and says what to set: inventing a
		// token would hand the portal a verification that passes and proves
		// nothing.
		if (
			req.method === "GET" &&
			url.pathname === "/.well-known/openai-apps-challenge"
		) {
			if (!OPENAI_APPS_CHALLENGE)
				return json(res, 404, {
					error: {
						code: "challenge_not_configured",
						message:
							"Set OPENAI_APPS_CHALLENGE in the deployment to the token the OpenAI submission portal issued for this domain.",
						retryable: false,
					},
				});
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
			res.end(OPENAI_APPS_CHALLENGE);
			return;
		}

		// RFC 9728 discovery — claude.ai may request it with a suffix (/…/mcp).
		if (
			req.method === "GET" &&
			url.pathname.startsWith("/.well-known/oauth-protected-resource")
		) {
			return json(res, 200, {
				resource: publicUrl,
				authorization_servers: [issuer],
				bearer_methods_supported: ["header"],
				scopes_supported: [...SCOPES],
			});
		}

		// RFC 8414 discovery for the embedded AS (off when delegating via FT_OAUTH_ISSUER).
		if (
			req.method === "GET" &&
			!EXTERNAL_ISSUER &&
			(url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
				url.pathname.startsWith("/.well-known/openid-configuration"))
		) {
			return json(res, 200, authServerMetadata(origin));
		}

		// RFC 7591: dynamic registration. Stateless — nothing is persisted: the
		// client_id IS the sealed list of redirect_uris, and /authorize only
		// redirects to one registered with that id (see checkRedirect).
		if (
			req.method === "POST" &&
			url.pathname === "/register" &&
			!EXTERNAL_ISSUER
		) {
			const body = (asJson(await readBody(req)) ?? {}) as {
				redirect_uris?: unknown;
				client_name?: unknown;
			};
			// Entries this server can never redirect to (custom schemes and the
			// like) are dropped rather than failing the whole registration.
			const uris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : [])
				.filter(
					(u): u is string =>
						typeof u === "string" && !!checkRedirect("", u, TOKEN_SECRET).host,
				)
				.slice(0, 10);
			if (!uris.length)
				return json(res, 400, {
					error: "invalid_redirect_uri",
					error_description:
						"redirect_uris must list 1-10 https (or loopback) URLs",
				});
			const name =
				typeof body.client_name === "string"
					? body.client_name.slice(0, 80)
					: "mcp-client";
			return json(res, 201, {
				client_id: seal(
					{ rus: uris, n: name, exp: Date.now() / 1000 + CLIENT_TTL },
					TOKEN_SECRET,
					CLIENT_PREFIX,
				),
				client_name: name,
				redirect_uris: uris,
				token_endpoint_auth_method: "none",
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
			});
		}

		// Página de consentimiento.
		if (
			req.method === "GET" &&
			url.pathname === "/authorize" &&
			!EXTERNAL_ISSUER
		) {
			const redirect = checkRedirect(
				url.searchParams.get("client_id") ?? "",
				url.searchParams.get("redirect_uri") ?? "",
				TOKEN_SECRET,
			);
			if (!redirect.ok)
				return json(res, 400, {
					error: "invalid_request",
					error_description:
						"redirect_uri is not registered for this client_id",
				});
			if (!url.searchParams.get("code_challenge"))
				return json(res, 400, {
					error: "invalid_request",
					error_description: "PKCE requerido",
				});
			// Primary path: login with the free-admin session (device flow).
			const device = await startDeviceFlow(
				wantsReadOnly(url.searchParams.get("scope")),
			);
			return html(res, consentPage(url.searchParams, { device, redirect }));
		}

		// Device flow polling from the consent page. Stateless: the device_code
		// lives in the browser; here it is only redeemed against free-admin and
		// the sealed authorization code is minted.
		if (
			req.method === "POST" &&
			url.pathname === "/device-token" &&
			!EXTERNAL_ISSUER
		) {
			const body = (asJson(await readBody(req)) ?? {}) as {
				device_code?: string;
				client_id?: string;
				redirect_uri?: string;
				code_challenge?: string;
				state?: string;
				scope?: string;
			};
			const redirectUri = body.redirect_uri ?? "";
			const challenge = body.code_challenge ?? "";
			if (
				!checkRedirect(body.client_id ?? "", redirectUri, TOKEN_SECRET).ok ||
				!challenge
			)
				return json(res, 400, { error: "invalid_request" });
			const state = body.state || null;

			if (!body.device_code)
				return json(res, 400, { error: "invalid_request" });
			const r = await fetch(`${API_URL}/api/v1/auth/device/token`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					device_code: body.device_code,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			}).catch(() => null);
			if (!r) return json(res, 200, { pending: true });
			if (!r.ok) {
				const err = ((await r.json().catch(() => ({}))) as { error?: string })
					.error;
				if (err === "authorization_pending")
					return json(res, 200, { pending: true });
				if (err === "slow_down")
					return json(res, 200, { pending: true, slow: true });
				return json(res, 200, {
					error:
						"El código expiró o fue rechazado. Recarga la página para reintentar.",
				});
			}
			const grant = (await r.json()) as {
				access_token: string;
				workspaces: { id: string; name: string }[];
			};
			// The token seals NO workspace. Logging in used to end on a picker —
			// "choose the one workspace this connection is about" — and everything
			// downstream then read that one tenant. Connecting your account means
			// connecting your account: the reads widen to every workspace the key
			// reaches, and the writes land on the account's default one, which is
			// what /api/v1 already does when X-Workspace-Id is absent. To bind a
			// connection to a single tenant, use the advanced form's workspace
			// field (or FT_WORKSPACE_ID over stdio).
			//
			// Read-only when the client asked for scope `read` OR the user ticked
			// "Solo lectura" on /device (the key's own scope, read from /me). Either
			// one is enough: the client's ask is honoured even if the user unticked
			// the box, and the key's limit even if the client did not ask.
			const key = await checkKey(grant.access_token);
			if (key.status !== "ok")
				return json(res, 200, {
					error:
						"No se pudo verificar la conexión. Recarga la página para reintentar.",
				});
			const code = mintCode(
				{
					apiKey: grant.access_token,
					readOnly: wantsReadOnly(body.scope) || key.scope === "read",
				},
				challenge,
				redirectUri,
				body.client_id ?? "",
			);
			return json(res, 200, {
				redirect: redirectWithCode(redirectUri, code, state),
			});
		}

		// Consent submit → sealed authorization code.
		if (
			req.method === "POST" &&
			url.pathname === "/authorize" &&
			!EXTERNAL_ISSUER
		) {
			const form = asForm(await readBody(req));
			const redirectUri = form.get("redirect_uri") ?? "";
			const challenge = form.get("code_challenge") ?? "";
			const redirect = checkRedirect(
				form.get("client_id") ?? "",
				redirectUri,
				TOKEN_SECRET,
			);
			if (!redirect.ok || !challenge)
				return json(res, 400, { error: "invalid_request" });
			// The superadmin-cookie field is gone (0.23.0): a pasted session
			// cookie is a bearer secret with no scope and no revocation of its own.
			// admin_* stays on stdio until free-admin issues admin credentials
			// through a device flow.
			const apiKey = form.get("api_key")?.trim() ?? "";
			const workspaceId = form.get("workspace_id")?.trim() ?? "";
			const key = apiKey
				? await checkKey(apiKey, workspaceId || undefined)
				: ({ status: "invalid" } as const);
			if (key.status !== "ok")
				return html(
					res,
					consentPage(form, {
						error: apiKey
							? "La API key no es válida (falló GET /api/v1/me)."
							: "Ingresa una API key.",
						redirect,
					}),
				);
			const code = mintCode(
				{
					apiKey,
					workspaceId,
					readOnly:
						form.get("read_only") === "1" ||
						wantsReadOnly(form.get("scope")) ||
						key.scope === "read",
				},
				challenge,
				redirectUri,
				form.get("client_id") ?? "",
			);
			res
				.writeHead(302, {
					location: redirectWithCode(redirectUri, code, form.get("state")),
				})
				.end();
			return;
		}

		// Token endpoint: authorization_code (with PKCE) and refresh_token.
		if (
			req.method === "POST" &&
			url.pathname === "/token" &&
			!EXTERNAL_ISSUER
		) {
			const form = asForm(await readBody(req));
			const grant = form.get("grant_type");
			const clientId = form.get("client_id") ?? "";
			let sealed: Sealed | null = null;
			if (grant === "authorization_code") {
				const p = open(form.get("code") ?? "", TOKEN_SECRET, CODE_PREFIX);
				const verifier = form.get("code_verifier") ?? "";
				if (
					p?.ch &&
					pkceMatches(verifier, p.ch) &&
					form.get("redirect_uri") === p.ru &&
					// RFC 6749 §4.1.3: the code is redeemed by the client it was issued to.
					(p.c === undefined || clientId === p.c)
				)
					sealed = p;
			} else if (grant === "refresh_token") {
				const p = open(
					form.get("refresh_token") ?? "",
					TOKEN_SECRET,
					REFRESH_PREFIX,
				);
				// RFC 6749 §6: bound to the client it was issued to. Refresh tokens
				// sealed before 0.23.0 carry no client and stay valid until exp.
				if (p && (!p.c || clientId === p.c)) sealed = p;
				// No key (a legacy admin-only token) → nothing left to refresh.
				if (sealed && !sealed.k) sealed = null;
				if (sealed?.k) {
					// The revocation point of a stateless design: a key revoked in
					// free-admin stops refreshing here, within one access TTL. A
					// key whose scope dropped to read narrows the connection.
					const key = await checkKey(sealed.k, sealed.w || undefined);
					if (key.status === "unavailable")
						return json(res, 503, { error: "temporarily_unavailable" });
					if (key.status === "invalid") sealed = null;
					else if (key.scope === "read") sealed = { ...sealed, s: "read" };
				}
			}
			if (!sealed?.k) return json(res, 400, { error: "invalid_grant" });
			return json(res, 200, issueTokens(sealed, clientId));
		}

		// Health check.
		if (req.method === "GET" && url.pathname === "/") {
			return json(res, 200, { name: "freeticket-mcp", status: "ok" });
		}

		// Favicon — free-admin's (one brand across the whole FreeTicket surface).
		if (
			req.method === "GET" &&
			(url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")
		) {
			res.writeHead(200, {
				"content-type": "image/svg+xml",
				"cache-control": "public, max-age=86400",
			});
			res.end(FAVICON_SVG);
			return;
		}

		const isMcp = url.pathname === "/mcp" || url.pathname === "/mcp/public";
		if (!isMcp) {
			res.writeHead(404).end();
			return;
		}
		const challenge = (error: string, description: string) =>
			`Bearer error="${error}", error_description="${description}", resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="b2b"`;
		const auth = authFromRequest(req.headers, TOKEN_SECRET, API_URL);

		// A Bearer that does not open (expired, foreign, a raw API key) is never
		// served anonymously: 401 invalid_token makes the client refresh.
		if (url.pathname === "/mcp" && auth.kind === "invalid") {
			res.writeHead(401, {
				"content-type": "application/json",
				"www-authenticate": challenge(
					"invalid_token",
					"The access token is invalid or expired",
				),
			});
			res.end(
				JSON.stringify({
					error: "invalid_token",
					error_description:
						"Invalid or expired access token. Raw API keys are not accepted: connect through OAuth, or use stdio with FT_API_KEY.",
				}),
			);
			return;
		}
		if (url.pathname === "/mcp" && auth.kind === "ok") {
			const body =
				req.method === "POST" ? asJson(await readBody(req)) : undefined;
			return await handleMcp(req, res, auth.creds, body);
		}

		// Anonymous from here on: /mcp/public always, /mcp without a Bearer.
		// No standalone SSE stream for anonymous sessions: in stateless mode it
		// never closes (#29), and lazy auth must not open that path to anyone.
		if (req.method === "GET") {
			res.writeHead(405, { allow: "POST" }).end();
			return;
		}
		const wait = anonLimiter.check(clientIp(req));
		if (wait) {
			res.writeHead(429, {
				"content-type": "application/json",
				"retry-after": String(wait),
			});
			res.end(JSON.stringify({ error: "rate_limited", retryAfter: wait }));
			return;
		}
		const anon =
			auth.kind === "anonymous" && url.pathname === "/mcp"
				? auth.creds
				: { apiUrl: API_URL };

		if (url.pathname === "/mcp" && REQUIRE_AUTH) {
			res.writeHead(401, {
				"content-type": "application/json",
				"www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
			});
			res.end(JSON.stringify({ error: "unauthorized" }));
			return;
		}

		const body =
			req.method === "POST" ? asJson(await readBody(req)) : undefined;
		if (url.pathname === "/mcp") {
			// Lazy auth gate, BEFORE the SDK: a tool this anonymous session does
			// not really have (B2B, listed so the model can pick it) answers 401
			// + WWW-Authenticate. Inside the SDK it would be a 200 tool error,
			// and Claude only signs in on a transport-level 401.
			const allowed = anonymousTools(!!anon.customerSession);
			if (calledTools(body).some((n) => !allowed.has(n))) {
				res.writeHead(401, {
					"content-type": "application/json",
					"www-authenticate": challenge(
						"invalid_token",
						"Authentication required for this tool",
					),
				});
				res.end(
					JSON.stringify({
						error: "invalid_token",
						error_description: "Authentication required for this tool",
					}),
				);
				return;
			}
			return await handleMcp(req, res, anon, body, { listProtected: true });
		}
		// /mcp/public: public B2C tools only (buyer agents, with no account).
		await handleMcp(req, res, anon, body);
	} catch (err) {
		process.stderr.write(`MCP HTTP error: ${String(err)}\n`);
		if (!res.headersSent) res.writeHead(500).end();
	}
}
