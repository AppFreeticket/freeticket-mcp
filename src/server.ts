import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type Creds,
	makeAdminClient,
	makeB2bClient,
	makePublicClient,
} from "./api";
import { registerAdminTools } from "./tools/admin";
import { registerB2bTools } from "./tools/b2b";
import { registerB2bWriteTools } from "./tools/b2b-writes";
import { registerPublicTools } from "./tools/public";

export const VERSION = "0.10.0";

/**
 * Construye un McpServer aislado para una sesión. Cada sesión trae sus propios
 * clients — no hay estado global compartido, así el mismo binario sirve a varios
 * tenants por HTTP sin cruzar credenciales.
 *
 * Capas por nivel de credencial:
 *  - public_* (B2C): SIEMPRE — anónimo, no necesita API key.
 *  - B2B: solo si la sesión trae `apiKey`.
 *  - admin_*: solo si trae `adminSession`.
 */
export function buildServer(creds: Creds): McpServer {
	const server = new McpServer({ name: "freeticket", version: VERSION });

	// B2C público: sin credenciales, siempre disponible.
	registerPublicTools(server, makePublicClient(creds.apiUrl));

	if (creds.apiKey) {
		const client = makeB2bClient(creds);
		registerB2bTools(server, client);
		registerB2bWriteTools(server, client);
	}
	if (creds.adminSession) {
		registerAdminTools(server, makeAdminClient(creds));
	}
	return server;
}
