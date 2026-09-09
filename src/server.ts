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
import { registerUi } from "./ui";

export const VERSION = "0.14.0";

/**
 * Builds an isolated McpServer for one session. Every session carries its own
 * clients — there is no shared global state, so the same binary serves many
 * tenants over HTTP without crossing credentials.
 *
 * Layers by credential level:
 *  - public_* (B2C): ALWAYS — anonymous, needs no API key.
 *  - B2B: only when the session carries an `apiKey`.
 *  - admin_*: only when it carries an `adminSession`.
 */
export function buildServer(creds: Creds): McpServer {
	const server = new McpServer({ name: "freeticket", version: VERSION });

	// The MCP Apps view. Always registered: the tools that use it point at it
	// through `_meta.ui.resourceUri`, and a host without the extension just
	// never asks for it.
	registerUi(server);

	// Public B2C: no credentials, always available.
	registerPublicTools(server, makePublicClient(creds.apiUrl));

	if (creds.apiKey) {
		const client = makeB2bClient(creds);
		registerB2bTools(server, client, creds);
		registerB2bWriteTools(server, client);
	}
	if (creds.adminSession) {
		registerAdminTools(server, makeAdminClient(creds));
	}
	return server;
}
