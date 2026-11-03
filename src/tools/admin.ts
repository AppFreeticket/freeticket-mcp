import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	deleteWorkspacesId,
	getAuditLog,
	getCrmCampaigns,
	getCrmCampaignsId,
	getCrmEventDates,
	getCrmEvents,
	getCrmOptions,
	getCrmQuota,
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
	postCrmAudiencePreview,
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
import { read, write } from "../tool-meta";
import { UI_META, uiTool } from "../ui";

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
		read("admin_whoami"),
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
			description:
				"Platform service tokens (PATs): which headless credentials exist and " +
				"when they were used (GET /api/admin/tokens). It never returns the " +
				"secret. Minting and revoking is done with the CLI (`ft admin tokens`), " +
				"not from here.",
			inputSchema: {},
			annotations: read("admin_tokens"),
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
		read("admin_workspaces_get"),
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
		write("admin_workspaces_create", { destructive: false }),
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
		write("admin_workspaces_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchWorkspacesId({ path: { id }, body, client })),
	);
	server.tool(
		"admin_workspaces_plan_get",
		"Current platform plan of a workspace, inherited from its Organization: " +
			"`planSlug`/`planName` (null if none) and `stripeLinked` — check it " +
			"before reassigning (GET /api/admin/workspaces/{id}/plan).",
		{ id: z.string().describe("Workspace id") },
		read("admin_workspaces_plan_get"),
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
		write("admin_workspaces_assign_plan", { destructive: true }),
		async ({ id, ...body }) =>
			run(postWorkspacesIdPlan({ path: { id }, body, client })),
	);
	server.tool(
		"admin_workspaces_suspend",
		`Suspende un workspace/tenant (POST /api/admin/workspaces/{id}/suspend).${CONFIRM}`,
		{ id: z.string().describe("Workspace id") },
		write("admin_workspaces_suspend", { destructive: true }),
		async ({ id }) => run(postWorkspacesIdSuspend({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_delete",
		"Soft-deletes a workspace: sets `deletedAt`, never removes rows, sales or " +
			"buyers (DELETE /api/admin/workspaces/{id}). The tenant must be " +
			"suspended first and have no CONFIRMED sale (409 otherwise). Does not " +
			`cancel Stripe nor anonymize data.${CONFIRM}`,
		{ id: z.string().describe("Workspace id") },
		write("admin_workspaces_delete", { destructive: true }),
		async ({ id }) => run(deleteWorkspacesId({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_restore",
		"Restaura un workspace suspendido (POST /api/admin/workspaces/{id}/restore).",
		{ id: z.string().describe("Workspace id") },
		write("admin_workspaces_restore", { destructive: false }),
		async ({ id }) => run(postWorkspacesIdRestore({ path: { id }, client })),
	);

	// ── Users e impersonation ────────────────────────────────────────────────
	server.tool(
		"admin_users_get",
		"Detalle de un usuario global (GET /api/admin/users/{id}).",
		{ id: z.string().describe("User id") },
		read("admin_users_get"),
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
		write("admin_users_update", { destructive: false }),
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
		write("admin_impersonate", { destructive: true }),
		async (body) => run(postImpersonate({ body, client })),
	);
	server.tool(
		"admin_impersonate_stop",
		"Ends the active impersonation (POST /api/admin/impersonate/stop).",
		write("admin_impersonate_stop", { destructive: false }),
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
		read("admin_platform_plans_get"),
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
		write("admin_platform_plans_create", { destructive: false }),
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
		write("admin_platform_plans_update", { destructive: false }),
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
		write("admin_feature_flags_set", { destructive: false }),
		async ({ key, ...body }) =>
			run(putFeatureFlagsKey({ path: { key }, body, client })),
	);

	// ── Master CRM (contract 1.6–1.8), reads only ────────────────────────────
	// Launching, batching, stopping or cancelling a campaign sends (or stops)
	// real messages to customers: the contract flags those writes with
	// `x-ft-mcp: { expose: false }` and they stay in the CLI (`ft admin crm`).
	// These tools let an agent look at campaigns and size an audience.
	uiTool(
		server,
		"admin_crm_campaigns_list",
		"Campaigns of the master CRM launched by the FreeTicket team " +
			"(GET /api/admin/crm/campaigns). Launching one is not a tool: it sends " +
			"real messages and belongs to the CLI (`ft admin crm`).",
		{
			channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
			status: z
				.enum([
					"SENT",
					"FAILED",
					"DENIED",
					"PROCESSING",
					"APPROVED",
					"SCHEDULED",
					"CANCELLED",
				])
				.optional(),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("1-100, default 50"),
		},
		async (q) => run(getCrmCampaigns({ query: q, client })),
	);
	server.tool(
		"admin_crm_campaigns_get",
		"Detail of one master CRM campaign (GET /api/admin/crm/campaigns/{id}).",
		{ id: z.string().describe("Campaign id") },
		read("admin_crm_campaigns_get"),
		async ({ id }) => run(getCrmCampaignsId({ path: { id }, client })),
	);
	const crmSender = z
		.discriminatedUnion("kind", [
			z.object({ kind: z.literal("freeticket") }),
			z.object({
				kind: z.literal("organization"),
				workspaceId: z.string().min(1).max(64),
			}),
		])
		.describe(
			"Who signs. `freeticket` is mandatory when the scope spans the platform, " +
				"several organizations or events of more than one owner (422 otherwise).",
		);
	server.tool(
		"admin_crm_audience_preview",
		"Sizes the audience of a CRM filter without creating anything " +
			"(POST /api/admin/crm/audience/preview): counters, a sample of up to 10 " +
			"people masked by the server, who may sign, and the days the WhatsApp " +
			"quota would take. Invalid filters answer 422 with `error.details[].path`.",
		{
			filter: z
				.object({ version: z.literal(2) })
				.passthrough()
				.describe(
					"Audience filter v2 `{ version: 2, scope, include, except }`, validated " +
						"server-side. Use `admin_crm_options`, `admin_crm_events` and " +
						"`admin_crm_event_dates` to find valid values.",
				),
			sender: crmSender.optional(),
		},
		read("admin_crm_audience_preview"),
		async (body) => run(postCrmAudiencePreview({ body, client })),
	);
	uiTool(
		server,
		"admin_crm_quota",
		"WhatsApp quota and the batches already committed (GET /api/admin/crm/quota).",
		{},
		async () => run(getCrmQuota({ client })),
	);
	server.tool(
		"admin_crm_options",
		"Options to build a campaign: cities, facets, plans and approved WhatsApp " +
			"templates (GET /api/admin/crm/options).",
		read("admin_crm_options"),
		async () => run(getCrmOptions({ client })),
	);
	uiTool(
		server,
		"admin_crm_events",
		"Searches shows to use in a CRM campaign (GET /api/admin/crm/events). " +
			"`promote` returns only published shows (and, with `senderWorkspaceId`, " +
			"only that organization's).",
		{
			purpose: z
				.enum(["scope", "promote", "except"])
				.describe("What the show is for in the campaign"),
			query: z.string().max(120).optional().describe("Text to search"),
			senderWorkspaceId: z.string().optional(),
		},
		async (q) => run(getCrmEvents({ query: q, client })),
	);
	uiTool(
		server,
		"admin_crm_event_dates",
		"Dates of some shows, to narrow a CRM condition (GET /api/admin/crm/event-dates).",
		{
			eventIds: z.string().describe("Comma-separated show ids (1 to 50)"),
		},
		async (q) => run(getCrmEventDates({ query: q, client })),
	);
}
