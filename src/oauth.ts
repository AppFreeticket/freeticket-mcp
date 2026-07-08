/**
 * OAuth 2.1 embebido para el transporte HTTP remoto.
 *
 * claude.ai (Add custom connector) solo sabe autenticar connectors vía OAuth:
 * discovery (RFC 8414/9728) → dynamic client registration (RFC 7591) →
 * authorize con PKCE → token. No puede mandar headers custom ni una API key.
 *
 * Este módulo es el puente: una página de consentimiento donde el usuario pega
 * sus credenciales FreeTicket (API key B2B, workspace, sesión superadmin) y un
 * emisor de tokens **stateless**: el token es el payload de credenciales
 * sellado con AES-256-GCM bajo MCP_TOKEN_SECRET. No hay base de datos ni
 * registro de clientes — el server no guarda nada.
 *
 * ponytail: AS embebido en el mcp; si free-admin publica un authorization
 * server real, FT_OAUTH_ISSUER lo delega sin tocar este código.
 */
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import type { Creds } from "./api";

/** Payload sellado dentro de un token/código. Claves cortas: viaja en la URL. */
export interface Sealed {
	/** API key B2B */
	k?: string;
	/** workspace id */
	w?: string;
	/** sesión superadmin (cookie better-auth) */
	a?: string;
	/** PKCE code_challenge — solo en authorization codes */
	ch?: string;
	/** redirect_uri — solo en authorization codes */
	ru?: string;
	/** expiración, epoch en segundos */
	exp: number;
}

export const ACCESS_PREFIX = "ftmcp_";
export const REFRESH_PREFIX = "ftr_";
export const CODE_PREFIX = "ftc_";
export const ACCESS_TTL = 30 * 24 * 3600;
export const REFRESH_TTL = 90 * 24 * 3600;
export const CODE_TTL = 300;

const keyFrom = (secret: string) =>
	createHash("sha256").update(secret).digest();

export function seal(payload: Sealed, secret: string, prefix: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
	const ct = Buffer.concat([
		cipher.update(JSON.stringify(payload), "utf8"),
		cipher.final(),
	]);
	return (
		prefix + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")
	);
}

/** Abre un token sellado. `null` si el prefijo, la firma o el exp no validan. */
export function open(
	token: string,
	secret: string,
	prefix: string,
): Sealed | null {
	if (!token.startsWith(prefix)) return null;
	try {
		const raw = Buffer.from(token.slice(prefix.length), "base64url");
		const d = createDecipheriv(
			"aes-256-gcm",
			keyFrom(secret),
			raw.subarray(0, 12),
		);
		d.setAuthTag(raw.subarray(12, 28));
		const p = JSON.parse(
			Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"),
		) as Sealed;
		return p.exp > Date.now() / 1000 ? p : null;
	} catch {
		return null;
	}
}

export function pkceMatches(verifier: string, challenge: string): boolean {
	return (
		createHash("sha256").update(verifier).digest("base64url") === challenge
	);
}

export function sealedToCreds(p: Sealed, apiUrl: string): Creds {
	return {
		apiUrl,
		apiKey: p.k || undefined,
		workspaceId: p.w || undefined,
		adminSession: p.a || undefined,
	};
}

/** Metadata RFC 8414 del authorization server embebido. */
export function authServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/authorize`,
		token_endpoint: `${origin}/token`,
		registration_endpoint: `${origin}/register`,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
		scopes_supported: ["b2b", "admin"],
	};
}

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Página de consentimiento: el usuario pega sus credenciales FreeTicket y
 * autoriza al cliente MCP. Copy en español neutro (audiencia LATAM).
 *
 * Diseño = tokens de free-admin (globals.css): amarillo #ffd500 sobre negro
 * #070707, muted #717182, borde #e0e0e0, radios 0.75rem card / 0.5rem botón,
 * dark mode con los mismos oklch del tema `.dark`.
 */
export function consentPage(params: URLSearchParams, error?: string): string {
	const hidden = [
		"client_id",
		"redirect_uri",
		"state",
		"code_challenge",
		"scope",
	]
		.map(
			(k) =>
				`<input type="hidden" name="${k}" value="${esc(params.get(k) ?? "")}">`,
		)
		.join("\n      ");
	return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar FreeTicket</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root{
    --background:#f5f5f5;--card:#ffffff;--foreground:#070707;
    --muted-foreground:#717182;--border:#e0e0e0;--input-background:#f7f7f7;
    --primary:#ffd500;--primary-foreground:#070707;
    --destructive:#d4183d;--radius-card:.75rem;--radius-button:.5rem;
  }
  @media (prefers-color-scheme: dark){:root{
    --background:oklch(.145 0 0);--card:oklch(.2 0 0);--foreground:oklch(.985 0 0);
    --muted-foreground:oklch(.708 0 0);--border:oklch(.269 0 0);
    --input-background:oklch(.17 0 0);--destructive:oklch(.637 .237 25.331);
  }}
  *{box-sizing:border-box}
  body{font-family:Inter,system-ui,-apple-system,sans-serif;background:var(--background);
    color:var(--foreground);display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem}
  form{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);
    padding:2rem;width:min(420px,100%);box-shadow:0 1px 3px rgb(0 0 0 / .06)}
  .logo{width:44px;height:44px;border-radius:.6rem;display:block;margin-bottom:1rem}
  h1{font-size:1.25rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .35rem}
  p{color:var(--muted-foreground);font-size:.85rem;line-height:1.45;margin:.25rem 0 1rem}
  label{display:block;font-size:.8rem;font-weight:500;margin:.85rem 0 .3rem}
  label small{color:var(--muted-foreground);font-weight:400}
  code{font-family:ui-monospace,monospace;font-size:.75rem}
  input[type=text],input[type=password]{width:100%;background:var(--input-background);
    border:1px solid var(--border);border-radius:var(--radius-button);color:var(--foreground);
    padding:.6rem .7rem;font-size:.9rem;outline:none}
  input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgb(255 213 0 / .3)}
  button{margin-top:1.4rem;width:100%;padding:.7rem;border:0;border-radius:var(--radius-button);
    background:var(--primary);color:var(--primary-foreground);font:inherit;font-weight:600;
    font-size:.95rem;cursor:pointer}
  button:hover{filter:brightness(.95)}
  .err{border:1px solid var(--destructive);color:var(--destructive);
    border-radius:var(--radius-button);padding:.6rem .7rem;font-size:.85rem;margin-bottom:.5rem}
  .foot{margin:1rem 0 0;font-size:.78rem}
</style></head><body>
  <form method="post" action="/authorize">
    <img class="logo" src="/favicon.svg" alt="FreeTicket">
    <h1>Conectar FreeTicket</h1>
    <p>Un cliente MCP pide acceso a tu cuenta. Pega tus credenciales; se sellan
    dentro del token y este servidor no las almacena.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <label>API key B2B <small>(opcional — genera una con <code>ft login</code> o en el panel)</small></label>
    <input type="password" name="api_key" autocomplete="off">
    <label>Workspace ID <small>(opcional)</small></label>
    <input type="text" name="workspace_id" autocomplete="off">
    <label>Sesión superadmin <small>(opcional — cookie <code>better-auth.session_token</code>)</small></label>
    <input type="password" name="admin_session" autocomplete="off">
    ${hidden}
    <button type="submit">Autorizar</button>
    <p class="foot">Sin credenciales solo se habilitan los tools públicos B2C.</p>
  </form>
</body></html>`;
}
