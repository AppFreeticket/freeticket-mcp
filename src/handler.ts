/**
 * Request handler HTTP del FreeTicket MCP — compartido entre el entrypoint
 * standalone (src/http.ts, `createServer` + listen) y la Vercel Function
 * (api/server.ts, que lo default-exporta).
 *
 * Auth — dos capas coherentes con el flujo OAuth que exige claude.ai (Add
 * custom connector):
 *   POST /mcp          requiere Bearer. Acepta (a) un access token OAuth emitido
 *                      por este mismo server (`ftmcp_…`, credenciales selladas) o
 *                      (b) una FT API key cruda + headers `X-Workspace-Id` /
 *                      `X-Admin-Session` (interim, para curl y clientes propios).
 *                      Sin Bearer → 401 + WWW-Authenticate, que es lo que dispara
 *                      el flujo OAuth en claude.ai.
 *   POST /mcp/public   anónimo: solo tools públicos B2C (el comprador no tiene
 *                      cuenta). Para agentes compradores.
 *
 * OAuth 2.1 embebido (ver src/oauth.ts): discovery RFC 8414/9728, registro
 * dinámico RFC 7591, /authorize con página de consentimiento + PKCE, /token con
 * refresh. Tokens stateless sellados con MCP_TOKEN_SECRET — sin base de datos.
 *
 * Env:
 *   FT_API_URL        base de la API B2B/admin (default https://admin.appfreeticket.com)
 *   MCP_PUBLIC_URL    URL pública del endpoint /mcp (para issuer y `resource`);
 *                     sin ella se deriva de Host + X-Forwarded-Proto
 *   MCP_TOKEN_SECRET  secreto que sella los tokens; sin él se genera uno efímero
 *                     por proceso (los tokens mueren al reiniciar — solo dev)
 *   FT_OAUTH_ISSUER   delega a un authorization server externo (p. ej. cuando
 *                     free-admin publique el suyo); apaga el AS embebido
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type Creds, normalizeApiUrl } from "./api";
import {
	ACCESS_PREFIX,
	ACCESS_TTL,
	authServerMetadata,
	CODE_PREFIX,
	CODE_TTL,
	consentPage,
	open,
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
			"MCP_TOKEN_SECRET no seteado: secreto efímero, los tokens no sobreviven un reinicio\n",
		);
		return randomBytes(32).toString("hex");
	})();

/** Credenciales del request: access token sellado o API key cruda (interim). */
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
 * Body del request. En Node puro se lee del stream; en Vercel el runtime ya
 * consumió el stream y deja el resultado parseado (objeto o string) en req.body.
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

/** Normaliza un body form-urlencoded que puede llegar crudo o ya parseado. */
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

/** Normaliza un body JSON que puede llegar crudo o ya parseado. */
function asJson(body: unknown): unknown {
	return typeof body === "string" && body ? JSON.parse(body) : body;
}

/** Valida credenciales contra free-admin antes de acuñar el código. */
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
		// Discovery RFC 9728 — claude.ai puede pedirla con sufijo (/…/mcp).
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

		// Discovery RFC 8414 del AS embebido (apagado si se delega con FT_OAUTH_ISSUER).
		if (
			req.method === "GET" &&
			!EXTERNAL_ISSUER &&
			(url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
				url.pathname.startsWith("/.well-known/openid-configuration"))
		) {
			return json(res, 200, authServerMetadata(origin));
		}

		// RFC 7591: registro dinámico. Stateless — sin registro persistido; la
		// seguridad real la dan PKCE + validación de redirect_uri en /authorize.
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
			return html(res, consentPage(url.searchParams));
		}

		// Submit del consentimiento → authorization code sellado.
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
			if (error) return html(res, consentPage(form, error));
			const code = seal(
				{
					k: creds.apiKey,
					w: creds.workspaceId,
					a: creds.adminSession,
					ch: challenge,
					ru: redirectUri,
					exp: Date.now() / 1000 + CODE_TTL,
				},
				TOKEN_SECRET,
				CODE_PREFIX,
			);
			const target = new URL(redirectUri);
			target.searchParams.set("code", code);
			const state = form.get("state");
			if (state) target.searchParams.set("state", state);
			res.writeHead(302, { location: target.toString() }).end();
			return;
		}

		// Token endpoint: authorization_code (con PKCE) y refresh_token.
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

		// MCP anónimo: solo tools públicos B2C (agentes compradores, sin cuenta).
		if (url.pathname === "/mcp/public") {
			return await handleMcp(req, res, { apiUrl: API_URL });
		}

		if (url.pathname !== "/mcp") {
			res.writeHead(404).end();
			return;
		}

		// /mcp autenticado. El 401 + WWW-Authenticate (RFC 9728) es lo que le dice
		// a claude.ai "acá se entra por OAuth" y dispara el flujo del connector.
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
