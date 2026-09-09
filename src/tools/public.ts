import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	getEvents,
	getEventsSlug,
	getEventsSlugAvailability,
	getOrdersId,
	postOrders,
	postTicketsCodeResend,
} from "../public-client/sdk.gen";
import { uiTool } from "../ui";

/**
 * Public B2C tools (/api/public) — no credentials. A buyer agent consumes
 * them: it discovers events, checks stock and resends its own ticket.
 * They are always registered (they do not depend on FT_API_KEY). The agent
 * never touches payment data: the human closes checkout at Mercado Pago.
 */
export function registerPublicTools(server: McpServer, client: Client): void {
	uiTool(
		server,
		"public_events_list",
		"Public catalogue of published events (GET /public/events). B2C discovery, no login.",
		{
			q: z.string().optional().describe("Búsqueda por nombre/descripción"),
			city: z.string().optional().describe("Filtrar por ciudad"),
			from: z.string().optional().describe("Dates from (ISO 8601)"),
			to: z.string().optional().describe("Funciones hasta (ISO 8601)"),
			page: z.string().optional().describe("Página (default 1)"),
			pageSize: z.string().optional().describe("Tamaño (default 20, máx 50)"),
			sort: z.enum(["date_asc", "price_asc", "price_desc"]).optional(),
		},
		async (q) => run(getEvents({ query: q, client })),
	);
	server.tool(
		"public_events_get",
		"Detalle público de un evento por slug (GET /public/events/{slug}).",
		{ slug: z.string().describe("Event slug") },
		async ({ slug }) => run(getEventsSlug({ path: { slug }, client })),
	);
	server.tool(
		"public_events_availability",
		"Live stock per date and ticket type (GET /public/events/{slug}/availability). Check it before building an order.",
		{ slug: z.string().describe("Event slug") },
		async ({ slug }) =>
			run(getEventsSlugAvailability({ path: { slug }, client })),
	);
	server.tool(
		"public_orders_create",
		"Creates a B2C order and returns the Mercado Pago payment link (POST /public/orders). " +
			"The agent NEVER processes the payment: it hands the `checkoutUrl` to the buyer to pay. " +
			"General admission only (not seated, not members-only) from a single organizer. " +
			"Check stock with public_events_availability first.",
		{
			buyerEmail: z.string().email().describe("Buyer email (receives the QR)"),
			buyerName: z.string().min(1).describe("Buyer name"),
			buyerPhone: z.string().optional(),
			items: z
				.array(
					z.object({
						ticketTypeId: z.string(),
						quantity: z.number().int().positive().max(50),
					}),
				)
				.min(1)
				.describe("Tipos de ticket y cantidades"),
		},
		{ destructiveHint: false, idempotentHint: false },
		async (body) => run(postOrders({ body, client })),
	);
	server.tool(
		"public_orders_get",
		"Status of a B2C order — pending | paid | expired | cancelled — plus the tickets once paid (GET /public/orders/{id}).",
		{
			id: z.string().describe("Order id (returned by public_orders_create)"),
		},
		async ({ id }) => run(getOrdersId({ path: { id }, client })),
	);
	server.tool(
		"public_tickets_resend",
		"Resends a ticket QR and email to the buyer address (POST /public/tickets/{code}/resend). Rate limited; the email always goes to the original address of the purchase.",
		{
			code: z.string().describe("Ticket code"),
			email: z
				.string()
				.email()
				.optional()
				.describe("Optional: must match the buyer email"),
		},
		async ({ code, email }) =>
			run(
				postTicketsCodeResend({
					path: { code },
					body: email ? { email } : {},
					client,
				}),
			),
	);
}
