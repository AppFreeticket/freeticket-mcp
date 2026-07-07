import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Creds, makeAdminClient, makeB2bClient } from "./api";
import { registerAdminTools } from "./tools/admin";
import { registerB2bTools } from "./tools/b2b";
import { registerB2bWriteTools } from "./tools/b2b-writes";

export const VERSION = "0.6.0";

/**
 * Construye un McpServer aislado para una sesión. Cada sesión trae sus propios
 * clients (B2B + admin) — no hay estado global compartido, así el mismo binario
 * sirve a varios tenants por HTTP sin cruzar credenciales.
 *
 * Los tools admin_* solo se registran si la sesión trae `adminSession`.
 */
export function buildServer(creds: Creds): McpServer {
	const server = new McpServer({ name: "freeticket", version: VERSION });
	const client = makeB2bClient(creds);
	registerB2bTools(server, client);
	registerB2bWriteTools(server, client);
	if (creds.adminSession) {
		registerAdminTools(server, makeAdminClient(creds));
	}
	return server;
}
