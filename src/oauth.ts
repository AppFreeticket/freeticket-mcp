/**
 * Embedded OAuth 2.1 for the remote HTTP transport.
 *
 * claude.ai (Add custom connector) solo sabe autenticar connectors vía OAuth:
 * discovery (RFC 8414/9728) → dynamic client registration (RFC 7591) →
 * authorize with PKCE → token. It cannot send custom headers or an API key.
 *
 * This module is the bridge: a consent page where the user signs in with their
 * FreeTicket account (device flow) or, for CI, pastes a B2B API key, and a
 * **stateless** token issuer — the token is the credential payload sealed with
 * AES-256-GCM under MCP_TOKEN_SECRET. There is no database and no client
 * registry; the server stores nothing.
 *
 * Token lifetimes (Block MCP playbook: short-lived access, rotating refresh):
 *  - access  1 h  (ACCESS_TTL). Claude refreshes ahead of expiry.
 *  - refresh 30 d (REFRESH_TTL), rotated on every use, and never past the
 *    absolute session cap of 90 d from the original sign-in (SESSION_TTL).
 * Trade-off of staying stateless: a used refresh token cannot be invalidated
 * (no store to remember it), so replay of a stolen refresh token is not
 * detected. What bounds it instead: every refresh re-validates the sealed API
 * key against free-admin (GET /api/v1/me), so revoking the key in the panel
 * or with `ft api-keys revoke` kills the connection within one access TTL, and
 * the absolute cap ends every session. Reuse detection needs a store (KV, or
 * an authorization server in free-admin behind FT_OAUTH_ISSUER).
 *
 * The consent page copy is in Spanish on purpose: it is the login screen a
 * FreeTicket organizer sees, and their product language is Spanish. Everything
 * else in this repo is English.
 *
 * ponytail: the AS is embedded in the mcp; if free-admin ever publishes a real
 * authorization server, FT_OAUTH_ISSUER delegates to it without touching this
 * code.
 */
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import type { Creds } from "./api";

/** Payload sealed inside a token or code. Short keys: it travels in the URL. */
export interface Sealed {
	/** API key B2B */
	k?: string;
	/** workspace id */
	w?: string;
	/** superadmin session (better-auth cookie). LEGACY: no longer sealed and
	 * ignored when opened — admin_* no longer travels through hosted OAuth. */
	a?: string;
	/** granted scope: "read" = read-only connection. Absent = read/write. */
	s?: "read";
	/** absolute session end (epoch s): refresh rotation never extends past it */
	ae?: number;
	/** PKCE code_challenge — solo en authorization codes */
	ch?: string;
	/** redirect_uri — solo en authorization codes */
	ru?: string;
	/** registered redirect_uris — only in client ids */
	rus?: string[];
	/** registered client_name — only in client ids */
	n?: string;
	/** client_id the code was issued to — only in authorization codes */
	c?: string;
	/** token type (its prefix). Sealed since client ids exist: /register hands
	 * anybody a sealed blob, and without it that blob opened under another
	 * prefix. Payloads sealed before carry none and stay valid. */
	t?: string;
	/** issued at (epoch s). Read only when present: legacy refresh tokens use
	 * it to derive their absolute session end. */
	iat?: number;
	/** expiración, epoch en segundos */
	exp: number;
}

export const ACCESS_PREFIX = "ftmcp_";
export const REFRESH_PREFIX = "ftr_";
export const CODE_PREFIX = "ftc_";
export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 30 * 24 * 3600;
export const SESSION_TTL = 90 * 24 * 3600;
export const CODE_TTL = 300;
export const CLIENT_PREFIX = "ftcl_";
export const CLIENT_TTL = 10 * 365 * 24 * 3600;

/**
 * Callbacks of the MCP clients FreeTicket is used from. A client_id that is
 * not sealed (registered before ids were sealed, or after a secret rotation)
 * may only redirect to one of these exact URLs or to loopback. Exact URLs, not
 * hosts: some of these hosts run open redirectors on other paths. The consent
 * page warns about any destination that is not exactly one of these URLs.
 */
export const KNOWN_CALLBACKS = [
	"https://claude.ai/api/mcp/auth_callback",
	"https://claude.com/api/mcp/auth_callback",
	"https://chatgpt.com/connector_platform_oauth_redirect",
	"https://vscode.dev/redirect",
	"https://insiders.vscode.dev/redirect",
];
const MAX_REDIRECT_LENGTH = 2048;

