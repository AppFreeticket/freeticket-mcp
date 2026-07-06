import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { client as adminClient } from "./admin-client/client.gen";
import { client } from "./client/client.gen";

/**
 * Config compartida con el CLI `ft`: env > ~/.freeticket/config.json > default.
 * Así `ft login` (device flow del browser) también autentica el MCP y nadie
 * tiene que pegar una API key a mano.
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

const stored = cliConfig();

// Acepta FT_API_URL con o sin /api/v1 (versiones viejas lo incluían).
export const API_URL = (
	process.env.FT_API_URL ??
	stored.apiUrl ??
	"https://admin.appfreeticket.com"
)
	.replace(/\/$/, "")
	.replace(/\/api\/v1$/, "");
export const API_KEY = process.env.FT_API_KEY ?? stored.apiKey;
export const WORKSPACE_ID = process.env.FT_WORKSPACE_ID ?? stored.workspaceId;
export const ADMIN_SESSION = process.env.FT_ADMIN_SESSION;

/** Configura los singletons generados. B2B y admin nunca comparten auth. */
export function configureClients(): void {
	client.setConfig({
		baseUrl: `${API_URL}/api/v1`,
		headers: {
			Authorization: `Bearer ${API_KEY}`,
			...(WORKSPACE_ID ? { "X-Workspace-Id": WORKSPACE_ID } : {}),
		},
	});
	if (ADMIN_SESSION) {
		adminClient.setConfig({
			baseUrl: process.env.FT_ADMIN_API_URL ?? `${API_URL}/api/admin`,
			headers: { Cookie: `better-auth.session_token=${ADMIN_SESSION}` },
		});
	}
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
