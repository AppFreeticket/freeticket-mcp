import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Client, createClient, createConfig } from "@hey-api/client-fetch";

/**
 * Credenciales de una sesión. En stdio salen de env/config; en HTTP remoto salen
 * del request (nunca del disco) — por eso los clients se construyen por sesión y
 * no hay singleton global compartido entre tenants.
 */
export interface Creds {
	apiUrl: string;
	// Ausente = sesión anónima: solo los tools públicos B2C (public_*). Con key
	// se suman los tools B2B; con adminSession, los admin_*.
	apiKey?: string;
	workspaceId?: string;
	adminSession?: string;
	adminApiUrl?: string;
}

/**
 * Config compartida con el CLI `ft`: env > ~/.freeticket/config.json > default.
 * Así `ft login` (device flow del browser) también autentica el MCP en stdio.
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

/** Normaliza la base: acepta FT_API_URL con o sin /api/v1 (versiones viejas). */
export function normalizeApiUrl(raw: string): string {
	return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

/**
 * Credenciales para el entrypoint stdio (local). Siempre devuelve algo: sin
 * FT_API_KEY el server arranca en modo anónimo (solo tools públicos B2C).
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

/** Client B2B aislado para una sesión (Bearer + workspace). */
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

/** Client público B2C aislado (sin auth). Catálogo + checkout anónimo. */
export function makePublicClient(apiUrl: string): Client {
	return createClient(createConfig({ baseUrl: `${apiUrl}/api/public` }));
}

/** Client superadmin aislado (cookie de sesión SUPER_ADMIN). Nunca comparte auth. */
export function makeAdminClient(c: Creds): Client {
	return createClient(
		createConfig({
			baseUrl: c.adminApiUrl ?? `${c.apiUrl}/api/admin`,
			headers: { Cookie: `better-auth.session_token=${c.adminSession}` },
		}),
	);
}

type SdkResult = { data?: unknown; error?: unknown };

/**
 * Resultado MCP desde una llamada del SDK generado: data o error del envelope.
 *
 * Va siempre con `structuredContent` además del texto: es lo que consume el
 * view de MCP Apps (src/ui.ts) para dibujar tabla/KPIs. Se envuelve en `{ data }`
 * porque la spec exige que structuredContent sea un objeto, y un listado
 * devuelve un array. El texto queda igual para los hosts sin extensión de UI.
 */
export async function run(p: Promise<SdkResult>): Promise<{
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown };
	isError?: boolean;
}> {
	const r = await p;
	if (r.error !== undefined) {
		return {
			isError: true,
			content: [{ type: "text", text: JSON.stringify(r.error, null, 2) }],
		};
	}
	return {
		content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }],
		structuredContent: { data: unwrapEnvelope(r.data) },
	};
}

/** `{ data, page }` → `data`. El view quiere las filas, no el sobre. */
function unwrapEnvelope(d: unknown): unknown {
	if (d && typeof d === "object" && "data" in d)
		return (d as { data: unknown }).data;
	return d;
}
