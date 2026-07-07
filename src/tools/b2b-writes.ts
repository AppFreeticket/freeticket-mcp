import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	deleteDiscountsId,
	deleteEventsId,
	deleteEventsIdDatesDateId,
	deleteMembershipPlansId,
	deleteTicketTypesId,
	deleteVenuesId,
	deleteWebhooksId,
	patchDiscountsId,
	patchEventsId,
	patchStaffIdRole,
	postDiscounts,
	postEvents,
	postEventsIdPublish,
	postMembershipPlans,
	postSales,
	postSalesIdCancel,
	postSalesIdRefund,
	postStaff,
	postSubscriptionsIdCancel,
	postTicketsTicketCodeCheckin,
	postTicketsTicketCodeResend,
	postTicketTypes,
	postVenues,
	postWebhooks,
} from "../client/sdk.gen";

/** Deletes/refunds/cancels: irreversibles. Piden confirmación humana explícita. */
const destructive = { destructiveHint: true, idempotentHint: false } as const;
/** Creates/publish: no borran datos, pero mutan. */
const mutating = { destructiveHint: false, idempotentHint: false } as const;
/** Recuérdaselo al agente en la descripción, no solo en la annotation. */
const CONFIRM = " ⚠️ Irreversible: confirmá con el humano antes de ejecutar.";

/**
 * Ola B: writes del contrato B2B /api/v1 (un tool = un operationId).
 *
 * Fuera de esta ola por hueco de contrato (el spec no declara requestBody, no se
 * inventa — ver CONTRACT-GAPS.md): event_dates_create/update, ticket_types_update,
 * plans_update, venues_update. Se piden en free-admin vía endpoint-requester.
 */
