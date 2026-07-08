import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	getAuditLog,
	getFeatureFlags,
	getMe,
	getPlatformPlans,
	getPlatformPlansId,
	getUsers,
	getUsersId,
	getWorkspaces,
	getWorkspacesId,
	patchPlatformPlansId,
	patchUsersId,
	patchWorkspacesId,
	postImpersonate,
	postImpersonateStop,
	postPlatformPlans,
	postWorkspaces,
	postWorkspacesIdRestore,
	postWorkspacesIdSuspend,
	putFeatureFlagsKey,
} from "../admin-client/sdk.gen";
import { run } from "../api";

const destructive = { destructiveHint: true, idempotentHint: false } as const;
const mutating = { destructiveHint: false, idempotentHint: false } as const;
const CONFIRM = " ⚠️ Acción sensible cross-tenant: confirmá con el humano.";

/**
 * Tools superadmin (/api/admin, cross-tenant). Se registran solo si hay
 * FT_ADMIN_SESSION. Cubre reads + writes (Ola C): workspaces, users,
 * impersonation, platform plans y feature flags.
 */
export function registerAdminTools(server: McpServer, client: Client): void {
	server.tool(
		"admin_whoami",
		"Identidad del superadmin de la sesión activa (GET /api/admin/me).",
		async () => run(getMe({ client })),
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
		async (q) => run(getWorkspaces({ query: q, client })),
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
		async (q) => run(getUsers({ query: q, client })),
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
		async (q) => run(getAuditLog({ query: q, client })),
	);

	// ── Workspaces ───────────────────────────────────────────────────────────
	server.tool(
		"admin_workspaces_get",
		"Detalle de un workspace/tenant (GET /api/admin/workspaces/{id}).",
		{ id: z.string().describe("Id del workspace") },
		async ({ id }) => run(getWorkspacesId({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_create",
		"Crea un workspace/tenant (POST /api/admin/workspaces).",
		{
			name: z.string(),
			slug: z.string().describe("Slug único"),
			type: z.enum(["ARTIST", "VENUE", "ORGANIZER"]),
			country: z.string(),
			email: z.string().email().optional().describe("Email del owner"),
		},
		mutating,
		async (body) => run(postWorkspaces({ body, client })),
	);
	server.tool(
		"admin_workspaces_update",
		"Actualiza un workspace/tenant (PATCH /api/admin/workspaces/{id}).",
		{
			id: z.string().describe("Id del workspace"),
			name: z.string().optional(),
			slug: z.string().optional(),
			type: z.enum(["ARTIST", "VENUE", "ORGANIZER"]).optional(),
			isPublished: z.boolean().optional(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchWorkspacesId({ path: { id }, body, client })),
	);
	server.tool(
		"admin_workspaces_suspend",
		`Suspende un workspace/tenant (POST /api/admin/workspaces/{id}/suspend).${CONFIRM}`,
		{ id: z.string().describe("Id del workspace") },
		destructive,
		async ({ id }) => run(postWorkspacesIdSuspend({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_restore",
		"Restaura un workspace suspendido (POST /api/admin/workspaces/{id}/restore).",
		{ id: z.string().describe("Id del workspace") },
		mutating,
		async ({ id }) => run(postWorkspacesIdRestore({ path: { id }, client })),
	);

	// ── Users e impersonation ────────────────────────────────────────────────
	server.tool(
		"admin_users_get",
		"Detalle de un usuario global (GET /api/admin/users/{id}).",
		{ id: z.string().describe("Id del usuario") },
		async ({ id }) => run(getUsersId({ path: { id }, client })),
	);
	server.tool(
		"admin_users_update",
		"Actualiza rol o baneo de un usuario (PATCH /api/admin/users/{id}).",
		{
			id: z.string().describe("Id del usuario"),
			role: z
				.enum(["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER", "MINCULTURA"])
				.optional(),
			banned: z.boolean().optional(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchUsersId({ path: { id }, body, client })),
	);
	server.tool(
		"admin_impersonate",
		`Inicia impersonación de un usuario/workspace — devuelve un token (POST /api/admin/impersonate).${CONFIRM}`,
		{
			targetUserId: z.string().optional().describe("Usuario a impersonar"),
			workspaceId: z.string().optional().describe("Workspace de contexto"),
		},
		destructive,
		async (body) => run(postImpersonate({ body, client })),
	);
	server.tool(
		"admin_impersonate_stop",
		"Termina la impersonación activa (POST /api/admin/impersonate/stop).",
		mutating,
		async () => run(postImpersonateStop({ client })),
	);

	// ── Platform plans y feature flags ───────────────────────────────────────
	server.tool(
		"admin_platform_plans_list",
		"Lista los planes de plataforma (GET /api/admin/platform-plans).",
		async () => run(getPlatformPlans({ client })),
	);
	server.tool(
		"admin_platform_plans_get",
		"Detalle de un plan de plataforma (GET /api/admin/platform-plans/{id}).",
		{ id: z.string().describe("Id del plan de plataforma") },
		async ({ id }) => run(getPlatformPlansId({ path: { id }, client })),
	);
	server.tool(
		"admin_platform_plans_create",
		"Crea un plan de plataforma (POST /api/admin/platform-plans).",
		{
			name: z.string(),
			slug: z.string(),
			priceMonthly: z.number(),
			priceYearly: z.number(),
			priceBiannual: z.number().nullish(),
			isActive: z.boolean(),
			maxEvents: z.number().int().nullish().describe("null = ilimitado"),
			memberships: z.boolean().optional(),
			content: z.boolean().optional(),
			fanDatabase: z.boolean().optional(),
			directMessages: z.boolean().optional(),
			streaming: z.boolean().optional(),
			customLanding: z.boolean().optional(),
			dataExport: z.boolean().optional(),
			seatMaps: z.boolean().optional(),
			customDomain: z.boolean().optional(),
			analytics: z.boolean().optional(),
		},
		mutating,
		async (body) => run(postPlatformPlans({ body, client })),
	);
	server.tool(
		"admin_platform_plans_update",
		"Actualiza un plan de plataforma (PATCH /api/admin/platform-plans/{id}).",
		{
			id: z.string().describe("Id del plan de plataforma"),
			name: z.string().optional(),
			priceMonthly: z.number().optional(),
			priceYearly: z.number().optional(),
			priceBiannual: z.number().nullish(),
			isActive: z.boolean().optional(),
			sortOrder: z.number().int().optional(),
			maxEvents: z.number().int().nullish(),
			memberships: z.boolean().optional(),
			content: z.boolean().optional(),
			fanDatabase: z.boolean().optional(),
			directMessages: z.boolean().optional(),
			streaming: z.boolean().optional(),
			customLanding: z.boolean().optional(),
			dataExport: z.boolean().optional(),
			seatMaps: z.boolean().optional(),
			customDomain: z.boolean().optional(),
			analytics: z.boolean().optional(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchPlatformPlansId({ path: { id }, body, client })),
	);
	server.tool(
		"admin_feature_flags_list",
		"Lista feature flags, opcionalmente por key (GET /api/admin/feature-flags).",
		{ key: z.string().optional().describe("Filtrar por key") },
		async (q) => run(getFeatureFlags({ query: q, client })),
	);
	server.tool(
		"admin_feature_flags_set",
		"Activa/desactiva un feature flag en un scope (PUT /api/admin/feature-flags/{key}).",
		{
			key: z.string().describe("Key del flag"),
			scope: z.enum(["global", "plan", "workspace"]),
			scopeId: z
				.string()
				.optional()
				.describe("Id del plan/workspace si scope no es global"),
			enabled: z.boolean(),
		},
		mutating,
		async ({ key, ...body }) =>
			run(putFeatureFlagsKey({ path: { key }, body, client })),
	);
}
