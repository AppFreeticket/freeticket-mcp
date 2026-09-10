/**
 * HTTP request handler for the FreeTicket MCP — shared between the standalone
 * entrypoint (src/http.ts, `createServer` + listen) and the Vercel Function
 * (api/server.ts, which default-exports it).
 *
 * Auth — two layers consistent with the OAuth flow claude.ai requires (Add
 * custom connector):
 *   POST /mcp          requiere Bearer. Acepta (a) un access token OAuth emitido
 *                      por este mismo server (`ftmcp_…`, credenciales selladas) o
 *                      (b) a raw FT API key + `X-Workspace-Id` /
 *                      `X-Admin-Session` headers (interim, for curl and your
 *                      own clients). No Bearer → 401 + WWW-Authenticate, which
 *                      is what triggers the OAuth flow in claude.ai.
 *   POST /mcp/public   anonymous: public B2C tools only (the buyer has no
 *                      cuenta). Para agentes compradores.
 *
 * OAuth 2.1 embebido (ver src/oauth.ts): discovery RFC 8414/9728, registro
 * RFC 7591 dynamic registration, /authorize with a consent page + PKCE, /token
 * with refresh. Stateless tokens sealed with MCP_TOKEN_SECRET — no database.
 *
 * Env:
 *   FT_API_URL        B2B/admin API base (default https://admin.appfreeticket.com)
 *   MCP_PUBLIC_URL    public URL of the /mcp endpoint (for the issuer and
 *                     `resource`); without it, derived from Host + X-Forwarded-Proto
 *   MCP_TOKEN_SECRET  secret that seals the tokens; without it an ephemeral one
 *                     is generated per process (tokens die on restart — dev only)
 *   FT_OAUTH_ISSUER   delegates to an external authorization server (for
 *                     instance once free-admin publishes its own); turns the
 *                     embedded AS off
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
	CODE_PREFIX,
	CODE_TTL,
	consentPage,
	type DeviceStart,
	open,
	PENDING_PREFIX,
	PENDING_TTL,
	pkceMatches,
	REFRESH_PREFIX,
	REFRESH_TTL,
	seal,
	sealedToCreds,
} from "./oauth";
import { buildServer } from "./server";

const API_URL = normalizeApiUrl(
	process.env.FT_API_URL ?? "https://admin.appfreeticket.com",
);
const EXTERNAL_ISSUER = process.env.FT_OAUTH_ISSUER?.replace(/\/$/, "");
const TOKEN_SECRET =
	process.env.MCP_TOKEN_SECRET ??
	(() => {
		process.stderr.write(
			"MCP_TOKEN_SECRET not set: ephemeral secret, tokens do not survive a restart\n",
		);
		return randomBytes(32).toString("hex");
	})();

/** Request credentials: a sealed access token, or a raw API key (interim). */
function credsFromRequest(headers: IncomingMessage["headers"]): Creds | null {
	const auth = (headers.authorization as string) ?? "";
	const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!bearer) return null;
	const sealed = open(bearer, TOKEN_SECRET, ACCESS_PREFIX);
	if (sealed) return sealedToCreds(sealed, API_URL);
	return {
		apiUrl: API_URL,
		apiKey: bearer,
		workspaceId: (headers["x-workspace-id"] as string) || undefined,
		adminSession: (headers["x-admin-session"] as string) || undefined,
	};
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

/** Validates credentials against free-admin before minting the code. */
async function validateCreds(creds: {
	apiKey: string;
	workspaceId: string;
	adminSession: string;
}): Promise<string | null> {
	if (!creds.apiKey && !creds.adminSession)
		return "Ingresa al menos una API key o una sesión superadmin.";
	if (creds.apiKey) {
		const r = await fetch(`${API_URL}/api/v1/me`, {
			headers: {
				Authorization: `Bearer ${creds.apiKey}`,
				...(creds.workspaceId ? { "X-Workspace-Id": creds.workspaceId } : {}),
			},
		}).catch(() => null);
		if (!r?.ok) return "La API key no es válida (falló GET /api/v1/me).";
	}
	if (creds.adminSession) {
		const r = await fetch(`${API_URL}/api/admin/me`, {
			headers: { Cookie: `better-auth.session_token=${creds.adminSession}` },
		}).catch(() => null);
		if (!r?.ok)
			return "La sesión superadmin no es válida (falló GET /api/admin/me).";
	}
	return null;
}

