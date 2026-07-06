import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	getAuditLog,
	getMe,
	getUsers,
	getWorkspaces,
} from "../admin-client/sdk.gen";
import { run } from "../api";

/**
 * Tools superadmin (/api/admin, cross-tenant), read-only. Se registran solo si
 * hay FT_ADMIN_SESSION. Writes (suspend/restore/patch, impersonate, flags) = Ola C.
 */
export function registerAdminTools(server: McpServer): void {
	server.tool(
		"admin_whoami",
		"Identidad del superadmin de la sesión activa (GET /api/admin/me).",
		async () => run(getMe({})),
	);

	server.tool(
		"admin_workspaces",
		"Lista tenants/workspaces cross-tenant (GET /api/admin/workspaces).",
		{
			q: z.string().optional().describe("Buscar por nombre/slug"),
			status: z.string().optional().describe("Filtrar por estado"),
			limit: z.string().optional().describe("Resultados por página (1-100)"),
			cursor: z.string().optional().describe("Cursor de paginación"),
		},
		async (q) => run(getWorkspaces({ query: q })),
	);

	server.tool(
		"admin_users",
		"Lista usuarios globales cross-tenant (GET /api/admin/users).",
		{
			q: z.string().optional().describe("Buscar por nombre/email"),
			role: z.string().optional().describe("Filtrar por rol"),
			limit: z.string().optional(),
			cursor: z.string().optional(),
		},
		async (q) => run(getUsers({ query: q })),
	);

	server.tool(
		"admin_audit_log",
		"Registro de auditoría del superadmin (GET /api/admin/audit-log).",
		{
			action: z.string().optional().describe("Filtrar por acción"),
			from: z.string().optional().describe("Desde (ISO 8601)"),
			to: z.string().optional().describe("Hasta (ISO 8601)"),
			limit: z.string().optional(),
			cursor: z.string().optional(),
		},
		async (q) => run(getAuditLog({ query: q })),
	);
}
