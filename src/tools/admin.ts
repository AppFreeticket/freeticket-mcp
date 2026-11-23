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
	getCrmOrganizations,
	getCrmQuota,
	getCrmSuppressions,
	getFeatureFlags,
	getMe,
	getPlatformPlans,
	getPlatformPlansId,
	getSettlements,
	getSettlementsId,
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
import { run, withStructured } from "../api";
import { read, write } from "../tool-meta";
import { UI_META, uiTool } from "../ui";
import { limitParam } from "../views";

const CONFIRM = " ⚠️ Sensitive cross-tenant action: confirm with the human.";
const SETTLEMENTS_READ_ONLY =
	" Read-only: creating, regenerating, sending, marking as paid, attaching " +
	"receipts to or deleting settlements is not done from the MCP but with the " +
	"CLI (`ft admin settlements`) or the dashboard.";
const CRM_READ_ONLY =
	" Read-only: launching, advancing batches, pausing or cancelling campaigns " +
	"is not done from the MCP but with the CLI (`ft admin crm`) or the dashboard.";

/**
 * Superadmin tools (/api/admin, cross-tenant). Registered only when
 * FT_ADMIN_SESSION is set. Covers reads + writes (Wave C): workspaces, users,
 * impersonation, platform plans and feature flags. From the master CRM only
 * the reads: the writes (`x-ft-mcp: { expose: false }` in the contract) send
 * real emails and WhatsApp messages to customers and are left out on purpose.
 * Same with settlements (contract 1.9): read-only; creating, regenerating,
 * sending, marking them paid or attaching receipts moves organizers' money
 * and stays in the CLI (`ft admin settlements`).
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
		"Lists tenants/workspaces cross-tenant (GET /api/admin/workspaces).",
		{
			q: z.string().optional().describe("Search by name/slug"),
			status: z.string().optional().describe("Filter by status"),
			limit: limitParam,
			cursor: z.string().optional().describe("Pagination cursor"),
		},
		async (q) => run(getWorkspaces({ query: q, client })),
	);

	uiTool(
		server,
		"admin_users",
		"Lists global users cross-tenant (GET /api/admin/users).",
		{
			q: z.string().optional().describe("Search by name/email"),
			role: z.string().optional().describe("Filter by role"),
			limit: limitParam,
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
		// Registered by hand (not uiTool): the view needs structuredContent.
		async () => withStructured(await run(getTokens({ client }))),
	);

	uiTool(
		server,
		"admin_audit_log",
		"Superadmin audit log (GET /api/admin/audit-log).",
		{
			action: z.string().optional().describe("Filter by action"),
			from: z.string().optional().describe("From (ISO 8601)"),
			to: z.string().optional().describe("To (ISO 8601)"),
			limit: limitParam,
			cursor: z.string().optional(),
		},
		async (q) => run(getAuditLog({ query: q, client })),
	);

	// ── Workspaces ───────────────────────────────────────────────────────────
	server.tool(
		"admin_workspaces_get",
		"Detail of a workspace/tenant (GET /api/admin/workspaces/{id}).",
		{ id: z.string().describe("Workspace id") },
		read("admin_workspaces_get"),
		async ({ id }) => run(getWorkspacesId({ path: { id }, client })),
	);
	server.tool(
		"admin_workspaces_create",
		"Creates a workspace/tenant (POST /api/admin/workspaces).",
		{
			name: z.string(),
			slug: z.string().describe("Unique slug"),
			type: z.enum(["ARTIST", "VENUE", "ORGANIZER"]),
			country: z.string(),
			email: z.string().email().optional().describe("Owner email"),
		},
		write("admin_workspaces_create", { destructive: false }),
		async (body) => run(postWorkspaces({ body, client })),
	);
	server.tool(
		"admin_workspaces_update",
		"Updates a workspace/tenant (PATCH /api/admin/workspaces/{id}).",
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
				.describe("Tier to activate (`legend` is enterprise)"),
		},
		// openWorld: cancels the tenant's Stripe subscription first.
		write("admin_workspaces_assign_plan", {
			destructive: true,
			openWorld: true,
		}),
		async ({ id, ...body }) =>
			run(postWorkspacesIdPlan({ path: { id }, body, client })),
	);
	server.tool(
		"admin_workspaces_suspend",
		`Suspends a workspace/tenant (POST /api/admin/workspaces/{id}/suspend).${CONFIRM}`,
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
		"Restores a suspended workspace (POST /api/admin/workspaces/{id}/restore).",
		{ id: z.string().describe("Workspace id") },
		write("admin_workspaces_restore", { destructive: false }),
		async ({ id }) => run(postWorkspacesIdRestore({ path: { id }, client })),
	);

	// ── Users and impersonation ──────────────────────────────────────────────
	server.tool(
		"admin_users_get",
		"Detail of a global user (GET /api/admin/users/{id}).",
		{ id: z.string().describe("User id") },
		read("admin_users_get"),
		async ({ id }) => run(getUsersId({ path: { id }, client })),
	);
	server.tool(
		"admin_users_update",
		"Updates a user's role or ban (PATCH /api/admin/users/{id}).",
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
		`Starts impersonating a user/workspace — returns a token (POST /api/admin/impersonate).${CONFIRM}`,
		{
			targetUserId: z.string().optional().describe("User to impersonate"),
			workspaceId: z.string().optional().describe("Context workspace"),
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

	// ── Platform plans and feature flags ─────────────────────────────────────
	uiTool(
		server,
		"admin_platform_plans_list",
		"Lists the platform plans (GET /api/admin/platform-plans).",
		{},
		async () => run(getPlatformPlans({ client })),
	);
	server.tool(
		"admin_platform_plans_get",
		"Detail of a platform plan (GET /api/admin/platform-plans/{id}).",
		{ id: z.string().describe("Platform plan id") },
		read("admin_platform_plans_get"),
		async ({ id }) => run(getPlatformPlansId({ path: { id }, client })),
	);
	server.tool(
		"admin_platform_plans_create",
		"Creates a platform plan (POST /api/admin/platform-plans).",
		{
			name: z.string(),
			slug: z.string(),
			priceMonthly: z.number(),
			priceYearly: z.number(),
			priceBiannual: z.number().nullish(),
			isActive: z.boolean(),
			maxEvents: z.number().int().nullish().describe("null = unlimited"),
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
		"Updates a platform plan (PATCH /api/admin/platform-plans/{id}).",
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
		"Lists feature flags, optionally by key (GET /api/admin/feature-flags).",
		{ key: z.string().optional().describe("Filter by key") },
		async (q) => run(getFeatureFlags({ query: q, client })),
	);
	server.tool(
		"admin_feature_flags_set",
		"Enables/disables a feature flag in a scope (PUT /api/admin/feature-flags/{key}).",
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

	// ── Master CRM (reads only) ──────────────────────────────────────────────
	uiTool(
		server,
		"admin_crm_campaigns",
		`Lists the master CRM campaigns launched by the team (GET /api/admin/crm/campaigns).${CRM_READ_ONLY}`,
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
		`Detail of a master CRM campaign: filter, sender, counters and batches (GET /api/admin/crm/campaigns/{id}).${CRM_READ_ONLY}`,
		{ id: z.string().describe("Campaign id") },
		read("admin_crm_campaigns_get"),
		async ({ id }) => run(getCrmCampaignsId({ path: { id }, client })),
	);
	server.tool(
		"admin_crm_audience_preview",
		"Counts the audience of a CRM filter without sending or creating anything " +
			"(POST /api/admin/crm/audience/preview): counters per channel, a " +
			"sample of up to 10 people masked on the server, who can sign as " +
			"sender and, if WhatsApp is reachable, the days it would take within " +
			"the quota. `filter` is v2: `{ version: 2, scope, include, except }`, " +
			"with `scope` `{ level: 'platform' }`, `{ level: 'orgs', workspaceIds }` " +
			"or `{ level: 'events', eventIds }`, and `include`/`except` lists of " +
			"conditions (`purchased`, `abandoned`, `checked_in`, `city`, `facet`, " +
			"`membership`, `spend`, `received_campaign`, `people`). Use " +
			"`admin_crm_options`, `admin_crm_events` and `admin_crm_event_dates` " +
			"for the ids. An invalid filter returns 422 with `error.details[].path`; " +
			"one that is too large, 413." +
			CRM_READ_ONLY,
		{
			filter: z
				.object({ version: z.literal(2) })
				.passthrough()
				.describe(
					"Audience filter v2 (`version: 2` required; the server validates the rest)",
				),
			sender: z
				.discriminatedUnion("kind", [
					z.object({ kind: z.literal("freeticket") }),
					z.object({
						kind: z.literal("organization"),
						workspaceId: z.string().min(1).max(64),
					}),
				])
				.optional()
				.describe(
					"Who signs as sender. It only adds that sender's unsubscribes; it never adds people.",
				),
		},
		read("admin_crm_audience_preview"),
		async (body) => run(postCrmAudiencePreview({ body, client })),
	);
	uiTool(
		server,
		"admin_crm_quota",
		"Daily WhatsApp quota and already committed batches of the master CRM (GET /api/admin/crm/quota).",
		{},
		async () => run(getCrmQuota({ client })),
	);
	server.tool(
		"admin_crm_options",
		"Options to build a CRM filter: cities, facets (genre/format), " +
			"membership plans and templates (GET /api/admin/crm/options).",
		read("admin_crm_options"),
		async () => run(getCrmOptions({ client })),
	);
	uiTool(
		server,
		"admin_crm_events",
		"Searches shows for a CRM filter or campaign (GET /api/admin/crm/events).",
		{
			purpose: z
				.enum(["scope", "promote", "except"])
				.describe(
					"`scope` to narrow the audience, `except` to exclude, `promote` " +
						"for the show being announced (published only; with " +
						"`senderWorkspaceId`, only that organization's)",
				),
			query: z.string().max(120).optional().describe("Text to search"),
			senderWorkspaceId: z.string().optional(),
		},
		async (q) => run(getCrmEvents({ query: q, client })),
	);
	server.tool(
		"admin_crm_event_dates",
		"Dates (performances) of one or more shows, to narrow a CRM condition to " +
			"specific dates (GET /api/admin/crm/event-dates).",
		{
			eventIds: z
				.array(z.string())
				.min(1)
				.max(50)
				.describe("Show ids (1 to 50)"),
		},
		read("admin_crm_event_dates"),
		async ({ eventIds }) =>
			run(
				getCrmEventDates({ query: { eventIds: eventIds.join(",") }, client }),
			),
	);

	server.tool(
		"admin_crm_organizations",
		"Searches active organizations by name or slug for the CRM filter " +
			"(`scope.level: 'orgs'`) or for `sender.workspaceId` " +
			"(GET /api/admin/crm/organizations): up to 10 with `query`, the " +
			"first 20 by name without it.",
		{
			query: z.string().max(120).optional().describe("Name or slug"),
		},
		read("admin_crm_organizations"),
		async (q) => run(getCrmOrganizations({ query: q, client })),
	);
	uiTool(
		server,
		"admin_crm_suppressions",
		"Master CRM unsubscribes (suppressions), most recent first, with the " +
			"email masked (GET /api/admin/crm/suppressions). `scope: 'global'` " +
			"(default) returns only platform-level ones; `all` adds each " +
			"organization's. Adding or removing a suppression is not done from the MCP." +
			CRM_READ_ONLY,
		{
			query: z
				.string()
				.max(254)
				.optional()
				.describe("Full email or a part of it"),
			scope: z.enum(["global", "all"]).optional(),
			limit: z
				.number()
				.int()
				.min(1)
				.max(500)
				.optional()
				.describe("1-500, default 100"),
		},
		async (q) => run(getCrmSuppressions({ query: q, client })),
	);

	// ── Settlements (contract 1.9, read-only) ────────────────────────────────
	uiTool(
		server,
		"admin_settlements_list",
		"EVENT settlements of every organization, newest first " +
			"(GET /api/admin/settlements); membership settlements are not listed, " +
			"same as in the dashboard. The payout split only carries the last 4 " +
			"digits of each account. Amounts in integer COP." +
			SETTLEMENTS_READ_ONLY,
		{
			status: z
				.enum([
					"DRAFT",
					"GENERATED",
					"SENT",
					"AWAITING_PAYMENT",
					"PAID",
					"REQUESTED",
					"PENDING",
					"REJECTED",
				])
				.optional(),
			organizationId: z
				.string()
				.optional()
				.describe("Only that organization's"),
			limit: limitParam,
			cursor: z.string().optional().describe("Pagination cursor"),
		},
		async (q) => run(getSettlements({ query: q, client })),
	);
	server.tool(
		"admin_settlements_get",
		`Detail of a settlement of any organization (GET /api/admin/settlements/{id}).${SETTLEMENTS_READ_ONLY}`,
		{ id: z.string().describe("Settlement id") },
		read("admin_settlements_get"),
		async ({ id }) => run(getSettlementsId({ path: { id }, client })),
	);
}
