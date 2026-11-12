import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Client, createClient, createConfig } from "@hey-api/client-fetch";

/**
 * Credentials for one session. Over stdio they come from env and config; over
 * remote HTTP they come from the request (never from disk) — which is why the
 * clients are built per session and
 * no hay singleton global compartido entre tenants.
 */
export interface Creds {
	apiUrl: string;
	// Absent = anonymous session: the public B2C tools only (public_*). With a
	// key the B2B tools are added; with an adminSession, the admin_* ones.
	apiKey?: string;
	workspaceId?: string;
	adminSession?: string;
	adminApiUrl?: string;
}

/**
 * Config shared with the `ft` CLI: env > ~/.freeticket/config.json > default.
 * That way `ft login` (the browser device flow) also authenticates the MCP over
 * stdio.
 */
function cliConfig(): {
	apiUrl?: string;
	apiKey?: string;
	workspaceId?: string;
} {
	try {
		return JSON.parse(
			readFileSync(join(homedir(), ".freeticket", "config.json"), "utf8"),
		);
	} catch {
		return {};
	}
}

/** Normalizes the base: accepts FT_API_URL with or without /api/v1 (older versions). */
export function normalizeApiUrl(raw: string): string {
	return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

/**
 * Credentials for the stdio entrypoint (local). It always returns something:
 * without FT_API_KEY the server starts in anonymous mode (public B2C tools only).
 */
export function credsFromEnv(): Creds {
	const stored = cliConfig();
	return {
		apiUrl: normalizeApiUrl(
			process.env.FT_API_URL ??
				stored.apiUrl ??
				"https://admin.appfreeticket.com",
		),
		apiKey: process.env.FT_API_KEY ?? stored.apiKey,
		workspaceId: process.env.FT_WORKSPACE_ID ?? stored.workspaceId,
		adminSession: process.env.FT_ADMIN_SESSION,
		adminApiUrl: process.env.FT_ADMIN_API_URL,
	};
}

/** Isolated B2B client for one session (Bearer + workspace). */
export function makeB2bClient(c: Creds): Client {
	return createClient(
		createConfig({
			baseUrl: `${c.apiUrl}/api/v1`,
			headers: {
				Authorization: `Bearer ${c.apiKey}`,
				...(c.workspaceId ? { "X-Workspace-Id": c.workspaceId } : {}),
			},
		}),
	);
}

/** Isolated public B2C client (no auth). Catalogue plus anonymous checkout. */
export function makePublicClient(apiUrl: string): Client {
	return createClient(createConfig({ baseUrl: `${apiUrl}/api/public` }));
}

/** Isolated superadmin client (SUPER_ADMIN session cookie). It never shares auth. */
export function makeAdminClient(c: Creds): Client {
	return createClient(
		createConfig({
			baseUrl: c.adminApiUrl ?? `${c.apiUrl}/api/admin`,
			headers: { Cookie: `better-auth.session_token=${c.adminSession}` },
		}),
	);
}

/** The CallToolResult shape every tool here returns. */
export interface ToolResult {
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown; truncated?: TruncationNote };
	isError?: boolean;
	// The SDK's callback type carries an index signature.
	[key: string]: unknown;
}

/**
 * Budget for the text a tool hands the model, in characters (~6k tokens).
 * Above it the largest list in the payload is cut by whole items and a
 * `truncated` note says how many were shown and how to get the rest. One
 * constant on purpose: it is the knob, not a per-tool setting.
 */
export const MAX_TEXT_CHARS = 25_000;

/** Note appended to a payload that went over `MAX_TEXT_CHARS`. */
export interface TruncationNote {
	shown: number;
	total: number;
	field: string;
	hint: string;
}

/** How deep `largestArray` looks for a list inside nested objects. */
const MAX_LIST_DEPTH = 4;

type ListPath = { path: string[]; items: unknown[] };

/**
 * Every non-empty array reachable through plain objects (not through other
 * arrays), up to `MAX_LIST_DEPTH` levels: `{ data: [...] }`,
 * `{ data: { events: [...] } }`, a bare array (path `[]`).
 */
function arrays(payload: unknown, path: string[] = []): ListPath[] {
	if (Array.isArray(payload))
		return payload.length ? [{ path, items: payload }] : [];
	if (!payload || typeof payload !== "object" || path.length >= MAX_LIST_DEPTH)
		return [];
	return Object.entries(payload).flatMap(([k, v]) => arrays(v, [...path, k]));
}

/**
 * The lists worth cutting, in the order to try them: the primary list first
 * (top-level `data` when it is an array — the `{ data, page }` envelope and
 * the fan-out's `{ data, errors }`, so a long `errors` never wins over the
 * rows), then the heaviest array at any depth.
 */
