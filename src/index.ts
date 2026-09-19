#!/usr/bin/env node
/**
 * FreeTicket MCP server (stdio).
 *
 * Exposes FreeTicket's B2B domain (/api/v1) and superadmin (/api/admin) as MCP
 * tools over the clients generated from the contract. Same session as the `ft`
 * CLI: if you have run `ft login`, the MCP is already authenticated.
 *
 * Config (env > ~/.freeticket/config.json > default):
 *   FT_API_URL        API base (default https://admin.appfreeticket.com)
 *   FT_API_KEY        B2B credential (or the session saved by `ft login`)
 *   FT_WORKSPACE_ID   pin every call to one workspace (X-Workspace-Id header);
 *                     unset, the reads widen to every workspace the key reaches
 *   FT_ADMIN_SESSION  SUPER_ADMIN session — enables the admin_* tools (/api/admin)
 *
 * For the remote HTTP server (claude.ai, connectors), see `src/http.ts`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { credsFromEnv } from "./api";
import { buildServer } from "./server";

const creds = credsFromEnv();
if (!creds.apiKey) {
	// No credential is not an error: the public B2C tools remain. For the
	// B2B and admin tools, run `ft login` (or export FT_API_KEY).
	process.stderr.write(
		"FreeTicket MCP: no credential — anonymous mode (public B2C tools only). " +
			"Run `ft login` for the B2B tools.\n",
	);
}

const server = buildServer(creds);
const transport = new StdioServerTransport();
await server.connect(transport);
