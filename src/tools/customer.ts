import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	deleteCustomerAddressesId,
	getCustomerAddresses,
	getCustomerMe,
	getCustomerMembership,
	getCustomerOrders,
	getCustomerOrdersId,
	getCustomerProfile,
	getCustomerTickets,
	getCustomerTicketsId,
	patchCustomerAddressesId,
	patchCustomerProfile,
	postCustomerAddresses,
	postCustomerLogout,
	postCustomerOrdersIdRelease,
	postCustomerSubscriptions,
	postCustomerSubscriptionsCancel,
	postCustomerTicketsIdCancel,
} from "../client/sdk.gen";
import { read, write } from "../tool-meta";
import { uiTool } from "../ui";
import { limitParam } from "../views";

const CONFIRM = " ⚠️ Irreversible: confirm with the human before running it.";
/**
 * The 1.39+ routes declare `X-Customer-Session` as a required header, so the
 * generated types ask for it per call. The client already sends it
 * (makeCustomerClient); this empty object only satisfies the type and never
 * overrides the client's header.
 */
const SESSION = { headers: {} as { "X-Customer-Session": string } };

const paging = {
	limit: limitParam,
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

	uiTool(
		server,
		"customer_addresses_list",
		"The buyer's saved shipping addresses, at most 10, the default first " +
			"(GET /customer/addresses). The address book belongs to the buyer's " +
			"FreeTicket account and is shared across brands. Colombia only: " +
			"department and city are DANE codes (Bogotá = `11` / `11001`).",
		{},
		async () => run(getCustomerAddresses({ ...SESSION, client })),
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

	// ── Buyer address book (contract 1.39+) ──────────────────────────────────
	// Shared across brands: it belongs to the buyer's FreeTicket account, so
	// the buyer session alone edits the same book (no B2B key is sent).
	const ADDRESS_NOTE =
		" Colombia only: `departmentCode` is the 2-digit DANE department and " +
		"`cityCode` the 5-digit DANE city that starts with it (Bogotá = `11` / " +
		"`11001`); 422 when the city does not belong to the department. The buyer " +
		"session comes from the connection.";
	const addressFields = {
		label: z
			.string()
			.max(60)
			.nullish()
			.describe("Short name, e.g. `Casa`; null or empty clears it"),
		recipientName: z.string().min(2).max(120),
		phone: z
			.string()
			.regex(/^\+?[0-9 -]{7,20}$/)
			.nullish()
			.describe("Recipient phone; null or empty clears it"),
		departmentCode: z.string().regex(/^\d{2}$/),
		cityCode: z.string().regex(/^\d{5}$/),
		address: z.string().min(5).max(200),
		addressExtra: z
			.string()
			.max(200)
			.nullish()
			.describe("Apartment, tower…; null or empty clears it"),
	};
	server.tool(
		"customer_addresses_create",
		"Saves a shipping address for the buyer (POST /customer/addresses). At " +
			"most 10 per buyer (409 `ADDRESS_LIMIT`). The first address is always " +
			"the default; `isDefault: true` makes the new one the default and " +
			`clears the previous one.${ADDRESS_NOTE}`,
		{
			...addressFields,
			isDefault: z.boolean().optional().describe("Make it the default address"),
		},
		write("customer_addresses_create", { destructive: false }),
		async (body) =>
			run(
				postCustomerAddresses({
					...SESSION,
					body,
					client,
				}),
			),
	);
	server.tool(
		"customer_addresses_update",
		"Partially updates one of the buyer's addresses; omitted fields are left " +
			"untouched (PATCH /customer/addresses/{id}). `isDefault: false` on the " +
			"default moves the default to the most recent other address. Another " +
			`buyer's address answers 404 \`ADDRESS_NOT_FOUND\`.${ADDRESS_NOTE}`,
		{
			id: z.string().describe("Address id"),
			label: addressFields.label,
			recipientName: addressFields.recipientName.optional(),
			phone: addressFields.phone,
			departmentCode: addressFields.departmentCode.optional(),
			cityCode: addressFields.cityCode.optional(),
			address: addressFields.address.optional(),
			addressExtra: addressFields.addressExtra,
			isDefault: z
				.boolean()
				.optional()
				.describe("true makes it the default; false hands the default on"),
		},
		write("customer_addresses_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(
				patchCustomerAddressesId({
					...SESSION,
					path: { id },
					body,
					client,
				}),
			),
	);
	server.tool(
		"customer_addresses_delete",
		"Deletes one of the buyer's addresses (DELETE /customer/addresses/{id}); " +
			"deleting the default promotes the most recent remaining one. Another " +
			`buyer's address answers 404 \`ADDRESS_NOT_FOUND\`.${CONFIRM}`,
		{ id: z.string().describe("Address id") },
		write("customer_addresses_delete", { destructive: true }),
		async ({ id }) =>
			run(
				deleteCustomerAddressesId({
					...SESSION,
					path: { id },
					client,
				}),
			),
	);
}