function cutCandidates(payload: unknown): ListPath[] {
	const all = arrays(payload);
	const primary = all.find((a) => a.path.length === 1 && a.path[0] === "data");
	const heaviest = all
		.map((a) => ({ a, size: JSON.stringify(a.items).length }))
		.sort((x, y) => y.size - x.size)[0]?.a;
	return [primary, heaviest].filter(
		(a, i, xs): a is ListPath => !!a && xs.indexOf(a) === i,
	);
}

/** Immutably replaces the array at `path` (`[]` = the payload itself). */
function setAt(node: unknown, path: string[], items: unknown[]): unknown {
	if (path.length === 0) return items;
	const [head, ...rest] = path;
	const obj = node as Record<string, unknown>;
	return { ...obj, [head]: setAt(obj[head], rest, items) };
}

function withItems(
	payload: unknown,
	path: string[],
	items: unknown[],
	note: TruncationNote,
	paginated: boolean,
): unknown {
	if (path.length === 0) return { data: items, truncated: note };
	const out = setAt(payload, path, items) as Record<string, unknown>;
	// The API's nextCursor points past the END of the full page: following it
	// would silently skip the rows that were cut. Drop it and keep hasMore
	// true; the hint says how to get an exact cursor (same call, smaller limit).
	if (paginated)
		out.page = {
			...(out.page as object),
			nextCursor: null,
			hasMore: true,
		};
	return { ...out, truncated: note };
}

/** Cuts to at most `room` UTF-16 units without splitting a surrogate pair. */
export function sliceCodePoints(s: string, room: number): string {
	let out = s.slice(0, Math.max(0, room));
	const last = out.charCodeAt(out.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
	return out;
}

/** A fixed recovery hint, or one built from how many items fit. */
export type Hint = string | ((shown: number, total: number) => string);

/**
 * Serializes the payload as compact JSON, never above `max` chars. Always
 * valid JSON: it cuts whole array items (binary search on how many fit), and
 * if not even that is enough it falls back to a string preview inside a valid
 * object. `hint` overrides the default recovery hint (the fan-out has no
 * cursor, for instance).
 */
export function capJson(
	payload: unknown,
	opts: { max?: number; hint?: Hint } = {},
): { text: string; payload: unknown; truncated?: TruncationNote } {
	const max = opts.max ?? MAX_TEXT_CHARS;
	const text = JSON.stringify(payload) ?? "null";
	if (text.length <= max) return { text, payload };

	const candidates = cutCandidates(payload);
	const paginated =
		!!payload &&
		!Array.isArray(payload) &&
		typeof payload === "object" &&
		(payload as { page?: unknown }).page != null &&
		typeof (payload as { page?: unknown }).page === "object";
	const note = (
		list: ListPath,
		shown: number,
		total: number,
	): TruncationNote => ({
		shown,
		total,
		field: list.path.length ? list.path.join(".") : "data",
		hint:
			typeof opts.hint === "function"
				? opts.hint(shown, total)
				: (opts.hint ??
					(paginated
						? `Respuesta recortada a ${shown} de ${total} ítems (tope ~${max} caracteres); page.nextCursor se anuló porque saltaría las filas recortadas. Para seguir sin perder filas: repite esta misma llamada con el mismo \`cursor\` que usaste (ninguno si era la primera página) y \`limit: ${Math.max(1, shown)}\`; esa respuesta trae el page.nextCursor exacto para continuar. O acota con los filtros del tool.`
						: `Respuesta recortada a ${shown} de ${total} ítems (tope ~${max} caracteres). Este tool no pagina: acota con sus filtros (evento, fecha, rango from/to, estado) para traer menos filas.`)),
	});

	for (const list of candidates) {
		const total = list.items.length;
		let lo = 1;
		let hi = total - 1;
		let best: { text: string; payload: unknown; note: TruncationNote } | null =
			null;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const n = note(list, mid, total);
			const candidate = withItems(
				payload,
				list.path,
				list.items.slice(0, mid),
				n,
				paginated,
			);
			const t = JSON.stringify(candidate);
			if (t.length <= max) {
				best = { text: t, payload: candidate, note: n };
				lo = mid + 1;
			} else hi = mid - 1;
		}
		if (best)
			return { text: best.text, payload: best.payload, truncated: best.note };
	}

	// No list to cut, or one single item already over budget.
	const list = candidates[0];
	const n: TruncationNote = {
		shown: 0,
		total: list?.items.length ?? 1,
		field: list?.path.length ? list.path.join(".") : "data",
		hint:
			typeof opts.hint === "string"
				? opts.hint
				: `Respuesta demasiado grande (${text.length} caracteres, tope ~${max}). Se muestra solo el comienzo como texto: pide un recurso puntual (*_get) o acota con filtros.`,
	};
	const shell = { truncated: n, preview: "" };
	// Escaping (quotes, backslashes, control chars) can grow the preview once
	// serialized: shrink by the overflow until it fits.
	let room = Math.max(0, max - JSON.stringify(shell).length);
	let out = shell;
	let serialized = JSON.stringify(shell);
	while (room > 0) {
		out = { ...shell, preview: sliceCodePoints(text, room) };
		serialized = JSON.stringify(out);
		if (serialized.length <= max) break;
		room -= Math.max(1, serialized.length - max);
	}
	return { text: serialized, payload: out, truncated: n };
}

