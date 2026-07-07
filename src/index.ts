#!/usr/bin/env node
/**
 * FreeTicket MCP server (stdio).
 *
 * Expone el dominio B2B de FreeTicket (/api/v1) + superadmin (/api/admin) como
 * tools MCP sobre los clientes generados del contrato. Misma sesión que el CLI
 * `ft`: si hiciste `ft login`, el MCP ya está autenticado.
 *
 * Config (env > ~/.freeticket/config.json > default):
 *   FT_API_URL        base de la API (default https://admin.appfreeticket.com)
 *   FT_API_KEY        credencial B2B (o la sesión guardada por `ft login`)
 *   FT_WORKSPACE_ID   workspace activo (header X-Workspace-Id)
 *   FT_ADMIN_SESSION  sesión SUPER_ADMIN — habilita los tools admin_* (/api/admin)
 *
 * Para el server remoto HTTP (claude.ai, connectors), ver `src/http.ts`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { credsFromEnv } from "./api";
import { buildServer } from "./server";

const creds = credsFromEnv();
if (!creds) {
	process.stderr.write(
		"FreeTicket MCP: no hay credencial. Corre `ft login` (o exporta FT_API_KEY).\n",
	);
	process.exit(1);
}

const server = buildServer(creds);
const transport = new StdioServerTransport();
await server.connect(transport);
