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
	patchCustomerProfile,
	patchDiscountsId,
	patchEventsId,
	patchEventsIdDatesDateId,
	patchMembershipPlansId,
	patchStaffIdRole,
	patchTicketTypesId,
	patchVenuesId,
	postContentPlaybackToken,
	postCustomerLogout,
	postCustomerSubscriptions,
	postCustomerSubscriptionsCancel,
	postCustomerTicketsIdCancel,
	postDiscounts,
	postEvents,
	postEventsIdDates,
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
/** Remind the agent in the description, not only in the annotation. */
const CONFIRM = " ⚠️ Irreversible: confirm with the human before running it.";

/**
 * Wave B: writes of the B2B /api/v1 contract (one tool = one operationId).
 *
 * Complete as of contract 1.5.0: the updates that were missing (event_dates_*,
 * ticket_types_update, plans_update, venues_update) now declare a requestBody
 * in the spec, so their schemas come from the contract and not from guesswork.
 */
export function registerB2bWriteTools(server: McpServer, client: Client): void {
	// ── Events ───────────────────────────────────────────────────────────────
	server.tool(
		"events_create",
		"Creates an event with its dates (POST /events).",
		{
			name: z.string().describe("Event name"),
			slug: z.string().describe("Slug único (URL-friendly)"),
			description: z.string().optional(),
			venueId: z.string().nullish().describe("Venue id"),
			dates: z
				.array(
					z.object({
						startsAt: z.string().describe("Inicio (ISO 8601)"),
						endsAt: z.string().nullish().describe("Fin (ISO 8601)"),
						timezone: z.string().describe("Ej: America/Bogota"),
					}),
				)
				.describe("At least one date"),
		},
		mutating,
		async (body) => run(postEvents({ body, client })),
	);
	server.tool(
		"events_update",
		"Actualiza campos de un evento (PATCH /events/{id}).",
		{
			id: z.string().describe("Event id"),
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
		{ id: z.string().describe("Event id") },
		mutating,
		async ({ id }) => run(postEventsIdPublish({ path: { id }, client })),
	);
	server.tool(
		"events_delete",
		`Elimina un evento (DELETE /events/{id}).${CONFIRM}`,
		{ id: z.string().describe("Event id") },
		destructive,
		async ({ id }) => run(deleteEventsId({ path: { id }, client })),
	);
	server.tool(
		"event_dates_create",
		"Adds a date to an event (POST /events/{id}/dates).",
		{
			eventId: z.string().describe("Event id"),
			startsAt: z.string().describe("Inicio (ISO 8601)"),
			timezone: z
				.string()
				.default("America/Bogota")
				.describe("Ej: America/Bogota"),
			label: z.string().max(200).nullish().describe("Date label"),
			endsAt: z.string().nullish().describe("Fin (ISO 8601)"),
			doorsOpenAt: z
				.string()
				.nullish()
				.describe("Apertura de puertas (ISO 8601)"),
			venueId: z.string().nullish().describe("Venue de esta función"),
		},
		mutating,
		async ({ eventId, ...body }) =>
			run(postEventsIdDates({ path: { id: eventId }, body, client })),
	);
	server.tool(
		"event_dates_update",
		"Updates a date (PATCH /events/{id}/dates/{dateId}).",
		{
			eventId: z.string().describe("Event id"),
			dateId: z.string().describe("Date id"),
			startsAt: z.string().optional().describe("Inicio (ISO 8601)"),
			endsAt: z.string().nullish().describe("Fin (ISO 8601)"),
			doorsOpenAt: z
				.string()
				.nullish()
				.describe("Apertura de puertas (ISO 8601)"),
			timezone: z.string().optional(),
			label: z.string().max(200).nullish(),
			venueId: z.string().nullish(),
		},
		mutating,
		async ({ eventId, dateId, ...body }) =>
			run(
				patchEventsIdDatesDateId({
					path: { id: eventId, dateId },
					body,
					client,
				}),
			),
	);
	server.tool(
		"event_dates_delete",
		`Deletes a date from an event (DELETE /events/{id}/dates/{dateId}).${CONFIRM}`,
		{
			eventId: z.string().describe("Event id"),
			dateId: z.string().describe("Date id"),
		},
		destructive,
		async ({ eventId, dateId }) =>
			run(deleteEventsIdDatesDateId({ path: { id: eventId, dateId }, client })),
	);

	// ── Ticket types ─────────────────────────────────────────────────────────
	server.tool(
		"ticket_types_create",
		"Creates a ticket type for a date (POST /ticket-types).",
		{
			eventDateId: z.string().describe("Event date id"),
			name: z.string(),
			description: z.string().optional(),
			price: z.number().describe("Price in the given currency"),
			currency: z.string().describe("Ej: COP"),
			capacity: z.number().int().describe("Stock total"),
			maxPerOrder: z.number().int().describe("Máximo por orden"),
			isVisible: z.boolean(),
			organizerAbsorbsFee: z
				.boolean()
				.describe("The organizer absorbs the fee"),
		},
		mutating,
		async (body) => run(postTicketTypes({ body, client })),
	);
	server.tool(
		"ticket_types_update",
		"Actualiza un tipo de ticket — precio, stock, visibilidad (PATCH /ticket-types/{id}).",
		{
			id: z.string().describe("Ticket type id"),
			name: z.string().optional(),
			description: z.string().nullish(),
			price: z.number().min(0).optional(),
			currency: z.string().optional(),
			capacity: z.number().int().positive().optional().describe("Stock total"),
			maxPerOrder: z.number().int().positive().optional(),
			isVisible: z.boolean().optional(),
			organizerAbsorbsFee: z.boolean().optional(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchTicketTypesId({ path: { id }, body, client })),
	);
	server.tool(
		"ticket_types_delete",
		`Elimina un tipo de ticket (DELETE /ticket-types/{id}).${CONFIRM}`,
		{ id: z.string().describe("Ticket type id") },
		destructive,
		async ({ id }) => run(deleteTicketTypesId({ path: { id }, client })),
	);

	// ── Ventas y tickets ─────────────────────────────────────────────────────
	server.tool(
		"sales_create",
		"Creates a programmatic sale or order — comps or a direct sale (POST /sales).",
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
				.describe("Order items"),
			channel: z.enum(["WEB", "MOBILE", "POS", "ADMIN"]),
			comp: z.boolean().describe("true = comp (no charge)"),
			notes: z.string().optional(),
		},
		mutating,
		async (body) => run(postSales({ body, client })),
	);
	server.tool(
		"sales_cancel",
		`Cancels a sale (POST /sales/{id}/cancel).${CONFIRM}`,
		{
			id: z.string().describe("Sale id"),
			acknowledge_open_payment: z
				.boolean()
				.optional()
				.describe(
					"Confirms cancelling even though the payment is still open at the " +
						"gateway (the API demands it so no charge is orphaned).",
				),
		},
		destructive,
		async ({ id, ...body }) =>
			run(postSalesIdCancel({ path: { id }, body, client })),
	);
	server.tool(
		"sales_refund",
		`Refunds a sale (POST /sales/{id}/refund).${CONFIRM}`,
		{
			id: z.string().describe("Sale id"),
			acknowledge_manual: z
				.boolean()
				.optional()
				.describe(
					"Confirms the money is returned by hand, outside the gateway.",
				),
		},
		destructive,
		async ({ id, ...body }) =>
			run(postSalesIdRefund({ path: { id }, body, client })),
	);
	server.tool(
		"tickets_checkin",
		"Checks a ticket in by its QR code (POST /tickets/{code}/checkin).",
		{ code: z.string().describe("Ticket QR code") },
		mutating,
		async ({ code }) =>
			run(postTicketsTicketCodeCheckin({ path: { ticketCode: code }, client })),
	);
	server.tool(
		"tickets_resend",
		"Resends a ticket QR and email to the buyer (POST /tickets/{code}/resend).",
		{ code: z.string().describe("Ticket QR code") },
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
			sortOrder: z
				.number()
				.int()
				.min(0)
				.default(0)
				.describe("Sort order in the plan list"),
		},
		mutating,
		async (body) => run(postMembershipPlans({ body, client })),
	);
	server.tool(
		"plans_update",
		"Actualiza un plan de membresía (PATCH /membership-plans/{id}).",
		{
			id: z.string().describe("Plan id"),
			name: z.string().optional(),
			description: z.string().nullish(),
			price: z.number().min(0).optional(),
			currency: z.string().optional(),
			billingCycle: z
				.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "LIFETIME"])
				.optional(),
			benefitPresale: z.boolean().optional(),
			benefitFreeTicket: z.boolean().optional(),
			benefitDiscount: z.boolean().optional(),
			benefitExclusiveContent: z.boolean().optional(),
			benefitMerch: z.boolean().optional(),
			isActive: z.boolean().optional(),
			sortOrder: z.number().int().min(0).optional(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchMembershipPlansId({ path: { id }, body, client })),
	);
	server.tool(
		"plans_delete",
		`Elimina un plan de membresía (DELETE /membership-plans/{id}).${CONFIRM}`,
		{ id: z.string().describe("Plan id") },
		destructive,
		async ({ id }) => run(deleteMembershipPlansId({ path: { id }, client })),
	);
	server.tool(
		"subscriptions_cancel",
		`Cancels a member subscription (POST /subscriptions/{id}/cancel).${CONFIRM}`,
		{ id: z.string().describe("Subscription id") },
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
		"venues_update",
		"Actualiza un venue (PATCH /venues/{id}).",
		{
			id: z.string().describe("Venue id"),
			name: z.string().optional(),
			address: z.string().optional(),
			city: z.string().optional(),
			country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2"),
			capacity: z.number().int().positive().nullish(),
			latitude: z.number().min(-90).max(90).nullish(),
			longitude: z.number().min(-180).max(180).nullish(),
			portalVisible: z.boolean().optional(),
		},
		mutating,
		async ({ id, ...body }) =>
			run(patchVenuesId({ path: { id }, body, client })),
	);
	server.tool(
		"venues_delete",
		`Elimina un venue (DELETE /venues/{id}).${CONFIRM}`,
		{ id: z.string().describe("Venue id") },
		destructive,
		async ({ id }) => run(deleteVenuesId({ path: { id }, client })),
	);
	server.tool(
		"staff_create",
		"Invites a staff member (POST /staff).",
		{ name: z.string(), email: z.string().email() },
		mutating,
		async (body) => run(postStaff({ body, client })),
	);
	server.tool(
		"staff_update_role",
		"Changes a staff member role (PATCH /staff/{id}/role).",
		{
			id: z.string().describe("Member id"),
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
			code: z.string().describe("Coupon code"),
			type: z.enum(["PERCENT", "FIXED"]),
			value: z.number().describe("Porcentaje o monto fijo según type"),
			eventId: z.string().nullish().describe("Limitar a un evento"),
			maxUses: z.number().int().nullish().describe("Usos máximos"),
			startsAt: z.string().nullish().describe("Valid from (ISO 8601)"),
			endsAt: z.string().nullish().describe("Vigente hasta (ISO 8601)"),
		},
		mutating,
		async (body) => run(postDiscounts({ body, client })),
	);
	server.tool(
		"discounts_update",
		"Actualiza un cupón/descuento (PATCH /discounts/{id}).",
		{
			id: z.string().describe("Coupon id"),
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
		{ id: z.string().describe("Coupon id") },
		destructive,
		async ({ id }) => run(deleteDiscountsId({ path: { id }, client })),
	);
	server.tool(
		"webhooks_create",
		"Registers a webhook for sale events (POST /webhooks).",
		{
			url: z.string().url().describe("Endpoint that receives the events"),
			events: z
				.array(z.enum(["sale.confirmed", "sale.refunded"]))
				.describe("Events to subscribe to"),
			secret: z.string().optional().describe("Secret used to sign the payload"),
		},
		mutating,
		async (body) => run(postWebhooks({ body, client })),
	);
	server.tool(
		"webhooks_delete",
		`Elimina un webhook (DELETE /webhooks/{id}).${CONFIRM}`,
		{ id: z.string().describe("Webhook id") },
		destructive,
		async ({ id }) => run(deleteWebhooksId({ path: { id }, client })),
	);

	// ── Área de socios y contenido (contrato 1.7.0) ──────────────────────────
	// These speak on behalf of the buyer: an enterprise API key plus their
	// session token (X-Customer-Session). With them the agent closes the members
	// area loop: subscribing and cancelling, profile, and cancelling own purchase.
	const customerSession = z
		.string()
		.describe("Buyer session token (X-Customer-Session header)");

	server.tool(
		"customer_ticket_cancel",
		`Cancels a purchase made by the buyer, only while it is still unpaid (POST /customer/tickets/{id}/cancel).${CONFIRM}`,
		{ id: z.string().describe("Ticket id"), customerSession },
		destructive,
		async ({ id, customerSession }) =>
			run(
				postCustomerTicketsIdCancel({
					path: { id },
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_subscribe",
		"Starts a membership subscription and returns the payment URL — the agent " +
			"never handles the charge (POST /customer/subscriptions).",
		{
			planId: z.string().describe("Id of an active membership plan"),
			customerSession,
		},
		mutating,
		async ({ customerSession, ...body }) =>
			run(
				postCustomerSubscriptions({
					body,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_subscription_cancel",
		`Cancels the membership held by the buyer (POST /customer/subscriptions/cancel).${CONFIRM}`,
		{ customerSession },
		destructive,
		async ({ customerSession }) =>
			run(
				postCustomerSubscriptionsCancel({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_profile_update",
		"Edits the buyer profile: name and phone (PATCH /customer/profile). " +
			"A null or empty phone clears it.",
		{
			name: z.string().min(1).max(120).optional(),
			phone: z.string().max(30).nullish(),
			customerSession,
		},
		mutating,
		async ({ customerSession, ...body }) =>
			run(
				patchCustomerProfile({
					body,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_logout",
		"Closes the headless SSO buyer session (POST /customer/logout).",
		{ customerSession },
		mutating,
		async ({ customerSession }) =>
			run(
				postCustomerLogout({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"content_playback_token",
		"Signed token to play a video (1 h) or a live stream (30 min) " +
			"(POST /content/playback-token). `memberOnly` content additionally " +
			"requires the session token of a buyer with an active membership.",
		{
			kind: z.enum(["video", "live"]).describe("Content kind"),
			id: z.string().describe("Video or live stream id"),
			customerSession: z
				.string()
				.optional()
				.describe(
					"Buyer session token — required when the content is memberOnly",
				),
		},
		mutating,
		async ({ customerSession, ...body }) =>
			run(
				postContentPlaybackToken({
					body,
					...(customerSession
						? { headers: { "X-Customer-Session": customerSession } }
						: {}),
					client,
				}),
			),
	);
}