export interface RedirectCheck {
	ok: boolean;
	/** client_name sealed at registration, when the client_id is sealed.
	 * Registration is open: this is whatever the registrant typed. */
	clientName?: string;
	host?: string;
	/** the redirect_uri, shown in full when it is not a known callback */
	uri?: string;
	/** true when the destination is neither loopback nor EXACTLY one of
	 * KNOWN_CALLBACKS. Compared by URL, not host: claude.ai/<other path> with a
	 * chosen client_name is how a phishing client would look like Claude. */
	unknownHost?: boolean;
}

/**
 * Validates a redirect_uri against the client that asks for it. Registration
 * is open (RFC 7591, stateless), so the client_id is the sealed list of its
 * redirect_uris: a redirect that was not registered with that id is refused,
 * and a legitimate client_id cannot be reused to send the code elsewhere.
 * Loopback is always allowed (RFC 8252: the port varies per run, and only the
 * user's own machine can receive it).
 */
export function checkRedirect(
	clientId: string,
	redirectUri: string,
	secret: string,
): RedirectCheck {
	let u: URL;
	try {
		u = new URL(redirectUri);
	} catch {
		return { ok: false };
	}
	// RFC 6749 §3.1.2: no fragment.
	if (redirectUri.length > MAX_REDIRECT_LENGTH || u.hash) return { ok: false };
	const loopback =
		(u.protocol === "http:" || u.protocol === "https:") &&
		(u.hostname === "localhost" || u.hostname === "127.0.0.1");
	if (u.protocol !== "https:" && !loopback) return { ok: false };
	const base = {
		host: u.host,
		uri: redirectUri,
		unknownHost: !loopback && !KNOWN_CALLBACKS.includes(redirectUri),
	};
	const client = open(clientId, secret, CLIENT_PREFIX);
	if (client)
		return {
			...base,
			ok: loopback || (client.rus ?? []).includes(redirectUri),
			clientName: client.n,
		};
	return { ...base, ok: loopback || KNOWN_CALLBACKS.includes(redirectUri) };
}

/** Respuesta de POST /auth/device/code de free-admin (contrato B2B). */
export interface DeviceStart {
	device_code: string;
	user_code: string;
	verification_uri_complete: string;
	interval: number;
	expires_in: number;
}

const keyFrom = (secret: string) =>
	createHash("sha256").update(secret).digest();

export function seal(payload: Sealed, secret: string, prefix: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
	const ct = Buffer.concat([
		cipher.update(JSON.stringify({ ...payload, t: prefix }), "utf8"),
		cipher.final(),
	]);
	return (
		prefix + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")
	);
}

/** Opens a sealed token. `null` when the prefix, signature or exp do not validate. */
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
		// A blob sealed as one type never opens as another. Untyped payloads
		// predate the field, and no client id was ever sealed without it.
		if (p.t !== undefined ? p.t !== prefix : prefix === CLIENT_PREFIX)
			return null;
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

/**
 * Session credentials from a sealed token. `a` (a pasted superadmin cookie,
 * sealed by versions before 0.24.0) is dropped on purpose: the admin layer no
 * longer comes through hosted OAuth.
 */
export function sealedToCreds(p: Sealed, apiUrl: string): Creds {
	return {
		apiUrl,
		apiKey: p.k || undefined,
		workspaceId: p.w || undefined,
		...(p.s === "read" ? { readOnly: true } : {}),
	};
}

/** OAuth scopes this server grants. `read` = only the read-only tools. */
export const SCOPES = ["b2b", "read"] as const;

/**
 * Whether a requested `scope` asks for a read-only connection. Only an
 * explicit `read` without `b2b` does: Claude requests every scope in
 * scopes_supported when it has no hint, and that must keep meaning read/write.
 */
export function wantsReadOnly(scope: string | null | undefined): boolean {
	const set = new Set((scope ?? "").split(/\s+/).filter(Boolean));
	return set.has("read") && !set.has("b2b");
}

/** The `scope` string a token response reports. */
export function grantedScope(p: Pick<Sealed, "s">): string {
	return p.s === "read" ? "read" : "b2b";
}

