import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	deleteWorkspacesId,
	getAuditLog,
	getFeatureFlags,
	getMe,
	getPlatformPlans,
	getPlatformPlansId,
	getTokens,
	getUsers,
	getUsersId,
	getWorkspaces,
	getWorkspacesId,
	getWorkspacesIdPlan,
	patchPlatformPlansId,
	patchUsersId,
	patchWorkspacesId,
	postImpersonate,
	postImpersonateStop,
	postPlatformPlans,
	postWorkspaces,
	postWorkspacesIdPlan,
	postWorkspacesIdRestore,
	postWorkspacesIdSuspend,
	putFeatureFlagsKey,
} from "../admin-client/sdk.gen";
import { run } from "../api";
import { toolAnnotations } from "../tool-annotations";
import { UI_META, uiTool } from "../ui";

const destructive = { destructiveHint: true, idempotentHint: false } as const;
const mutating = { destructiveHint: false, idempotentHint: false } as const;
const CONFIRM = " ⚠️ Sensitive cross-tenant action: confirm with the human.";

/**
 * Tools superadmin (/api/admin, cross-tenant). Se registran solo si hay
 * FT_ADMIN_SESSION. Cubre reads + writes (Ola C): workspaces, users,
 * impersonation, platform plans y feature flags.
 */
