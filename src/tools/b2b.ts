import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Creds, makeB2bClient, run } from "../api";
import {
	getApiKeys,
	getArtists,
	getContentChannels,
	getContentLives,
	getContentLivesId,
	getContentLivesIdChat,
	getContentMeetups,
	getContentMeetupsId,
	getContentModerationBans,
	getContentModerationMemberPosts,
	getContentModerationQueue,
	getContentPosts,
	getContentSeries,
	getContentVideos,
	getCustomerMe,
	getCustomerMembership,
	getCustomerOrders,
	getCustomerOrdersId,
	getCustomerProfile,
	getCustomerTickets,
	getCustomerTicketsId,
	getDiscounts,
	getEventDatesIdAccessClose,
	getEventDatesIdCourtesySeats,
	getEvents,
	getEventsId,
	getEventsIdArtistInvitations,
	getEventsIdDates,
	getEventsIdValidators,
	getEventsIdViewers,
	getMasterQrs,
	getMe,
	getMembershipPlans,
	getMembershipPlansId,
	getMembershipPlansIdSubscribers,
	getMerchCatalog,
	getOrganizationProfile,
	getPaymentIntents,
	getProducts,
	getProductsId,
	getReportsByEvent,
	getReportsExportsAttendees,
	getReportsExportsBuyers,
	getReportsExportsReconciliation,
	getReportsExportsSubscribers,
	getReportsFinancials,
	getReportsInventory,
	getReportsLiveAttendance,
	getReportsReconciliation,
	getReportsSummary,
	getReportsTimeseries,
	getSales,
	getSalesId,
	getSalesIdAttempts,
	getSalesIdTickets,
	getSettlements,
	getSettlementsId,
	getStaff,
	getStaffId,
	getTicketsTicketCodeAccess,
	getTicketTemplates,
	getTicketTypes,
	getTicketTypesId,
	getTicketTypesIdPresaleWindows,
	getVenues,
	getVenuesId,
	getWaitlist,
	getWebhooks,
	getWebsite,
	postMerchOrdersLookup,
} from "../client/sdk.gen";
import { read } from "../tool-meta";
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
		read("whoami"),
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
		read("events_get"),
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
		read("ticket_types_get"),
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
		read("sales_get"),
		async ({ id }) => run(getSalesId({ path: { id }, client })),
	);
	server.tool(
		"sales_tickets",
		"Individual tickets and attendees of a sale (GET /sales/{id}/tickets).",
		{ id: z.string().describe("Sale id") },
		read("sales_tickets"),
		async ({ id }) => run(getSalesIdTickets({ path: { id }, client })),
	);
	server.tool(
		"sales_attempts",
		"Payment attempt history of a sale, newest first — approved, declined or " +
			"refunded at the gateway (GET /sales/{id}/attempts). Answers \"why didn't " +
			'this sale go through?".',
		{ id: z.string().describe("Sale id") },
		read("sales_attempts"),
		async ({ id }) => run(getSalesIdAttempts({ path: { id }, client })),
	);
	server.tool(
		"tickets_access",
		"Estado de acceso de un ticket por su código QR — no admite, solo consulta (GET /tickets/{code}/access).",
		{ code: z.string().describe("Ticket QR code") },
		read("tickets_access"),
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
		read("plans_get"),
		async ({ id }) => run(getMembershipPlansId({ path: { id }, client })),
	);
	server.tool(
		"plans_subscribers",
		"Suscriptores/miembros de un plan (GET /membership-plans/{id}/subscribers).",
		{ id: z.string().describe("Plan id") },
		read("plans_subscribers"),
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
		read("venues_get"),
		async ({ id }) => run(getVenuesId({ path: { id }, client })),
	);
	server.tool(
		"staff_get",
		"Detail of one staff member (GET /staff/{id}).",
		{ id: z.string().describe("Member id") },
		read("staff_get"),
		async ({ id }) => run(getStaffId({ path: { id }, client })),
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
	server.tool(
		"settlements_get",
		"Detail of one settlement (GET /settlements/{id}). Files via " +
			"`settlements_document` and `settlements_proof`.",
		{ id },
		read("settlements_get"),
		async ({ id }) => run(getSettlementsId({ path: { id }, client })),
	);
	// getSettlementsIdDocument / getSettlementsIdProofsFileName: these do not
	// use the generated client (they are 302s to a signed URL), but they are
	// named here so the coverage.test.ts sweep counts them as covered.
	server.tool(
		"settlements_document",
		"Download link for a settlement PDF (GET /settlements/{id}/document). " +
			"Returns a signed URL that expires in 5 minutes — not the file.",
		{ id },
		read("settlements_document"),
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
		read("settlements_proof"),
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
		read("customer_me"),
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
		read("reports_export_buyers"),
		async (q) => run(getReportsExportsBuyers({ query: q, client })),
	);
	server.tool(
		"reports_export_attendees",
		"Attendee export — one row per ticket (GET /reports/exports/attendees).",
		exportFilters,
		read("reports_export_attendees"),
		async (q) => run(getReportsExportsAttendees({ query: q, client })),
	);
	server.tool(
		"reports_export_subscribers",
		"Export de suscriptores (GET /reports/exports/subscribers).",
		read("reports_export_subscribers"),
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
		read("reports_export_reconciliation"),
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
		read("customer_ticket_get"),
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
		read("customer_profile"),
		async ({ customerSession }) =>
			run(
				getCustomerProfile({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);

	server.tool(
		"customer_order_pending",
		"The buyer's PENDING order whose hold is still alive — seats, total and " +
			"expiry — or `order: null` (GET /customer/orders). Lets a purchase be " +
			"resumed instead of started over.",
		{
			eventDateId: z.string().optional().describe("Filter by event date"),
			customerSession,
		},
		read("customer_order_pending"),
		async ({ customerSession, ...q }) =>
			run(
				getCustomerOrders({
					query: q,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_order_get",
		"Status of one of the buyer's orders: `approved`, `pending` (normal for " +
			"async payments, retry later) or `rejected`; `tickets` only when " +
			"approved (GET /customer/orders/{id}).",
		{
			id: z.string().describe("Sale id or reference (FT-…)"),
			customerSession,
		},
		read("customer_order_get"),
		async ({ id, customerSession }) =>
			run(
				getCustomerOrdersId({
					path: { id },
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
		read("content_live_get"),
		async ({ id }) => run(getContentLivesId({ path: { id }, client })),
	);

	// ── Contract 1.21–1.27 ───────────────────────────────────────────────────
	uiTool(
		server,
		"artists_search",
		"Searches artist workspaces registered on FreeTicket by name — public " +
			"brand data only (GET /artists). Feed the `id` to `events_artists_set`; " +
			"artists without an account are invited by email there.",
		{
			q: z.string().min(2).max(100).describe("Name to search (2-100 chars)"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Results per page (1-100, default 20)"),
			cursor: z.string().optional().describe("Pagination cursor"),
		},
		async (q) => run(getArtists({ query: q, client })),
	);
	uiTool(
		server,
		"event_artist_invitations_list",
		"Pending and expired invitations sent to artists without an account for " +
			"an event, newest first (GET /events/{id}/artist-invitations). Accepted " +
			"ones are already in the lineup and are not listed. They expire 14 " +
			"days after being sent.",
		{ eventId: z.string().describe("Event id") },
		async ({ eventId }) =>
			run(getEventsIdArtistInvitations({ path: { id: eventId }, client })),
	);
	uiTool(
		server,
		"presale_windows_list",
		"Presale windows of a ticket type — which membership plan can buy it " +
			"early, between which instants and with what cap " +
			"(GET /ticket-types/{id}/presale-windows).",
		{ ticketTypeId: z.string().describe("Ticket type id") },
		async ({ ticketTypeId }) =>
			run(
				getTicketTypesIdPresaleWindows({ path: { id: ticketTypeId }, client }),
			),
	);
	uiTool(
		server,
		"waitlist_list",
		"Per-city waitlist entries of the workspace's landing, newest first " +
			"(GET /waitlist). Contains personal data (name and contact): the API " +
			"requires ADMIN.",
		{
			city: z
				.string()
				.optional()
				.describe("Filter by city; accents and case are ignored"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Results per page (1-100, default 20)"),
			cursor: z.string().optional().describe("Pagination cursor"),
		},
		async (q) => run(getWaitlist({ query: q, client })),
	);

	// ── Contract 1.28–1.29: show day ─────────────────────────────────────────
	uiTool(
		server,
		"reports_live_attendance",
		"Event dates happening right now, with check-in progress: `sold`, " +
			"`validated` and `validatedPct` (0-100), sorted by `sold` " +
			"(GET /reports/live-attendance). Includes hosted shows in the " +
			"workspace's venues (occupancy only). Meant for polling during a show.",
		{
			scope: z
				.string()
				.optional()
				.describe(
					"`all` (default), `own` (only the workspace's own shows) or " +
						"`partner:<orgId>` (shows shared with that partner)",
				),
		},
		async (q) => run(getReportsLiveAttendance({ query: q, client })),
	);
	server.tool(
		"event_dates_access_close_status",
		"Live entry count and access-close status of an event date " +
			"(GET /event-dates/{id}/access-close): `live.issued`, `live.checkins` " +
			"(what a signature would freeze right now) and, once closed, " +
			"`closedCheckins`. Read this before `event_dates_access_close_sign`.",
		{ id: z.string().describe("Event date id") },
		read("event_dates_access_close_status"),
		async ({ id }) => run(getEventDatesIdAccessClose({ path: { id }, client })),
	);
	uiTool(
		server,
		"sales_payment_intents",
		"Purchase intents of ONE event — the checkout funnel folded into one " +
			"journey per visitor, with `stage` and `outcome` (`NO_SALE`, " +
			"`REJECTED` with `reason`, or the sale status) (GET /payment-intents). " +
			"`funnel` counts every journey of the filter. Use it to find stuck " +
			"or abandoned payments. Contains buyer name and email.",
		{
			event: z.string().describe("Event id"),
			eventDate: z
				.string()
				.optional()
				.describe("Event date id (must belong to the event)"),
			onlyAbandoned: z
				.boolean()
				.optional()
				.describe("true = only journeys that picked seats and did not pay"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Results per page (1-100, default 100)"),
			cursor: z
				.string()
				.optional()
				.describe("`nextCursor` of the previous page"),
		},
		async (q) => run(getPaymentIntents({ query: q, client })),
	);

	// ── Community (contract 1.29) ────────────────────────────────────────────
	// Channels, moderation and meetups. Every one needs Content in the plan
	// (403 `FEATURE_LOCKED`) and the community enabled (403
	// `COMMUNITY_UNAVAILABLE`); an event-scoped key gets 403.
	uiTool(
		server,
		"content_channels_list",
		"Active community channels in display order (GET /content/channels). " +
			"Creates the default Announcements and General channels on first read " +
			"if the workspace has none.",
		{},
		async () => run(getContentChannels({ client })),
	);
	const page0 = z
		.number()
		.int()
		.min(0)
		.optional()
		.describe("0-based page; an empty array means no more pages");
	uiTool(
		server,
		"content_moderation_queue",
		"Reported community comments, most reported first, including " +
			"auto-hidden and deleted ones with open reports " +
			"(GET /content/moderation/queue). 50 per page. Act with " +
			"`content_comments_hide`, `content_comments_ignore_reports`, " +
			"`content_comments_delete` or `content_members_ban`.",
		{ page: page0 },
		async (q) => run(getContentModerationQueue({ query: q, client })),
	);
	uiTool(
		server,
		"content_moderation_bans",
		"Members banned from the community, the latest 200, newest first " +
			"(GET /content/moderation/bans). Lift one with `content_members_unban`.",
		{},
		async () => run(getContentModerationBans({ client })),
	);
	uiTool(
		server,
		"content_member_posts_list",
		"Member posts awaiting review (`PENDING_REVIEW`, default: oldest first, " +
			"30 per page) or the latest 30 published (`PUBLISHED`, no paging) " +
			"(GET /content/moderation/member-posts). Approving needs the " +
			"`updatedAt` read here.",
		{
			status: z
				.enum(["PENDING_REVIEW", "PUBLISHED"])
				.optional()
				.describe("PENDING_REVIEW (default) or PUBLISHED"),
			page: page0.describe("0-based page (PENDING_REVIEW only)"),
		},
		async (q) => run(getContentModerationMemberPosts({ query: q, client })),
	);
	uiTool(
		server,
		"content_meetups_list",
		"Community meetups, the latest 100 by start date, any status, with " +
			"confirmed and pending-request counts (GET /content/meetups).",
		{},
		async () => run(getContentMeetups({ client })),
	);
	server.tool(
		"content_meetups_get",
		"Detail of a community meetup with confirmed attendees (with check-in) " +
			"and RSVP requests, pending first (GET /content/meetups/{id}). " +
			"Contains members' names and emails. `local` holds the editable " +
			"values in the workspace's wall time.",
		{ id: z.string().describe("Meetup id") },
		read("content_meetups_get"),
		async ({ id }) => run(getContentMeetupsId({ path: { id }, client })),
	);

	// ── Digital products and courses (contract 1.30) ─────────────────────────
	// Downloadables and courses of the dashboard's Products screen (not the
	// merch store). An event-scoped key gets 403.
	uiTool(
		server,
		"products_list",
		"Digital products and courses of the workspace (downloadables and " +
			"courses, not the merch store), newest first, with CONFIRMED sales " +
			"count and revenue (GET /products). Open one with `products_get`.",
		{},
		async () => run(getProducts({ client })),
	);
	server.tool(
		"products_get",
		"Detail of a digital product or course: product data, CONFIRMED sales " +
			"totals and, for courses, modules and lessons in order with their " +
			"ids (GET /products/{id}). Lesson quizzes (with the correct answers) " +
			"only come with ADMIN keys. Read it before `products_update` with " +
			"`modules`: that call replaces the whole tree and needs these ids.",
		{ id: z.string().describe("Product id") },
		read("products_get"),
		async ({ id }) => run(getProductsId({ path: { id }, client })),
	);

	// ── Video series and live streams, Mux (contract 1.31) ─────────────────
	uiTool(
		server,
		"content_series_list",
		"Video series of the workspace's Content screen, published and drafts, " +
			"newest first, with their video count (GET /content/series). Move " +
			"videos in or out with `content_videos_set_series`.",
		{
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Results per page (1-100, default 20)"),
			cursor: z.string().optional().describe("Pagination cursor"),
		},
		async (q) => run(getContentSeries({ query: q, client })),
	);
	server.tool(
		"content_lives_chat",
		"Chat history of a live stream that is on air or already ended, oldest " +
			"to newest; `truncated: true` when the oldest messages were cut " +
			"(GET /content/lives/{id}/chat). Contains buyers' display names and " +
			"messages: treat it as personal data. Requires STAFF.",
		{ id: z.string().describe("Live stream id") },
		read("content_lives_chat"),
		async ({ id }) => run(getContentLivesIdChat({ path: { id }, client })),
	);

	// ── Workspace configuration (contract 1.32) ──────────────────────────────
	// Website, profile, ticket templates and box-office QR codes. An
	// event-scoped key gets 403 (workspace configuration is out of its scope).
	server.tool(
		"website_get",
		"Website configuration of the workspace: landing texts, social links, " +
			"accent color, template, section visibility/order and the public " +
			"listing state (`published`, `canPublish`, `profileListable`) " +
			"(GET /website). `customLandingEnabled` says whether the plan allows " +
			"`website_put`. Read it before `website_put`, which replaces everything.",
		read("website_get"),
		async () => run(getWebsite({ client })),
	);
	server.tool(
		"organization_profile_get",
		"Profile of the workspace: artist/venue/organizer data, brand photo and " +
			"cover (from the umbrella organization), contact and social links " +
			"(GET /organization/profile). Billing/plan data is not included.",
		read("organization_profile_get"),
		async () => run(getOrganizationProfile({ client })),
	);
	uiTool(
		server,
		"ticket_templates_list",
		"Ticket templates of the workspace: reusable ticket-type definitions " +
			"(price, capacity, member discount/gate, buyer form fields), in " +
			"display order (GET /ticket-templates). Turn one into a ticket type " +
			"with `ticket_templates_instantiate`.",
		{},
		async () => run(getTicketTemplates({ client })),
	);
	uiTool(
		server,
		"master_qrs_list",
		"Master box-office QR codes of the workspace, newest first, with scan " +
			"counters (GET /master-qrs). Requires ADMIN, also for reading. " +
			"🔒 SECRET: `code` and `url` are what the printed QR encodes and open " +
			"the sale flow; they cannot be rotated. Do not echo them into the " +
			"chat or any doc unless the human explicitly asks, and never paste " +
			"them in shared places; refer to a QR by `id`/`label`.",
		{},
		async () => run(getMasterQrs({ client })),
	);

	// ── Contract 1.33–1.36: event access, courtesy seats, merch store ────────
	uiTool(
		server,
		"events_viewers_list",
		"People with read-only access to one event's statistics (they see only " +
			"its stats, nothing else of the workspace), newest first " +
			"(GET /events/{id}/viewers). Requires ADMIN. Revoke one with " +
			"`events_viewers_delete` using the access `id` returned here.",
		{ eventId: z.string().describe("Event id") },
		async ({ eventId }) =>
			run(getEventsIdViewers({ path: { id: eventId }, client })),
	);
	uiTool(
		server,
		"events_validators_list",
		"Door staff who can validate tickets for one event: the ones assigned " +
			"to it plus those with no events assigned (`allEvents: true`), " +
			"inactive ones included (GET /events/{id}/validators). Requires ADMIN.",
		{ eventId: z.string().describe("Event id") },
		async ({ eventId }) =>
			run(getEventsIdValidators({ path: { id: eventId }, client })),
	);
	server.tool(
		"event_dates_courtesy_seats",
		"Seats of a numbered (seats.io) event date that are blocked on the map " +
			"without an order and free to be issued as courtesies, grouped by " +
			"numbered ticket type (GET /event-dates/{id}/courtesy-seats). A date " +
			"without a seat map answers `ticketTypes: []`. 503 " +
			"SEATSIO_UNAVAILABLE is retryable. Requires ADMIN.",
		{ id: z.string().describe("Event date id") },
		read("event_dates_courtesy_seats"),
		async ({ id }) =>
			run(getEventDatesIdCourtesySeats({ path: { id }, client })),
	);
	server.tool(
		"merch_catalog",
		"Merch store catalog of the key's brand (GET /merch/catalog): store " +
			"settings, shipping fees by zone, published products with active " +
			"variants and live `stock`, and pickup points. Prices are COP integers, " +
			"VAT included. Requires an enterprise service API key. 403 " +
			"MERCH_STORE_LOCKED without an active Legend plan; 404 STORE_NOT_READY " +
			"without a ready store. Placing and paying orders is not a tool: it " +
			"needs the buyer's ID document and the card widget on the landing.",
		read("merch_catalog"),
		async () => run(getMerchCatalog({ client })),
	);
	server.tool(
		"merch_orders_lookup",
		"Status of one of the session buyer's merch orders by its public code, " +
			"e.g. `M-7K3Q9ZTA` (POST /merch/orders/lookup — a POST, but it only " +
			"reads). Requires an enterprise service API key and the buyer session. " +
			"Unknown code, another brand's or another buyer's order: all 404 " +
			"ORDER_NOT_FOUND. The buyer document is never returned.",
		{
			code: z.string().min(3).max(20).describe("Public order code"),
			customerSession,
		},
		read("merch_orders_lookup"),
		async ({ code, customerSession }) =>
			run(
				postMerchOrdersLookup({
					body: { code },
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
}
