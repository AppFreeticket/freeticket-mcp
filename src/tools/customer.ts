import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	getCustomerMe,
	getCustomerMembership,
	getCustomerOrders,
	getCustomerOrdersId,
	getCustomerProfile,
	getCustomerTickets,
	getCustomerTicketsId,
	patchCustomerProfile,
	postCustomerLogout,
	postCustomerOrdersIdRelease,
	postCustomerSubscriptions,
	postCustomerSubscriptionsCancel,
	postCustomerTicketsIdCancel,
} from "../client/sdk.gen";
import { read, write } from "../tool-meta";
import { uiTool } from "../ui";

const CONFIRM = " ⚠️ Irreversible: confirm with the human before running it.";
const paging = {
	limit: z.string().optional().describe("Results per page (1-100)"),
	cursor: z.string().optional().describe("Pagination cursor"),
};

/**
 * The buyer layer (customer_*): /api/v1/customer/* on behalf of ONE buyer.
 *
 * The buyer session is a credential of the connection (`creds.customerSession`
 * → the client's `X-Customer-Session` header), never a tool argument: the
 * token must not pass through the model context, where it could be echoed,
 * logged by the host or exfiltrated by a prompt injection. It comes from the
 * `X-Customer-Session` request header over HTTP, or FT_CUSTOMER_SESSION over
 * stdio. The exchange that mints it (enterprise-exchange / buyer OTP) is not a
 * tool, for the same reason.
 *
 * The client carries NO B2B API key (see makeCustomerClient): the key is
 * optional on these routes, and without it they answer for the buyer across
 * every workspace.
 */
export function registerCustomerTools(server: McpServer, client: Client): void {
	server.tool(
		"customer_me",
		"Identity of the buyer this connection is signed in as (GET /customer/me), " +
			"with the session expiry.",
		{},
		read("customer_me"),
		async () => run(getCustomerMe({ client })),
	);
	uiTool(
		server,
		"customer_tickets",
		"The buyer's tickets — CONFIRMED sales only, across every workspace " +
			"(GET /customer/tickets).",
		{ ...paging },
		async (q) => run(getCustomerTickets({ query: q, client })),
	);
	server.tool(
		"customer_ticket_get",
		"Detail of one ticket held by the buyer — a deep link from the list " +
			"(GET /customer/tickets/{id}).",
		{ id: z.string().describe("Sale id or reference (FT-…)") },
		read("customer_ticket_get"),
		async ({ id }) => run(getCustomerTicketsId({ path: { id }, client })),
	);
	uiTool(
		server,
		"customer_membership",
		"Membership status of the buyer in one workspace: plan, validity, and " +
			"whether members-only content is visible (GET /customer/membership).",
		{
			workspaceId: z
				.string()
				.min(1)
				.describe("Workspace whose membership to read"),
		},
		async (q) => run(getCustomerMembership({ query: q, client })),
	);
	server.tool(
		"customer_profile",
		"Profile of the buyer — name and phone (GET /customer/profile).",
		{},
		read("customer_profile"),
		async () => run(getCustomerProfile({ client })),
	);
	server.tool(
		"customer_order_pending",
		"The buyer's PENDING order whose hold is still alive — seats, total and " +
			"expiry — or `order: null` (GET /customer/orders). Lets a purchase be " +
			"resumed instead of started over.",
		{ eventDateId: z.string().optional().describe("Filter by event date") },
		read("customer_order_pending"),
		async (q) => run(getCustomerOrders({ query: q, client })),
	);
	server.tool(
		"customer_order_get",
		"Status of one of the buyer's orders: `approved`, `pending` (normal for " +
			"async payments, retry later) or `rejected`; `tickets` only when " +
			"approved (GET /customer/orders/{id}).",
		{ id: z.string().describe("Sale id or reference (FT-…)") },
		read("customer_order_get"),
		async ({ id }) => run(getCustomerOrdersId({ path: { id }, client })),
	);

	// ── Writes ───────────────────────────────────────────────────────────────
	server.tool(
		"customer_ticket_cancel",
		`Cancels a purchase made by the buyer, only while it is still unpaid (POST /customer/tickets/{id}/cancel).${CONFIRM}`,
		{ id: z.string().describe("Ticket id") },
		write("customer_ticket_cancel", { destructive: true }),
		async ({ id }) =>
			run(postCustomerTicketsIdCancel({ path: { id }, client })),
	);
	server.tool(
		"customer_subscribe",
		"Starts a membership subscription and returns the payment URL — the agent " +
			"never handles the charge (POST /customer/subscriptions).",
		{ planId: z.string().describe("Id of an active membership plan") },
		write("customer_subscribe", { destructive: false }),
		async (body) => run(postCustomerSubscriptions({ body, client })),
	);
	server.tool(
		"customer_subscription_cancel",
		`Cancels the membership held by the buyer in one workspace (POST /customer/subscriptions/cancel).${CONFIRM}`,
		{
			workspaceId: z
				.string()
				.min(1)
				.describe("Workspace whose membership to cancel"),
		},
		// openWorld: cancels the recurring charge in Stripe / Mercado Pago.
		write("customer_subscription_cancel", {
			destructive: true,
			openWorld: true,
		}),
		async (body) => run(postCustomerSubscriptionsCancel({ body, client })),
	);
	server.tool(
		"customer_order_release",
		"Abandons the buyer's PENDING order and returns its stock and seats, so " +
			"they can start over (POST /customer/orders/{id}/release). Refuses with " +
			`409 \`payment_in_flight\` if a payment was already started.${CONFIRM}`,
		{ id: z.string().describe("Sale id or reference (FT-…)") },
		write("customer_order_release", { destructive: true }),
		async ({ id }) =>
			run(postCustomerOrdersIdRelease({ path: { id }, client })),
	);
	server.tool(
		"customer_profile_update",
		"Edits the buyer profile: name and phone (PATCH /customer/profile). " +
			"A null or empty phone clears it.",
		{
			name: z.string().min(1).max(120).optional(),
			phone: z.string().max(30).nullish(),
		},
		write("customer_profile_update", { destructive: false }),
		async (body) => run(patchCustomerProfile({ body, client })),
	);
	server.tool(
		"customer_logout",
		"Revokes the buyer session this connection carries (POST /customer/logout). " +
			"After it, every customer_* tool answers 401.",
		{},
		write("customer_logout", { destructive: false }),
		async () => run(postCustomerLogout({ client })),
	);
}