/** A success result: compact, capped text. No structuredContent here — see `withStructured`. */
export function okResult(payload: unknown, opts?: { hint?: Hint }): ToolResult {
	return { content: [{ type: "text", text: capJson(payload, opts).text }] };
}

/**
 * Adds `structuredContent` (what the MCP Apps view in src/ui.ts reads) to a
 * result, parsed back from its own capped text. Only the tools with a view get
 * it: the extension keeps structuredContent out of the model's context, but a
 * host without the extension may not, so the rest of the tools ship the text
 * only and the payload is never sent twice to the model. Wrapped in `{ data }`
 * because the spec requires an object and a list is an array.
 */
export function withStructured(r: ToolResult): ToolResult {
	if (r.isError || r.structuredContent !== undefined) return r;
	const text = r.content.find((c) => c.type === "text")?.text;
	if (text === undefined) return r;
	try {
		const parsed = JSON.parse(text) as unknown;
		const truncated =
			parsed && typeof parsed === "object" && "truncated" in parsed
				? (parsed as { truncated: TruncationNote }).truncated
				: undefined;
		// The preview fallback is a string cut of the JSON, not data: the view
		// shows it as text, next to the note.
		const data =
			truncated && "preview" in (parsed as object)
				? (parsed as { preview: string }).preview
				: unwrapEnvelope(parsed);
		return {
			...r,
			structuredContent: truncated ? { data, truncated } : { data },
		};
	} catch {
		return r;
	}
}

// ── Errors ─────────────────────────────────────────────────────────────────

type ApiErrorBody = {
	error?: {
		code?: string;
		message?: string;
		retryable?: boolean;
		details?: unknown;
	};
};