export function registerB2bWriteTools(server: McpServer, client: Client): void {
	// ── Eventos ──────────────────────────────────────────────────────────────
	server.tool(
		"events_create",
		"Crea un evento con sus fechas (POST /events).",
		{
			name: z.string().describe("Nombre del evento"),
			slug: z.string().describe("Slug único (URL-friendly)"),
			description: z.string().optional(),
			venueId: z.string().nullish().describe("Id del venue"),
			dates: z
				.array(
					z.object({
						startsAt: z.string().describe("Inicio (ISO 8601)"),
						endsAt: z.string().nullish().describe("Fin (ISO 8601)"),
						timezone: z.string().describe("Ej: America/Bogota"),
					}),
				)
				.describe("Al menos una fecha/función"),
		},
		mutating,
		async (body) => run(postEvents({ body, client })),
	);
	server.tool(
		"events_update",
		"Actualiza campos de un evento (PATCH /events/{id}).",
		{
			id: z.string().describe("Id del evento"),
			name: z.string().optional(),
			description: z.string().nullish(),
			venueId: z.string().nullish(),
			coverImageUrl: z.string().nullish(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchEventsId({ path: { id }, body, client })),
	);
	server.tool(
		"events_publish",
		"Publica un evento en borrador (POST /events/{id}/publish).",
		{ id: z.string().describe("Id del evento") },
		mutating,
		async ({ id }) => run(postEventsIdPublish({ path: { id }, client })),
	);
	server.tool(
		"events_delete",
		`Elimina un evento (DELETE /events/{id}).${CONFIRM}`,
		{ id: z.string().describe("Id del evento") },
		destructive,
		async ({ id }) => run(deleteEventsId({ path: { id }, client })),
	);
	server.tool(
		"event_dates_delete",
		`Elimina una fecha/función de un evento (DELETE /events/{id}/dates/{dateId}).${CONFIRM}`,
		{
			eventId: z.string().describe("Id del evento"),
			dateId: z.string().describe("Id de la fecha"),
		},
		destructive,
		async ({ eventId, dateId }) =>
			run(deleteEventsIdDatesDateId({ path: { id: eventId, dateId }, client })),
	);

	// ── Ticket types ─────────────────────────────────────────────────────────
	server.tool(
		"ticket_types_create",
		"Crea un tipo de ticket para una fecha (POST /ticket-types).",
		{
			eventDateId: z.string().describe("Id de la fecha de evento"),
			name: z.string(),
			description: z.string().optional(),
			price: z.number().describe("Precio en la moneda dada"),
			currency: z.string().describe("Ej: COP"),
			capacity: z.number().int().describe("Stock total"),
			maxPerOrder: z.number().int().describe("Máximo por orden"),
			isVisible: z.boolean(),
			organizerAbsorbsFee: z
				.boolean()
				.describe("El organizador absorbe la comisión"),
		},
		mutating,
		async (body) => run(postTicketTypes({ body, client })),
	);
	server.tool(
		"ticket_types_delete",
		`Elimina un tipo de ticket (DELETE /ticket-types/{id}).${CONFIRM}`,
		{ id: z.string().describe("Id del tipo de ticket") },
		destructive,
		async ({ id }) => run(deleteTicketTypesId({ path: { id }, client })),
	);

	// ── Ventas y tickets ─────────────────────────────────────────────────────
	server.tool(
		"sales_create",
		"Crea una venta u orden programática — cortesías (comp) o venta directa (POST /sales).",
		{
			buyer: z.object({
				name: z.string(),
				email: z.string().email(),
				phone: z.string().optional(),
			}),
			items: z
				.array(
					z.object({
						ticketTypeId: z.string(),
						quantity: z.number().int().positive(),
					}),
				)
				.describe("Ítems de la orden"),
			channel: z.enum(["WEB", "MOBILE", "POS", "ADMIN"]),
			comp: z.boolean().describe("true = cortesía (sin cobro)"),
			notes: z.string().optional(),
		},
		mutating,
		async (body) => run(postSales({ body, client })),
	);
	server.tool(
		"sales_cancel",
		`Cancela una venta (POST /sales/{id}/cancel).${CONFIRM}`,
		{ id: z.string().describe("Id de la venta") },
		destructive,
		async ({ id }) => run(postSalesIdCancel({ path: { id }, client })),
	);
	server.tool(
		"sales_refund",
		`Reembolsa una venta (POST /sales/{id}/refund).${CONFIRM}`,
		{ id: z.string().describe("Id de la venta") },
		destructive,
		async ({ id }) => run(postSalesIdRefund({ path: { id }, client })),
	);
	server.tool(
		"tickets_checkin",
		"Registra el ingreso (check-in) de un ticket por su código QR (POST /tickets/{code}/checkin).",
		{ code: z.string().describe("Código QR del ticket") },
		mutating,
		async ({ code }) =>
			run(postTicketsTicketCodeCheckin({ path: { ticketCode: code }, client })),
	);
	server.tool(
		"tickets_resend",
		"Reenvía el QR/email de un ticket al comprador (POST /tickets/{code}/resend).",
		{ code: z.string().describe("Código QR del ticket") },
		mutating,
		async ({ code }) =>
			run(postTicketsTicketCodeResend({ path: { ticketCode: code }, client })),
	);

	// ── Membresías ───────────────────────────────────────────────────────────
	server.tool(
		"plans_create",
		"Crea un plan de membresía (POST /membership-plans).",
		{
			name: z.string(),
			description: z.string().optional(),
			price: z.number(),
			currency: z.string(),
			billingCycle: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "LIFETIME"]),
			benefitPresale: z.boolean(),
			benefitFreeTicket: z.boolean(),
			benefitDiscount: z.boolean(),
			benefitExclusiveContent: z.boolean(),
			benefitMerch: z.boolean(),
			isActive: z.boolean(),
		},
		mutating,
		async (body) => run(postMembershipPlans({ body, client })),
	);
	server.tool(
		"plans_delete",
		`Elimina un plan de membresía (DELETE /membership-plans/{id}).${CONFIRM}`,
		{ id: z.string().describe("Id del plan") },
		destructive,
		async ({ id }) => run(deleteMembershipPlansId({ path: { id }, client })),
	);
	server.tool(
		"subscriptions_cancel",
		`Cancela la suscripción de un miembro (POST /subscriptions/{id}/cancel).${CONFIRM}`,
		{ id: z.string().describe("Id de la suscripción") },
		destructive,
		async ({ id }) => run(postSubscriptionsIdCancel({ path: { id }, client })),
	);

	// ── Venues y staff ───────────────────────────────────────────────────────
	server.tool(
		"venues_create",
		"Crea un venue (POST /venues).",
		{
			name: z.string(),
			address: z.string(),
			city: z.string(),
			country: z.string(),
			capacity: z.number().int().optional(),
			latitude: z.number().optional(),
			longitude: z.number().optional(),
		},
		mutating,
		async (body) => run(postVenues({ body, client })),
	);
	server.tool(
		"venues_delete",
		`Elimina un venue (DELETE /venues/{id}).${CONFIRM}`,
		{ id: z.string().describe("Id del venue") },
		destructive,
		async ({ id }) => run(deleteVenuesId({ path: { id }, client })),
	);
	server.tool(
		"staff_create",
		"Invita a un miembro del staff (POST /staff).",
		{ name: z.string(), email: z.string().email() },
		mutating,
		async (body) => run(postStaff({ body, client })),
	);
	server.tool(
		"staff_update_role",
		"Cambia el rol de un miembro del staff (PATCH /staff/{id}/role).",
		{
			id: z.string().describe("Id del miembro"),
			role: z.enum(["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER", "MINCULTURA"]),
		},
		mutating,
		async ({ id, role }) =>
			run(patchStaffIdRole({ path: { id }, body: { role }, client })),
	);

	// ── Comercial ────────────────────────────────────────────────────────────
	server.tool(
		"discounts_create",
		"Crea un cupón/descuento (POST /discounts).",
		{
			code: z.string().describe("Código del cupón"),
			type: z.enum(["PERCENT", "FIXED"]),
			value: z.number().describe("Porcentaje o monto fijo según type"),
			eventId: z.string().nullish().describe("Limitar a un evento"),
			maxUses: z.number().int().nullish().describe("Usos máximos"),
			startsAt: z.string().nullish().describe("Vigente desde (ISO 8601)"),
			endsAt: z.string().nullish().describe("Vigente hasta (ISO 8601)"),
		},
		mutating,
		async (body) => run(postDiscounts({ body, client })),
	);
	server.tool(
		"discounts_update",
		"Actualiza un cupón/descuento (PATCH /discounts/{id}).",
		{
			id: z.string().describe("Id del cupón"),
			active: z.boolean().optional(),
			value: z.number().optional(),
			maxUses: z.number().int().nullish(),
			startsAt: z.string().nullish(),
			endsAt: z.string().nullish(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchDiscountsId({ path: { id }, body, client })),
	);
	server.tool(
		"discounts_delete",
		`Elimina un cupón/descuento (DELETE /discounts/{id}).${CONFIRM}`,
		{ id: z.string().describe("Id del cupón") },
		destructive,
		async ({ id }) => run(deleteDiscountsId({ path: { id }, client })),
	);
	server.tool(
		"webhooks_create",
		"Registra un webhook para eventos de venta (POST /webhooks).",
		{
			url: z.string().url().describe("Endpoint que recibe los eventos"),
			events: z
				.array(z.enum(["sale.confirmed", "sale.refunded"]))
				.describe("Eventos a los que suscribirse"),
			secret: z.string().optional().describe("Secreto para firmar el payload"),
		},
		mutating,
		async (body) => run(postWebhooks({ body, client })),
	);
	server.tool(
		"webhooks_delete",
		`Elimina un webhook (DELETE /webhooks/{id}).${CONFIRM}`,
		{ id: z.string().describe("Id del webhook") },
		destructive,
		async ({ id }) => run(deleteWebhooksId({ path: { id }, client })),
	);
}