/** RFC 8414 metadata for the embedded authorization server. */
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
		scopes_supported: [...SCOPES],
	};
}

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * The consent page. Primary path: **login with the free-admin session** via
 * the device flow (RFC 8628, the same backend as `ft login`) — one
 * botón, cero keys. The flow starts only when the user clicks (POST
 * /device-start): free-admin caps pending device flows per IP and sees this
 * server's egress IP for everybody, so starting one on every GET /authorize let
 * a handful of anonymous page loads lock every user out. La página hace polling
 * a /device-token y redirige sola al cliente MCP. El form de credenciales
 * manuales queda como "Opciones avanzadas" (CI). Copy en español neutro.
 *
 * Diseño = tokens de free-admin (globals.css): amarillo #ffd500 sobre negro
 * #070707, muted #717182, borde #e0e0e0, radios 0.75rem card / 0.5rem botón,
 * dark mode with the same oklch values as the `.dark` theme.
 */
export function consentPage(
	params: URLSearchParams,
	opts: { error?: string; redirect?: RedirectCheck } = {},
): string {
	const { error, redirect } = opts;
	// Who gets the connection. Registration is open, so client_name alone proves
	// nothing: for a destination that is not exactly a known callback, the page
	// names the host and the full URL, and quotes the name as unverified.
	let target = "";
	if (redirect?.host && !redirect.unknownHost)
		target = `<div class="target">Vas a conectar <b>${esc(redirect.clientName || redirect.host)}</b>.<br>Al aprobar, volverás a <b>${esc(redirect.host)}</b>.</div>`;
	else if (redirect?.host)
		target = `<div class="target">Vas a conectar <b>${esc(redirect.host)}</b>.<br>Al aprobar, volverás a <code>${esc(redirect.uri ?? redirect.host)}</code>.${
			redirect.clientName
				? `<br><small>El cliente se identifica como “${esc(redirect.clientName)}”; ese nombre no está verificado.</small>`
				: ""
		}</div><div class="err">Ese destino no es un cliente conocido. Continúa solo si tú iniciaste esta conexión.</div>`;
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
	const manualForm = `
  <form method="post" action="/authorize">
    <p>Pega tus credenciales; se sellan dentro del token y este servidor no las almacena.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <label>API key B2B <small>(genera una con <code>ft login</code> o en el panel)</small></label>
    <input type="password" name="api_key" autocomplete="off">
    <label>Workspace ID <small>(opcional — solo si quieres atar esta conexión a un único workspace; en blanco los lee todos)</small></label>
    <input type="text" name="workspace_id" autocomplete="off">
    <label class="check"><input type="checkbox" name="read_only" value="1"${wantsReadOnly(params.get("scope")) ? " checked" : ""}> Solo lectura <small>(el asistente solo verá herramientas de consulta)</small></label>
    ${hidden}
    <button type="submit" class="secondary">Autorizar con credenciales</button>
  </form>`;
	const deviceSection = `
    <p>Se abrirá FreeTicket para que inicies sesión con tu cuenta de siempre y
    apruebes la conexión. Verifica que el código coincida:</p>
    <div class="code" id="code" hidden></div>
    <button type="button" id="go">Continuar con FreeTicket</button>
    <a class="btn" id="open" hidden target="_blank" rel="noopener">Abrir FreeTicket</a>
    <p class="status" id="status"></p>
    <noscript><p class="status bad">Activa JavaScript o usa Opciones avanzadas.</p></noscript>
    <details${error ? " open" : ""}><summary>Opciones avanzadas</summary>${manualForm}</details>
    <script>
    (() => {
      const cfg = ${JSON.stringify({
				ci: params.get("client_id") ?? "",
				ru: params.get("redirect_uri") ?? "",
				ch: params.get("code_challenge") ?? "",
				st: params.get("state") ?? "",
				sc: params.get("scope") ?? "",
				// `<` escaped: these come from the query string, and a raw
				// "</script>" in state or code_challenge would end this block.
			}).replace(/</g, "\\u003c")};
      const $ = (id) => document.getElementById(id);
      const status = $("status"), go = $("go"), code = $("code"), link = $("open");
      const say = (t, bad) => { status.textContent = t; status.classList.toggle("bad", !!bad); };
      let dc = "", iv = 5, deadline = 0;
      const post = (path, body) =>
        fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: cfg.ci, redirect_uri: cfg.ru, code_challenge: cfg.ch, state: cfg.st, scope: cfg.sc, ...body }),
        }).then((r) => r.json());
      const finish = (j) => {
        if (j.redirect) { say("Conectado. Volviendo…"); location.href = j.redirect; return true; }
        if (j.error) { say(j.error, true); return true; }
        return false;
      };
      const poll = async () => {
        if (Date.now() > deadline) { say("El código expiró. Recarga la página para reintentar.", true); return; }
        try {
          const j = await post("/device-token", { device_code: dc });
          if (finish(j)) return;
          if (j.slow) iv += 5;
        } catch {}
        setTimeout(poll, iv * 1000);
      };
      go.addEventListener("click", async () => {
        go.disabled = true;
        // Opened inside the click so popup blockers allow it; pointed at
        // FreeTicket once the flow exists.
        const w = window.open("", "_blank");
        say("Iniciando…");
        let d = null;
        try { d = await post("/device-start", {}); } catch {}
        if (!d || !d.verification_uri_complete) {
          if (w) w.close();
          go.disabled = false;
          say((d && d.error) || "No se pudo iniciar sesión con FreeTicket. Reintenta o usa Opciones avanzadas.", true);
          return;
        }
        code.textContent = d.user_code; code.hidden = false;
        link.href = d.verification_uri_complete; link.hidden = false;
        go.hidden = true;
        if (w) { w.opener = null; w.location.href = d.verification_uri_complete; }
        dc = d.device_code; iv = d.interval || 5;
        deadline = Date.now() + (d.expires_in || 600) * 1000;
        say("Esperando aprobación…");
        setTimeout(poll, iv * 1000);
      });
    })();
    </script>`;
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
  [hidden]{display:none!important}
  body{font-family:Inter,system-ui,-apple-system,sans-serif;background:var(--background);
    color:var(--foreground);display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem}
  .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);
    padding:2rem;width:min(420px,100%);box-shadow:0 1px 3px rgb(0 0 0 / .06)}
  .logo{width:44px;height:44px;border-radius:.6rem;display:block;margin-bottom:1rem}
  h1{font-size:1.25rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .35rem}
  p{color:var(--muted-foreground);font-size:.85rem;line-height:1.45;margin:.25rem 0 1rem}
  label{display:block;font-size:.8rem;font-weight:500;margin:.85rem 0 .3rem}
  label small{color:var(--muted-foreground);font-weight:400}
  label.check{display:flex;gap:.5rem;align-items:center;font-weight:400}
  code{font-family:ui-monospace,monospace;font-size:.75rem}
  input[type=text],input[type=password]{width:100%;background:var(--input-background);
    border:1px solid var(--border);border-radius:var(--radius-button);color:var(--foreground);
    padding:.6rem .7rem;font-size:.9rem;outline:none}
  input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgb(255 213 0 / .3)}
  button,.btn{margin-top:1.4rem;width:100%;padding:.7rem;border:0;border-radius:var(--radius-button);
    background:var(--primary);color:var(--primary-foreground);font:inherit;font-weight:600;
    font-size:.95rem;cursor:pointer;display:block;text-align:center;text-decoration:none}
  button:hover,.btn:hover{filter:brightness(.95)}
  button.secondary{background:var(--input-background);color:var(--foreground);border:1px solid var(--border)}
  .err{border:1px solid var(--destructive);color:var(--destructive);
    border-radius:var(--radius-button);padding:.6rem .7rem;font-size:.85rem;margin-bottom:.5rem}
  .code{font-family:ui-monospace,monospace;font-size:1.3rem;font-weight:600;letter-spacing:.15em;
    text-align:center;background:var(--input-background);border:1px dashed var(--border);
    border-radius:var(--radius-button);padding:.55rem;margin:.75rem 0 0}
  .target{font-size:.85rem;line-height:1.45;margin:.25rem 0 1rem}
  .status{text-align:center;margin-top:1rem}
  .status.bad{color:var(--destructive)}
  details{margin-top:1.5rem;border-top:1px solid var(--border);padding-top:.9rem}
  summary{font-size:.8rem;color:var(--muted-foreground);cursor:pointer}
  .foot{margin:1rem 0 0;font-size:.78rem}
</style></head><body>
  <div class="card">
    <img class="logo" src="/favicon.svg" alt="FreeTicket">
    <h1>Conectar FreeTicket</h1>
    ${target}
    ${deviceSection}
    <p class="foot">La conexión usa tus permisos de FreeTicket y puedes revocarla cerrando sesión en el panel.</p>
  </div>
</body></html>`;
}