export function registerAdminTools(server: McpServer, client: Client): void {
	server.tool(
		"admin_whoami",
		"Identity of the superadmin in the active session (GET /api/admin/me).",
		toolAnnotations("admin_whoami", true),
		async () => run(getMe({ client })),
	);

	uiTool(
		server,
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

	uiTool(
		server,
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

	server.registerTool(
		"admin_tokens",
		{
			annotations: toolAnnotations("admin_tokens", true),
			description:
				"Platform service tokens (PATs): which headless credentials exist and " +
				"when they were used (GET /api/admin/tokens). It never returns the " +
				"secret. Minting and revoking is done with the CLI (`ft admin tokens`), " +
				"not from here.",
			inputSchema: {},
			_meta: UI_META,
		},
		async () => run(getTokens({ client })),
	);

	uiTool(
		server,
		"admin_audit_log",
		"Superadmin audit log (GET /api/admin/audit-log).",
		{
			action: z.string().optional().describe("Filter by action"),
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
		{ id: z.string().describe("Workspace id") },
		toolAnnotations("admin_workspaces_get", true),
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
			email: z.string().email().optional().describe("Owner email"),
		},
		toolAnnotations("admin_workspaces_create", false, mutating),
		async (body) => run(postWorkspaces({ body, client })),
	);
	server.tool(
		"admin_workspaces_update",
		"Actualiza un workspace/tenant (PATCH /api/admin/workspaces/{id}).",
		{
			id: z.string().describe("Workspace id"),
			name: z.string().optional(),
			slug: z.string().optional(),
			type: z.enum(["ARTIST", "VENUE", "ORGANIZER"]).optional(),
			isPublished: z.boolean().optional(),
			webTemplate: z
				.string()
				.min(1)
				.max(80)
				.nullish()
				.describe(
					"Template of the public site for the tenant. null restores the default.",
				),
			customDomain: z
				.string()
				.max(253)
				.nullish()
				.describe(
					"Custom domain for the tenant (no protocol). null unlinks it.",
				),
			customDomainVerifiedAt: z
				.string()
				.datetime()
				.nullish()
				.describe("Marks the domain as verified. null reverts it."),
		},
		toolAnnotations("admin_workspaces_update", false, mutating),
		async ({ id, ...body }) =>
			run(patchWorkspacesId({ path: { id }, body, client })),
	);
	server.tool(
		"admin_workspaces_plan_get",
		"Current platform plan of a workspace, inherited from its Organization: " +
			"`planSlug`/`planName` (null if none) and `stripeLinked` — check it " +
			"before reassigning (GET /api/admin/workspaces/{id}/plan).",
		{ id: z.string().describe("Workspace id") },
		toolAnnotations("admin_workspaces_plan_get", true),
		async ({ id }) => run(getWorkspacesIdPlan({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_assign_plan",
		"Assigns a platform plan by hand — an assisted sale, bypassing Stripe " +
			`self-service (POST /api/admin/workspaces/{id}/plan).${CONFIRM} ` +
			"If the tenant had a Stripe subscription, it is cancelled there first; " +
			"if that cancellation fails, the API aborts with 409 touching nothing.",
		{
			id: z.string().describe("Workspace id"),
			planSlug: z
				.enum(["spark", "star", "icon", "legend"])
				.describe("Tier a activar (`legend` es enterprise)"),
		},
		toolAnnotations("admin_workspaces_assign_plan", false, destructive),
		async ({ id, ...body }) =>
			run(postWorkspacesIdPlan({ path: { id }, body, client })),
	);
	server.tool(
		"admin_workspaces_suspend",
		`Suspende un workspace/tenant (POST /api/admin/workspaces/{id}/suspend).${CONFIRM}`,
		{ id: z.string().describe("Workspace id") },
		toolAnnotations("admin_workspaces_suspend", false, destructive),
		async ({ id }) => run(postWorkspacesIdSuspend({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_delete",
		"Soft-deletes a workspace: sets `deletedAt`, never removes rows, sales or " +
			"buyers (DELETE /api/admin/workspaces/{id}). The tenant must be " +
			"suspended first and have no CONFIRMED sale (409 otherwise). Does not " +
			`cancel Stripe nor anonymize data.${CONFIRM}`,
		{ id: z.string().describe("Workspace id") },
		toolAnnotations("admin_workspaces_delete", false, destructive),
		async ({ id }) => run(deleteWorkspacesId({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_restore",
		"Restaura un workspace suspendido (POST /api/admin/workspaces/{id}/restore).",
		{ id: z.string().describe("Workspace id") },
		toolAnnotations("admin_workspaces_restore", false, mutating),
		async ({ id }) => run(postWorkspacesIdRestore({ path: { id }, client })),
	);

	// ── Users e impersonation ────────────────────────────────────────────────
	server.tool(
		"admin_users_get",
		"Detalle de un usuario global (GET /api/admin/users/{id}).",
		{ id: z.string().describe("User id") },
		toolAnnotations("admin_users_get", true),
		async ({ id }) => run(getUsersId({ path: { id }, client })),
	);
	server.tool(
		"admin_users_update",
		"Actualiza rol o baneo de un usuario (PATCH /api/admin/users/{id}).",
		{
			id: z.string().describe("User id"),
			role: z
				.enum(["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER", "MINCULTURA"])
				.optional(),
			banned: z.boolean().optional(),
		},
		toolAnnotations("admin_users_update", false, mutating),
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
		toolAnnotations("admin_impersonate", false, destructive),
		async (body) => run(postImpersonate({ body, client })),
	);
	server.tool(
		"admin_impersonate_stop",
		"Ends the active impersonation (POST /api/admin/impersonate/stop).",
		toolAnnotations("admin_impersonate_stop", false, mutating),
		async () => run(postImpersonateStop({ client })),
	);

	// ── Platform plans y feature flags ───────────────────────────────────────
	uiTool(
		server,
		"admin_platform_plans_list",
		"Lists the platform plans (GET /api/admin/platform-plans).",
		{},
		async () => run(getPlatformPlans({ client })),
	);
	server.tool(
		"admin_platform_plans_get",
		"Detalle de un plan de plataforma (GET /api/admin/platform-plans/{id}).",
		{ id: z.string().describe("Platform plan id") },
		toolAnnotations("admin_platform_plans_get", true),
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
		toolAnnotations("admin_platform_plans_create", false, mutating),
		async (body) => run(postPlatformPlans({ body, client })),
	);
	server.tool(
		"admin_platform_plans_update",
		"Actualiza un plan de plataforma (PATCH /api/admin/platform-plans/{id}).",
		{
			id: z.string().describe("Platform plan id"),
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
		toolAnnotations("admin_platform_plans_update", false, mutating),
		async ({ id, ...body }) =>
			run(patchPlatformPlansId({ path: { id }, body, client })),
	);
	uiTool(
		server,
		"admin_feature_flags_list",
		"Lista feature flags, opcionalmente por key (GET /api/admin/feature-flags).",
		{ key: z.string().optional().describe("Filtrar por key") },
		async (q) => run(getFeatureFlags({ query: q, client })),
	);
	server.tool(
		"admin_feature_flags_set",
		"Activa/desactiva un feature flag en un scope (PUT /api/admin/feature-flags/{key}).",
		{
			key: z.string().describe("Flag key"),
			scope: z.enum(["global", "plan", "workspace"]),
			scopeId: z
				.string()
				.optional()
				.describe("Plan or workspace id when scope is not global"),
			enabled: z.boolean(),
		},
		toolAnnotations("admin_feature_flags_set", false, mutating),
		async ({ key, ...body }) =>
			run(putFeatureFlagsKey({ path: { key }, body, client })),
	);
}
