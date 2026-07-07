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
	apiKey: string;
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

/** Credenciales para el entrypoint stdio (local, un solo tenant). */
export function credsFromEnv(): Creds | null {
	const stored = cliConfig();
	const apiKey = process.env.FT_API_KEY ?? stored.apiKey;
	if (!apiKey) return null;
	return {
		apiUrl: normalizeApiUrl(
			process.env.FT_API_URL ??
				stored.apiUrl ??
				"https://admin.appfreeticket.com",
		),
		apiKey,
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

/** Resultado MCP desde una llamada del SDK generado: data o error del envelope. */
export async function run(p: Promise<SdkResult>): Promise<{
	content: { type: "text"; text: string }[];
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
	};
}