/** Field errors from a validation `details` (zod issues or `{ field: msg }`). */
function fieldErrors(details: unknown): string[] {
	if (Array.isArray(details)) {
		return details
			.map((d) => {
				if (!d || typeof d !== "object") return String(d);
				const o = d as { path?: unknown; field?: unknown; message?: unknown };
				const where = Array.isArray(o.path)
					? o.path.join(".")
					: (o.field ?? o.path ?? "");
				return where ? `${where}: ${o.message ?? ""}` : String(o.message ?? "");
			})
			.filter(Boolean);
	}
	if (details && typeof details === "object") {
		return Object.entries(details as Record<string, unknown>).map(
			([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`,
		);
	}
	return [];
}

/**
 * Recovery hint per HTTP status: what the agent should do next instead of
 * retrying blindly. `retryable` comes from the server's envelope when present
 * (free-admin's source of truth, src/lib/api/http.ts); the status table is the
 * fallback for bodies without it.
 */
export function recoveryHint(
	status: number | undefined,
	body: ApiErrorBody,
	retryAfter?: number,
): { hint: string; retryable: boolean } {
	const details = body.error?.details as
		| { activeWorkspaceId?: string; activeWorkspaceName?: string }
		| undefined;
	if (status === undefined)
		return {
			retryable: true,
			hint: "Fallo de red (DNS, timeout o TLS) antes de recibir respuesta. Es transitorio: reintenta en unos segundos.",
		};
	if (status === 401)
		return {
			retryable: false,
			hint: "Credencial inválida o vencida. Vuelve a autenticar (`ft login`, o reconecta el servidor MCP para repetir el login) o revisa FT_API_KEY. Reintentar igual no sirve.",
		};
	if (status === 403) {
		const ws =
			details?.activeWorkspaceName || details?.activeWorkspaceId
				? ` Workspace activo: ${details.activeWorkspaceName ?? ""}${details.activeWorkspaceId ? ` (${details.activeWorkspaceId})` : ""}.`
				: "";
		return {
			retryable: false,
			hint: `Sin permiso: la API key puede ser de solo lectura (scope) o tu rol en ese workspace no alcanza.${ws} Revisa con \`whoami\` a qué workspaces llegas y con qué rol; si el recurso es de otro, repite con \`workspace\`.`,
		};
	}
	if (status === 404)
		return {
			retryable: false,
			hint: "No existe con ese id en este workspace. Revisa el id: búscalo con el tool *_list del recurso (p. ej. `sales_list`, `events_list`), o con `workspace` si vive en otro workspace.",
		};
	if (status === 409)
		return {
			retryable: false,
			hint: "Conflicto con el estado actual (ya existe, ya se procesó o cambió mientras tanto). Relee el recurso con su *_get antes de decidir; no repitas la escritura a ciegas.",
		};
	if (status === 400 || status === 422) {
		const fields = fieldErrors(body.error?.details);
		return {
			retryable: false,
			hint: fields.length
				? `Validación fallida. Corrige estos campos y repite: ${fields.join("; ")}.`
				: `Validación fallida: ${body.error?.message ?? "revisa los parámetros"}. Corrige y repite.`,
		};
	}
	if (status === 429)
		return {
			retryable: true,
			hint: `Límite de tasa alcanzado. Espera ${retryAfter ?? 30} s y reintenta la misma llamada.`,
		};
	if (status >= 500)
		return {
			retryable: body.error?.retryable ?? true,
			hint: "Error del servidor de FreeTicket (transitorio). Reintenta en unos segundos; si persiste, repórtalo con la hora y el tool usado.",
		};
	return {
		retryable: body.error?.retryable ?? false,
		hint: body.error?.message ?? `HTTP ${status}`,
	};
}

function parseRetryAfter(h: string | null | undefined): number | undefined {
	if (!h) return undefined;
	const n = Number(h);
	if (Number.isFinite(n)) return Math.max(1, Math.ceil(n));
	const at = Date.parse(h);
	return Number.isNaN(at)
		? undefined
		: Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

/**
 * The isError result: the API's envelope as-is (so `error.code` is still there
 * to branch on), plus `status`, `retryable`, `retryAfterSeconds` and `hint`.
 */
export function errorResult(
	status: number | undefined,
	raw: unknown,
	retryAfterHeader?: string | null,
): ToolResult {
	const body: ApiErrorBody =
		raw && typeof raw === "object" && "error" in raw
			? (raw as ApiErrorBody)
			: {
					error: {
						code: status === undefined ? "network_error" : `HTTP_${status}`,
						message:
							typeof raw === "string" ? raw.slice(0, 500) : JSON.stringify(raw),
					},
				};
	const err =
		body.error && typeof body.error === "object"
			? body.error
			: { code: String(body.error) };
	const retryAfterSeconds = parseRetryAfter(retryAfterHeader);
	const { hint, retryable } = recoveryHint(status, body, retryAfterSeconds);
	const payload = {
		error: {
			...err,
			retryable: err.retryable ?? retryable,
			...(status === undefined ? {} : { status }),
			...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
			hint,
		},
	};
	return {
		isError: true,
		content: [{ type: "text", text: capJson(payload).text }],
	};
}

/**
 * A raw `fetch` Response that failed (no generated client in between, e.g.
 * the 302 signed downloads): same mapping as `run()`.
 */
export async function httpErrorResult(res: Response): Promise<ToolResult> {
	const text = await res.text().catch(() => "");
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return errorResult(res.status, body, res.headers.get("retry-after"));
}

type SdkResult = { data?: unknown; error?: unknown; response?: Response };

/**
 * An MCP result from a generated SDK call: the envelope's data as compact,
 * capped JSON — or its error with a recovery hint.
 */
export async function run(p: Promise<SdkResult>): Promise<ToolResult> {
	// @hey-api/client-fetch only populates `r.error` when there WAS an HTTP
	// response. A transport failure (DNS, timeout, TLS, abort) rejects the
	// promise; without this catch the agent saw a different shape for the same
	// failure and could not branch on a code (issue #12).
	let r: SdkResult;
	try {
		r = await p;
	} catch (e) {
		return errorResult(undefined, {
			error: {
				code: "network_error",
				message: e instanceof Error ? e.message : String(e),
				retryable: true,
			},
		});
	}
	if (r.error !== undefined)
		return errorResult(
			r.response?.status,
			r.error,
			r.response?.headers?.get("retry-after"),
		);
	return okResult(r.data);
}

/** `{ data, page }` → `data`. The view wants the rows, not the envelope. */
function unwrapEnvelope(d: unknown): unknown {
	if (d && typeof d === "object" && "data" in d)
		return (d as { data: unknown }).data;
	return d;
}