/** Sella un authorization code atado al PKCE challenge y al redirect. */
function mintCode(
	creds: { apiKey?: string; workspaceId?: string; adminSession?: string },
	challenge: string,
	redirectUri: string,
): string {
	return seal(
		{
			k: creds.apiKey ?? "",
			w: creds.workspaceId ?? "",
			a: creds.adminSession ?? "",
			ch: challenge,
			ru: redirectUri,
			exp: Date.now() / 1000 + CODE_TTL,
		},
		TOKEN_SECRET,
		CODE_PREFIX,
	);
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
async function startDeviceFlow(): Promise<DeviceStart | undefined> {
	const r = await fetch(`${API_URL}/api/v1/auth/device/code`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	}).catch(() => null);
	if (!r?.ok) return undefined;
	const d = (await r.json()) as DeviceStart;
	return d.device_code && d.verification_uri_complete ? d : undefined;
}

function validRedirect(uri: string): boolean {
	try {
		const u = new URL(uri);
		return (
			u.protocol === "https:" ||
			u.hostname === "localhost" ||
			u.hostname === "127.0.0.1"
		);
	} catch {
		return false;
	}
}

async function handleMcp(
	req: IncomingMessage,
	res: ServerResponse,
	creds: Creds,
): Promise<void> {
	// Stateless: server + transport nuevos por request, cerrados al terminar.
	const mcp = buildServer(creds);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	res.on("close", () => {
		transport.close();
		mcp.close();
	});
	await mcp.connect(transport);
	const body = req.method === "POST" ? asJson(await readBody(req)) : undefined;
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
		"content-type, authorization, mcp-protocol-version, mcp-session-id",
	);
	res.setHeader("access-control-expose-headers", "mcp-session-id");
	if (req.method === "OPTIONS") {
		res.writeHead(204).end();
		return;
	}

	try {
		// RFC 9728 discovery — claude.ai may request it with a suffix (/…/mcp).
		if (
			req.method === "GET" &&
			url.pathname.startsWith("/.well-known/oauth-protected-resource")
		) {
			return json(res, 200, {
				resource: publicUrl,
				authorization_servers: [issuer],
				bearer_methods_supported: ["header"],
				scopes_supported: ["b2b", "admin"],
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

		// RFC 7591: dynamic registration. Stateless — nothing is persisted; the
		// real security comes from PKCE plus redirect_uri validation in /authorize.
		if (
			req.method === "POST" &&
			url.pathname === "/register" &&
			!EXTERNAL_ISSUER
		) {
			const body = (asJson(await readBody(req)) ?? {}) as {
				redirect_uris?: string[];
				client_name?: string;
			};
			return json(res, 201, {
				client_id: `ftmcp-${randomBytes(8).toString("hex")}`,
				client_name: body.client_name ?? "mcp-client",
				redirect_uris: body.redirect_uris ?? [],
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
			if (!validRedirect(url.searchParams.get("redirect_uri") ?? ""))
				return json(res, 400, {
					error: "invalid_request",
					error_description: "redirect_uri inválido",
				});
			if (!url.searchParams.get("code_challenge"))
				return json(res, 400, {
					error: "invalid_request",
					error_description: "PKCE requerido",
				});
			// Primary path: login with the free-admin session (device flow).
			const device = await startDeviceFlow();
			return html(res, consentPage(url.searchParams, { device }));
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
				pending?: string;
				workspace_id?: string;
				redirect_uri?: string;
				code_challenge?: string;
				state?: string;
			};
			const redirectUri = body.redirect_uri ?? "";
			const challenge = body.code_challenge ?? "";
			if (!validRedirect(redirectUri) || !challenge)
				return json(res, 400, { error: "invalid_request" });
			const state = body.state || null;

			// Second phase: the user picked a workspace for an already-redeemed key.
			if (body.pending) {
				const p = open(body.pending, TOKEN_SECRET, PENDING_PREFIX);
				if (!p)
					return json(res, 400, {
						error: "El código expiró. Recarga la página.",
					});
				const code = mintCode(
					{ apiKey: p.k, workspaceId: body.workspace_id },
					challenge,
					redirectUri,
				);
				return json(res, 200, {
					redirect: redirectWithCode(redirectUri, code, state),
				});
			}

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
			// A single workspace (the typical case): straight back to the MCP client.
			if (grant.workspaces.length <= 1) {
				const code = mintCode(
					{ apiKey: grant.access_token, workspaceId: grant.workspaces[0]?.id },
					challenge,
					redirectUri,
				);
				return json(res, 200, {
					redirect: redirectWithCode(redirectUri, code, state),
				});
			}
			// Several: the page shows the picker; the key travels sealed (ftp_).
			return json(res, 200, {
				workspaces: grant.workspaces.map((w) => ({ id: w.id, name: w.name })),
				pending: seal(
					{ k: grant.access_token, exp: Date.now() / 1000 + PENDING_TTL },
					TOKEN_SECRET,
					PENDING_PREFIX,
				),
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
			if (!validRedirect(redirectUri) || !challenge)
				return json(res, 400, { error: "invalid_request" });
			const creds = {
				apiKey: form.get("api_key")?.trim() ?? "",
				workspaceId: form.get("workspace_id")?.trim() ?? "",
				adminSession: form.get("admin_session")?.trim() ?? "",
			};
			const error = await validateCreds(creds);
			if (error) return html(res, consentPage(form, { error }));
			const code = mintCode(creds, challenge, redirectUri);
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
			let sealed = null;
			if (grant === "authorization_code") {
				const p = open(form.get("code") ?? "", TOKEN_SECRET, CODE_PREFIX);
				const verifier = form.get("code_verifier") ?? "";
				if (
					p &&
					p.ch &&
					pkceMatches(verifier, p.ch) &&
					form.get("redirect_uri") === p.ru
				)
					sealed = p;
			} else if (grant === "refresh_token") {
				sealed = open(
					form.get("refresh_token") ?? "",
					TOKEN_SECRET,
					REFRESH_PREFIX,
				);
			}
			if (!sealed) return json(res, 400, { error: "invalid_grant" });
			const base = { k: sealed.k, w: sealed.w, a: sealed.a };
			return json(res, 200, {
				access_token: seal(
					{ ...base, exp: Date.now() / 1000 + ACCESS_TTL },
					TOKEN_SECRET,
					ACCESS_PREFIX,
				),
				token_type: "Bearer",
				expires_in: ACCESS_TTL,
				refresh_token: seal(
					{ ...base, exp: Date.now() / 1000 + REFRESH_TTL },
					TOKEN_SECRET,
					REFRESH_PREFIX,
				),
				scope: sealed.a ? "b2b admin" : "b2b",
			});
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

		// Anonymous MCP: public B2C tools only (buyer agents, with no account).
		if (url.pathname === "/mcp/public") {
			return await handleMcp(req, res, { apiUrl: API_URL });
		}

		if (url.pathname !== "/mcp") {
			res.writeHead(404).end();
			return;
		}

		// Authenticated /mcp. The 401 + WWW-Authenticate (RFC 9728) is what tells
		// claude.ai "you get in through OAuth" and fires the connector flow.
		const creds = credsFromRequest(req.headers);
		if (!creds) {
			res.writeHead(401, {
				"content-type": "application/json",
				"www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
			});
			res.end(JSON.stringify({ error: "unauthorized" }));
			return;
		}
		await handleMcp(req, res, creds);
	} catch (err) {
		process.stderr.write(`MCP HTTP error: ${String(err)}\n`);
		if (!res.headersSent) res.writeHead(500).end();
	}
}
