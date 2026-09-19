import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Creds, makeB2bClient, run } from "../api";
import {
	getApiKeys,
	getContentLives,
	getContentLivesId,
	getContentPosts,
	getContentVideos,
	getCustomerMe,
	getCustomerMembership,
	getCustomerProfile,
	getCustomerTickets,
	getCustomerTicketsId,
	getDiscounts,
	getEvents,
	getEventsId,
	getEventsIdDates,
	getMe,
	getMembershipPlans,
	getMembershipPlansId,
	getMembershipPlansIdSubscribers,
	getReportsByEvent,
	getReportsExportsAttendees,
	getReportsExportsBuyers,
	getReportsExportsReconciliation,
	getReportsExportsSubscribers,
	getReportsFinancials,
	getReportsInventory,
	getReportsReconciliation,
	getReportsSummary,
	getReportsTimeseries,
	getSales,
	getSalesId,
	getSalesIdTickets,
	getSettlements,
	getStaff,
	getTicketsTicketCodeAccess,
	getTicketTypes,
	getTicketTypesId,
	getVenues,
	getVenuesId,
	getWebhooks,
} from "../client/sdk.gen";
import { uiTool } from "../ui";
import { makeWorkspaceResolver, runWorkspaceList } from "../workspaces";

const paging = {
	limit: z.string().optional().describe("Results per page (1-100)"),
	cursor: z.string().optional().describe("Pagination cursor"),
};
const id = z.string().describe("Resource id");

/** Contract enums — the generated client no longer accepts a loose string. */
const eventStatus = z
	.enum(["DRAFT", "PUBLISHED", "SOLD_OUT", "CANCELLED", "COMPLETED"])
	.describe("Event status");
const saleChannel = z
	.enum(["WEB", "MOBILE", "POS", "ADMIN"])
	.describe("Sales channel");
const saleStatus = z
	.enum(["PENDING", "CONFIRMED", "ABANDONED", "CANCELLED", "REFUNDED"])
	.describe("Sale status");

/**
 * Global mode (gap #3) is the **default** on the read tools that list: a
 * session that nobody pinned reads every workspace its credential reaches, and
 * `workspace` only narrows it back down. Aggregated rows are tagged with
 * workspaceId/workspaceName. The set of valid ids always comes from GET /me,
 * never from whatever the client asks for unvalidated — see ../workspaces.ts.
 */
/**
 * #8: `events_list` used to return the whole event — a long description and
 * four image URLs per row. At 81 events that overflows the agent's window, and
 * it then burns shell calls parsing the JSON outside the model. The slim view
 * is the default; `verbose: true` returns the object as-is, so a trimmed field
 * is always recoverable and the client does not define the contract by omission.
 * ponytail: trimming in the client. If `GET /events` grows a `fields` param,
 * this goes away and is asked for upstream.
 */
const SLIM_EVENT_FIELDS = [
	"id",
	"name",
	"slug",
	"status",
	"access",
	"venueId",
	"venue",
	"nextDate",
	"updatedAt",
] as const;

export function slimEvent(event: unknown): Record<string, unknown> {
	const full = event as Record<string, unknown>;
	const slim: Record<string, unknown> = {};
	for (const field of SLIM_EVENT_FIELDS) {
		if (field in full) slim[field] = full[field];
	}
	return slim;
}

const workspaceParam = z
	.union([z.literal("all"), z.array(z.string())])
	.optional()
	.describe(
		"Which workspaces to read. **Absent already means every workspace the " +
			'session reaches** — pass a list of ids (or "all", which is the same ' +
			"thing said out loud) only to narrow it down. Aggregated rows are " +
			"tagged with workspaceId/workspaceName and carry no pagination cursor: " +
			"to page deep, name one workspace.",
	);

/**
 * Settlement downloads: the API answers **302** towards a signed URL with a
 * 5-minute TTL. Following the redirect would pull the whole PDF into the
 * model's context, so we stop at the 302 and return the link for whoever should
 * open it. That is why this uses a raw fetch and not the generated client.
 */
async function signedDownload(
	creds: Creds,
	path: string,
): Promise<{
	content: { type: "text"; text: string }[];
	isError?: boolean;
}> {
	const res = await fetch(`${creds.apiUrl}/api/v1${path}`, {
		redirect: "manual",
		headers: {
			Authorization: `Bearer ${creds.apiKey}`,
			...(creds.workspaceId ? { "X-Workspace-Id": creds.workspaceId } : {}),
		},
	});
	const url = res.headers.get("location");
	if (!url)
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `The API did not return the signed URL (HTTP ${res.status}): ${await res.text()}`,
				},
			],
		};
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({ url, expiresInMinutes: 5 }, null, 2),
			},
		],
	};
}

