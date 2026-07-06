#!/usr/bin/env node
/**
 * FreeTicket MCP server (stdio).
 *
 * Expone el dominio B2B de FreeTicket (/api/v1) como tools MCP sobre el cliente
 * generado del contrato (src/client/). Mismo contrato y misma sesión que el CLI
 * `ft`: si hiciste `ft login`, el MCP ya está autenticado.
 *
 * Config (env > ~/.freeticket/config.json > default):
 *   FT_API_URL        base de la API (default https://admin.appfreeticket.com)
 *   FT_API_KEY        credencial B2B (o la sesión guardada por `ft login`)
 *   FT_WORKSPACE_ID   workspace activo (header X-Workspace-Id)
 *   FT_ADMIN_SESSION  sesión SUPER_ADMIN — habilita los tools admin_* (/api/admin)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ADMIN_SESSION, API_KEY, configureClients } from "./api";
import { registerAdminTools } from "./tools/admin";
import { registerB2bTools } from "./tools/b2b";

if (!API_KEY) {
	process.stderr.write(
		"FreeTicket MCP: no hay credencial. Corre `ft login` (o exporta FT_API_KEY).\n",
	);
	process.exit(1);
}

configureClients();

const server = new McpServer({ name: "freeticket", version: "0.3.0" });
registerB2bTools(server);
if (ADMIN_SESSION) registerAdminTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
