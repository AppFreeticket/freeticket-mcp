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
 * Tools públicos B2C (/api/public) — sin credenciales. Los consume el agente de
 * un comprador: descubre eventos, consulta stock y reenvía su propio ticket.
 * Se registran siempre (no dependen de FT_API_KEY). El agente nunca toca datos
 * de pago: el checkout lo cierra el humano en Mercado Pago.
 */
export function registerPublicTools(server: McpServer, client: Client): void {
	uiTool(
		server,
		"public_events_list",
		"Catálogo público de eventos publicados (GET /public/events). Descubrimiento B2C, sin login.",
		{
			q: z.string().optional().describe("Búsqueda por nombre/descripción"),
			city: z.string().optional().describe("Filtrar por ciudad"),
			from: z.string().optional().describe("Funciones desde (ISO 8601)"),
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
		{ slug: z.string().describe("Slug del evento") },
		async ({ slug }) => run(getEventsSlug({ path: { slug }, client })),
	);
	server.tool(
		"public_events_availability",
		"Stock en vivo por fecha y tipo de ticket (GET /public/events/{slug}/availability). Consultar antes de armar una orden.",
		{ slug: z.string().describe("Slug del evento") },
		async ({ slug }) =>
			run(getEventsSlugAvailability({ path: { slug }, client })),
	);
	server.tool(
		"public_orders_create",
		"Crea una orden B2C y devuelve el link de pago de Mercado Pago (POST /public/orders). " +
			"El agente NUNCA procesa el pago: entrega la `checkoutUrl` al comprador para que pague. " +
			"Solo admisión general (no numerado / no members-only) de un mismo organizador. " +
			"Consultá el stock con public_events_availability antes.",
		{
			buyerEmail: z
				.string()
				.email()
				.describe("Correo del comprador (recibe el QR)"),
			buyerName: z.string().min(1).describe("Nombre del comprador"),
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
		"Estado de una orden B2C — pending | paid | expired | cancelled — y los tickets al pagar (GET /public/orders/{id}).",
		{
			id: z
				.string()
				.describe("Id de la orden (devuelto por public_orders_create)"),
		},
		async ({ id }) => run(getOrdersId({ path: { id }, client })),
	);
	server.tool(
		"public_tickets_resend",
		"Reenvía el QR/email de un ticket al correo del comprador (POST /public/tickets/{code}/resend). Rate-limited; el email va siempre al correo original de la compra.",
		{
			code: z.string().describe("Código del ticket"),
			email: z
				.string()
				.email()
				.optional()
				.describe("Opcional: debe coincidir con el correo del comprador"),
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