/**
 * Wave A: every read of the B2B /api/v1 contract (one tool = one operationId).
 * Writes (create/update/delete/publish/checkin/refund…) = Wave B, with no
 * global: siguen siendo de un solo workspace, explícito.
 *
 * Lists and reports register through `uiTool`: alongside the JSON they carry
 * the MCP Apps view (src/ui.ts), which the host renders as a table or KPIs. A
 * host without the extension ignores `_meta` and sees the same text as always.
 */
export function registerB2bTools(
	server: McpServer,
	client: Client,
	creds: Creds,
): void {
	const ctx = {
		client,
		creds,
		resolveWorkspaces: makeWorkspaceResolver(client),
	};

	server.tool(
		"whoami",
		"User and workspaces of the configured session (GET /me).",
		async () => run(getMe({ client })),
	);

	uiTool(
		server,
		"events_list",
		"Lists the workspace's events (GET /events). `status` filters in the " +
			"consulta (así `limit` cuenta solo filas devueltas) y `withTotal` agrega " +
			"`page.total`. `workspace` turns on global mode.",
		{
			...paging,
			q: z.string().optional().describe("Búsqueda por nombre/descripción"),
			status: eventStatus.optional(),
			withTotal: z
				.boolean()
				.optional()
				.describe("Incluir page.total (cuenta extra, opt-in)"),
			verbose: z
				.boolean()
				.optional()
				.describe(
					"Return the whole event (description and images). The slim view " +
						"is the default: id, name, slug, status, access, venue and " +
						"próxima fecha.",
				),
			workspace: workspaceParam,
		},
		async ({ workspace, verbose, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, async (c, limit) => {
				const res = await getEvents({ query: { ...q, limit }, client: c });
				if (verbose || res.error !== undefined || !res.data) return res;
				return {
					...res,
					data: { ...res.data, data: res.data.data.map(slimEvent) },
				};
			}),
	);
	server.tool(
		"events_get",
		"Detail of one event (GET /events/{id}).",
		{ id },
		async ({ id }) => run(getEventsId({ path: { id }, client })),
	);
	uiTool(
		server,
		"event_dates_list",
		"Dates of an event (GET /events/{id}/dates).",
		{ eventId: z.string().describe("Event id") },
		async ({ eventId }) =>
			run(getEventsIdDates({ path: { id: eventId }, client })),
	);

	uiTool(
		server,
		"ticket_types_list",
		"Ticket types (GET /ticket-types). `workspace` turns on global mode.",
		{
			eventDateId: z.string().optional().describe("Filter by event date"),
			...paging,
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getTicketTypes({ query: { ...q, limit }, client: c }),
			),
	);
	server.tool(
		"ticket_types_get",
		"Detalle de un tipo de ticket (GET /ticket-types/{id}).",
		{ id },
		async ({ id }) => run(getTicketTypesId({ path: { id }, client })),
	);

	uiTool(
		server,
		"sales_list",
		"Lists sales with filters (GET /sales). `workspace` turns on global mode.",
		{
			// The contract declares these as enums; typing them as a loose string
			// cost the agent a roundtrip to discover that "PAID" or "MOBILE_APP"
			// do not exist (issue #11). The schema is the contract.
			status: saleStatus.optional(),
			channel: saleChannel.optional(),
			event: z.string().optional().describe("Filter by event"),
			eventDate: z.string().optional().describe("Filter by event date"),
			reference: z.string().optional().describe("Buscar por referencia"),
			buyer: z.string().optional().describe("Search by buyer (name or email)"),
			from: z.string().optional().describe("Created from (ISO 8601)"),
			to: z.string().optional().describe("Creadas hasta (ISO 8601)"),
			...paging,
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getSales({ query: { ...q, limit }, client: c }),
			),
	);
	server.tool(
		"sales_get",
		"Detail of one sale (GET /sales/{id}).",
		{ id },
		async ({ id }) => run(getSalesId({ path: { id }, client })),
	);
	server.tool(
		"sales_tickets",
		"Individual tickets and attendees of a sale (GET /sales/{id}/tickets).",
		{ id: z.string().describe("Sale id") },
		async ({ id }) => run(getSalesIdTickets({ path: { id }, client })),
	);
	server.tool(
		"tickets_access",
		"Estado de acceso de un ticket por su código QR — no admite, solo consulta (GET /tickets/{code}/access).",
		{ code: z.string().describe("Ticket QR code") },
		async ({ code }) =>
			run(getTicketsTicketCodeAccess({ path: { ticketCode: code }, client })),
	);

	uiTool(
		server,
		"plans_list",
		"Membership plans (GET /membership-plans). `workspace` turns on global mode.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getMembershipPlans({ query: { ...q, limit }, client: c }),
			),
	);
	server.tool(
		"plans_get",
		"Detalle de un plan de membresía (GET /membership-plans/{id}).",
		{ id },
		async ({ id }) => run(getMembershipPlansId({ path: { id }, client })),
	);
	server.tool(
		"plans_subscribers",
		"Suscriptores/miembros de un plan (GET /membership-plans/{id}/subscribers).",
		{ id: z.string().describe("Plan id") },
		async ({ id }) =>
			run(getMembershipPlansIdSubscribers({ path: { id }, client })),
	);

	uiTool(
		server,
		"discounts_list",
		"Workspace coupons and discounts (GET /discounts). `workspace` turns on global mode.",
		{
			event: z.string().optional().describe("Filter by event"),
			active: z.string().optional().describe("true | false"),
			...paging,
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getDiscounts({ query: { ...q, limit }, client: c }),
			),
	);
	uiTool(
		server,
		"webhooks_list",
		"Registered webhooks (GET /webhooks). `workspace` turns on global mode.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getWebhooks({ query: { ...q, limit }, client: c }),
			),
	);

	uiTool(
		server,
		"venues_list",
		"Workspace venues (GET /venues). `workspace` turns on global mode.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getVenues({ query: { ...q, limit }, client: c }),
			),
	);
	server.tool(
		"venues_get",
		"Detalle de un venue (GET /venues/{id}).",
		{ id },
		async ({ id }) => run(getVenuesId({ path: { id }, client })),
	);
	uiTool(
		server,
		"staff_list",
		"Staff of every workspace the session reaches (GET /staff). Unlike the " +
			"rest, here the contract resolves it with `workspaceIds` (one single " +
			"call, rows tagged by the backend), not a fan-out — so it is capped at " +
			"the 25 workspaces the contract accepts. `workspace` narrows it to a " +
			"subset; a pinned session stays on its own workspace.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) => {
			// A pinned session means that workspace and no other.
			if (!workspace && creds.workspaceId)
				return run(getStaff({ query: q, client }));
			const ids =
				workspace === undefined || workspace === "all"
					? (await ctx.resolveWorkspaces()).map((w) => w.id)
					: workspace;
			// Nothing to widen to (an unreachable /me answers []): the plain call,
			// never an empty list built out of a failure.
			if (ids.length === 0) return run(getStaff({ query: q, client }));
			return run(
				getStaff({
					query: { ...q, workspaceIds: ids.slice(0, 25).join(",") },
					client,
				}),
			);
		},
	);

	uiTool(
		server,
		"reports_summary",
		"KPIs of one workspace (GET /reports/summary). The only report that does " +
			"not widen to every workspace: these are an object, not rows, and adding " +
			"up KPIs across tenants means nothing. Without `workspace` it answers " +
			"for the account's default one — call it once per id to compare, or use " +
			"`reports_by_event` / `reports_financials`, which do aggregate rows.",
		{
			period: z.enum(["7d", "30d", "90d", "1y"]).optional(),
			workspace: z
				.string()
				.optional()
				.describe("Id of the workspace to report on (one, never a list)"),
		},
		async ({ workspace, ...q }) =>
			run(
				getReportsSummary({
					query: q,
					client: workspace
						? makeB2bClient({ ...creds, workspaceId: workspace })
						: client,
				}),
			),
	);
	uiTool(
		server,
		"reports_by_event",
		"Revenue, tickets sold and availability per event (GET /reports/by-event). " +
			"`workspace` turns on global mode.",
		{
			from: z.string().optional().describe("Desde (ISO 8601)"),
			to: z.string().optional().describe("Hasta (ISO 8601)"),
			status: saleStatus.optional(),
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getReportsByEvent({ query: { ...q, limit }, client: c }),
			),
	);
	uiTool(
		server,
		"reports_timeseries",
		"Serie temporal de revenue/tickets (GET /reports/timeseries).",
		{
			interval: z.enum(["day", "week", "month"]),
			from: z.string().optional(),
			to: z.string().optional(),
			event: z.string().optional().describe("Filter by event"),
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getReportsTimeseries({ query: { ...q, limit }, client: c }),
			),
	);
	uiTool(
		server,
		"reports_inventory",
		"Capacity, sold, reserved and available per event·date·type (GET /reports/inventory).",
		{
			eventId: z.string().optional(),
			eventDateId: z.string().optional(),
			from: z.string().optional(),
			to: z.string().optional(),
			includeDrafts: z
				.string()
				.optional()
				.describe("true | false — incluir borradores"),
			groupBy: z.enum(["ticketType", "date", "event"]).optional(),
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getReportsInventory({ query: { ...q, limit }, client: c }),
			),
	);
	uiTool(
		server,
		"reconciliation",
		"Financial reconciliation for the CFO: crosses every sale with its Mercado " +
			"Pago transaction and its Siigo invoice, flagging mismatches (GET /reports/reconciliation). " +
			"match_status: OK | MISSING_INVOICE | MISSING_CUFE | AMOUNT_MISMATCH | MISSING_PAYMENT.",
		{
			date_from: z.string().describe("Range start (ISO 8601)"),
			date_to: z.string().describe("Range end (ISO 8601)"),
			match_status: z
				.enum([
					"OK",
					"MISSING_INVOICE",
					"MISSING_CUFE",
					"AMOUNT_MISMATCH",
					"MISSING_PAYMENT",
				])
				.optional(),
			provider: z.string().optional().describe("Proveedor de pago"),
			page: z.string().optional(),
			page_size: z.string().optional(),
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getReportsReconciliation({ query: { ...q, limit }, client: c }),
			),
	);

	const exportFilters = {
		event: z.string().optional(),
		eventDate: z.string().optional(),
		from: z.string().optional(),
		to: z.string().optional(),
		status: saleStatus.optional(),
	};
	uiTool(
		server,
		"settlements_list",
		"Workspace settlements — what FreeTicket pays the organizer, with amount, " +
			"status and event or date (GET /settlements). It carries hasDocument and " +
			"the file names; the PDF is fetched with `settlements_document`.",
		{
			event: z.string().optional().describe("Filter by event"),
			status: z
				.enum(["SENT", "AWAITING_PAYMENT", "PAID"])
				.optional()
				.describe("Settlement status"),
			...paging,
		},
		async (q) => run(getSettlements({ query: q, client })),
	);
	// getSettlementsIdDocument / getSettlementsIdProofsFileName: these do not
	// use the generated client (they are 302s to a signed URL), but they are
	// named here so the coverage.test.ts sweep counts them as covered.
	server.tool(
		"settlements_document",
		"Download link for a settlement PDF (GET /settlements/{id}/document). " +
			"Returns a signed URL that expires in 5 minutes — not the file.",
		{ id },
		async ({ id }) => signedDownload(creds, `/settlements/${id}/document`),
	);
	server.tool(
		"settlements_proof",
		"Download link for a settlement payment proof " +
			"(GET /settlements/{id}/proofs/{fileName}). The file name comes from " +
			"`settlements_list`. Signed URL, expires in 5 minutes.",
		{
			id,
			fileName: z
				.string()
				.describe("File name, exactly as the settlement lists it"),
		},
		async ({ id, fileName }) =>
			signedDownload(
				creds,
				`/settlements/${id}/proofs/${encodeURIComponent(fileName)}`,
			),
	);
	uiTool(
		server,
		"reports_financials",
		"Financial statement per date: gross, platform fee, face value, gateway " +
			"commission, the 4x1000 tax and the net to settle, plus the status of the " +
			"associated settlement (GET /reports/financials). These are the " +
			"authoritative numbers from the Settlements panel — there is no need to " +
			"recompute them by crossing /sales with Mercado Pago.",
		{
			event: z.string().optional().describe("Filter by event"),
			past: z
				.enum(["true", "false"])
				.optional()
				.describe("true = only dates that already happened (settleable)"),
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, q.limit, (c, limit) =>
				getReportsFinancials({ query: { ...q, limit }, client: c }),
			),
	);
	uiTool(
		server,
		"api_keys_list",
		"The user's service API keys — to audit which credentials exist and when " +
			"they were used (GET /api-keys). It never returns the secret. Minting and " +
			"revoking keys is done with the CLI (`ft api-keys`), not from here: an " +
			"agent should not be able to mint credentials.",
		{ ...paging },
		async (q) => run(getApiKeys({ query: q, client })),
	);

	// ── Headless SSO (enterprise integrations) ───────────────────────────────
	// These two speak on behalf of a buyer, not of the workspace: they demand an
	// enterprise service API key AND the session token the exchange returned
	// (POST /api/customer-auth/enterprise-exchange). The exchange is NOT exposed
	// as a tool: it mints third-party sessions — the same policy as api_keys and
	// admin tokens. With a normal key the API answers 403 and the agent sees it.
	const customerSession = z
		.string()
		.describe(
			"The buyer's session token (X-Customer-Session header), obtained from the " +
				"headless SSO exchange. Without it the API answers 401.",
		);
	server.tool(
		"customer_me",
		"Identity of the buyer authenticated through headless SSO (GET /customer/me). " +
			"Requires an enterprise service API key plus the buyer's session token.",
		{ customerSession },
		async ({ customerSession }) =>
			run(
				getCustomerMe({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	uiTool(
		server,
		"customer_tickets",
		"The buyer's tickets within the key's scope (GET /customer/tickets). Only " +
			"CONFIRMED sales of events the pinned workspace can read. Requires an " +
			"enterprise service API key plus the buyer's session token.",
		{ customerSession, ...paging },
		async ({ customerSession, ...q }) =>
			run(
				getCustomerTickets({
					query: q,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);

	server.tool(
		"reports_export_buyers",
		"Buyer export — one row per sale (GET /reports/exports/buyers).",
		exportFilters,
		async (q) => run(getReportsExportsBuyers({ query: q, client })),
	);
	server.tool(
		"reports_export_attendees",
		"Attendee export — one row per ticket (GET /reports/exports/attendees).",
		exportFilters,
		async (q) => run(getReportsExportsAttendees({ query: q, client })),
	);
	server.tool(
		"reports_export_subscribers",
		"Export de suscriptores (GET /reports/exports/subscribers).",
		async () => run(getReportsExportsSubscribers({ client })),
	);
	server.tool(
		"reports_export_reconciliation",
		"Reconciliation export for accounting (GET /reports/exports/reconciliation).",
		{
			date_from: z.string(),
			date_to: z.string(),
			match_status: z
				.enum([
					"OK",
					"MISSING_INVOICE",
					"MISSING_CUFE",
					"AMOUNT_MISMATCH",
					"MISSING_PAYMENT",
				])
				.optional(),
			provider: z.string().optional(),
		},
		async (q) => run(getReportsExportsReconciliation({ query: q, client })),
	);

	// ── Members area (contract 1.7.0) ────────────────────────────────────────
	// The same double credential as customer_me: an enterprise API key plus the
	// session of the buyer. With these the agent covers the members area of the
	// website: tickets, membership and profile.
	server.tool(
		"customer_ticket_get",
		"Detail of one ticket held by the buyer — a deep link from the list " +
			"(GET /customer/tickets/{id}).",
		{ id, customerSession },
		async ({ id, customerSession }) =>
			run(
				getCustomerTicketsId({
					path: { id },
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	uiTool(
		server,
		"customer_membership",
		"Membership status of the buyer in the workspace of the key: plan, " +
			"validity, and whether members-only content is visible " +
			"(GET /customer/membership).",
		{ customerSession },
		async ({ customerSession }) =>
			run(
				getCustomerMembership({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_profile",
		"Profile of the buyer — name and phone (GET /customer/profile).",
		{ customerSession },
		async ({ customerSession }) =>
			run(
				getCustomerProfile({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);

	// ── Organization content (contract 1.7.0) ────────────────────────────────
	// Published videos, feed and live streams. The lists do NOT carry the
	// playback id: to play anything you must request a token with
	// `content_playback_token`.
	uiTool(
		server,
		"content_videos",
		"Published, READY videos of the organization (GET /content/videos). To play " +
			"one, request a token with `content_playback_token`.",
		{ ...paging },
		async (q) => run(getContentVideos({ query: q, client })),
	);
	uiTool(
		server,
		"content_posts",
		"Community feed of the organization (GET /content/posts).",
		{ ...paging },
		async (q) => run(getContentPosts({ query: q, client })),
	);
	uiTool(
		server,
		"content_lives",
		"Live streams of the organization, with their status (GET /content/lives).",
		{ ...paging },
		async (q) => run(getContentLives({ query: q, client })),
	);
	server.tool(
		"content_live_get",
		"Status of one specific live stream (GET /content/lives/{id}).",
		{ id },
		async ({ id }) => run(getContentLivesId({ path: { id }, client })),
	);
}
