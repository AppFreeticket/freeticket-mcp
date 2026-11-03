import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	deleteContentCommentsId,
	deleteContentMembersIdBan,
	deleteContentPostsId,
	deleteDiscountsId,
	deleteEventsId,
	deleteEventsIdArtistInvitationsInvitationId,
	deleteEventsIdArtistsOrganizationId,
	deleteEventsIdDatesDateId,
	deleteEventsIdSchedule,
	deleteMembershipPlansId,
	deletePresaleWindowsId,
	deleteProductsId,
	deleteStaffId,
	deleteTicketTypesId,
	deleteVenuesId,
	deleteWebhooksId,
	patchContentChannelsId,
	patchContentMeetupsId,
	patchContentMeetupsIdRsvpsRsvpId,
	patchContentPostsId,
	patchCustomerProfile,
	patchDiscountsId,
	patchEventsId,
	patchEventsIdDatesDateId,
	patchMembershipPlansId,
	patchPresaleWindowsId,
	patchProductsId,
	patchStaffIdRole,
	patchTicketsTicketCode,
	patchTicketTypesId,
	patchVenuesId,
	patchWebhooksId,
	postContentChannels,
	postContentChannelsIdArchive,
	postContentMeetups,
	postContentMeetupsIdCancel,
	postContentMeetupsIdPublish,
	postContentMembersIdBan,
	postContentModerationCommentsIdHide,
	postContentModerationCommentsIdIgnoreReports,
	postContentModerationCommentsIdUnhide,
	postContentModerationMemberPostsIdApprove,
	postContentModerationMemberPostsIdReject,
	postContentModerationMemberPostsIdRemove,
	postContentPlaybackToken,
	postContentPosts,
	postCustomerLogout,
	postCustomerOrdersIdRelease,
	postCustomerSubscriptions,
	postCustomerSubscriptionsCancel,
	postCustomerTicketsIdCancel,
	postDiscounts,
	postEventDatesIdAccessClose,
	postEvents,
	postEventsIdArtistInvitationsInvitationIdResend,
	postEventsIdCancel,
	postEventsIdDates,
	postEventsIdPublish,
	postEventsIdSchedule,
	postMembershipPlans,
	postProducts,
	postProductsIdStatus,
	postSales,
	postSalesIdAbandon,
	postSalesIdCancel,
	postSalesIdRefund,
	postStaff,
	postSubscriptionsIdCancel,
	postTicketsTicketCodeCheckin,
	postTicketsTicketCodeResend,
	postTicketTypes,
	postTicketTypesIdPresaleWindows,
	postVenues,
	postWaitlist,
	postWebhooks,
	postWorkspaces,
	putContentChannelsOrder,
	putContentMeetupsIdAttendance,
	putContentPostsIdPin,
	putEventsIdArtists,
} from "../client/sdk.gen";
import { write } from "../tool-meta";

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
		write("events_create", { destructive: false }),
		async (body) => run(postEvents({ body, client })),
	);
	server.tool(
		"events_update",
		"Updates fields of an event; absent fields are left untouched " +
			"(PATCH /events/{id}). Publication, scheduling and the artist lineup " +
			"have their own tools (`events_publish`, `events_schedule`, " +
			"`events_artists_set`). Errors: 409 `SLUG_TAKEN`, 422 `PULEP_REQUIRED`, " +
			"422 `CLASSIFICATION_CONFLICT` (e.g. `familiar` with an 18+ audience).",
		{
			id: z.string().describe("Event id"),
			name: z.string().min(1).optional(),
			slug: z
				.string()
				.min(1)
				.max(100)
				.optional()
				.describe("Public URL slug, unique across live events"),
			description: z.string().nullish(),
			venueId: z.string().nullish(),
			coverImageUrl: z.string().url().nullish().describe("Cover image URL"),
			squareImageUrl: z
				.string()
				.url()
				.nullish()
				.describe("Square (1:1) image URL"),
			storyImageUrl: z
				.string()
				.url()
				.nullish()
				.describe("Story (9:16) image URL"),
			pulepCode: z
				.string()
				.max(50)
				.nullish()
				.describe(
					"PULEP code — required for performing arts above 400 capacity per date",
				),
			listedOnPortal: z
				.boolean()
				.optional()
				.describe("Show the event on the public FreeTicket portal"),
			genre: z
				.enum([
					"comedia",
					"musica",
					"teatro",
					"danza",
					"cultura",
					"familiar",
					"fiesta",
					"deporte",
					"conferencia",
					"otro",
				])
				.optional()
				.describe("Event type from the taxonomy"),
			subgenre: z
				.enum([
					"stand_up",
					"impro",
					"sketch",
					"satira",
					"rock",
					"indie",
					"pop",
					"urbano",
					"salsa",
					"vallenato",
					"electronica",
					"tributo",
					"opera",
					"musical",
				])
				.nullish()
				.describe("Subtype; must belong to `genre`, sent in the same call"),
			genreOther: z
				.string()
				.min(1)
				.max(60)
				.optional()
				.describe('Free-text type — required when `genre` is "otro"'),
			audience: z
				.enum(["todo_publico", "mayores_14", "mayores_18", "infantil"])
				.nullish()
				.describe("Minimum age classification; null = unspecified"),
		},
		write("events_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchEventsId({ path: { id }, body, client })),
	);
	server.tool(
		"events_publish",
		"Publica un evento en borrador (POST /events/{id}/publish).",
		{ id: z.string().describe("Event id") },
		write("events_publish", { destructive: false }),
		async ({ id }) => run(postEventsIdPublish({ path: { id }, client })),
	);
	server.tool(
		"events_delete",
		`Elimina un evento (DELETE /events/{id}).${CONFIRM}`,
		{ id: z.string().describe("Event id") },
		write("events_delete", { destructive: true }),
		async ({ id }) => run(deleteEventsId({ path: { id }, client })),
	);
	server.tool(
		"events_cancel",
		"Cancels an event and ALL its dates, keeping the record, its sales and " +
			"tickets (POST /events/{id}/cancel). Idempotent. It does not refund: " +
			`refunds go one by one with \`sales_refund\`.${CONFIRM}`,
		{ id: z.string().describe("Event id") },
		write("events_cancel", { destructive: true }),
		async ({ id }) => run(postEventsIdCancel({ path: { id }, client })),
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
			streamType: z
				.enum(["PRESENCIAL", "ONLINE", "HIBRIDO"])
				.optional()
				.describe("In person, online or hybrid (default PRESENCIAL)"),
			maxPerCustomer: z
				.number()
				.int()
				.positive()
				.max(10000)
				.nullish()
				.describe("Ticket cap per buyer for this date; null = no cap"),
		},
		write("event_dates_create", { destructive: false }),
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
			streamType: z.enum(["PRESENCIAL", "ONLINE", "HIBRIDO"]).optional(),
			status: z
				.enum(["DRAFT", "PUBLISHED", "SOLD_OUT", "CANCELLED", "COMPLETED"])
				.optional()
				.describe("Date status"),
			maxPerCustomer: z
				.number()
				.int()
				.positive()
				.max(10000)
				.nullish()
				.describe("Ticket cap per buyer for this date; null = no cap"),
		},
		write("event_dates_update", { destructive: false }),
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
		write("event_dates_delete", { destructive: true }),
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
			currency: z.enum(["COP"]).default("COP").describe("Only COP"),
			capacity: z.number().int().describe("Stock total"),
			maxPerOrder: z.number().int().describe("Máximo por orden"),
			isVisible: z.boolean(),
			organizerAbsorbsFee: z
				.boolean()
				.describe("The organizer absorbs the fee"),
			saleStartsAt: z
				.string()
				.nullish()
				.describe("Sales open at (ISO 8601); null = open now"),
			saleEndsAt: z
				.string()
				.nullish()
				.describe("Sales close at (ISO 8601); null = until the date"),
			seatsioCategoryKey: z
				.string()
				.min(1)
				.nullish()
				.describe("seats.io category key (numbered events)"),
		},
		write("ticket_types_create", { destructive: false }),
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
			saleStartsAt: z
				.string()
				.nullish()
				.describe("Sales open at (ISO 8601); null = open now"),
			saleEndsAt: z
				.string()
				.nullish()
				.describe("Sales close at (ISO 8601); null = until the date"),
			seatsioCategoryKey: z
				.string()
				.min(1)
				.nullish()
				.describe("seats.io category key (numbered events)"),
		},
		write("ticket_types_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchTicketTypesId({ path: { id }, body, client })),
	);
	server.tool(
		"ticket_types_delete",
		`Elimina un tipo de ticket (DELETE /ticket-types/{id}).${CONFIRM}`,
		{ id: z.string().describe("Ticket type id") },
		write("ticket_types_delete", { destructive: true }),
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
		write("sales_create", { destructive: false }),
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
		write("sales_cancel", { destructive: true }),
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
		write("sales_refund", { destructive: true, openWorld: true }),
		async ({ id, ...body }) =>
			run(postSalesIdRefund({ path: { id }, body, client })),
	);
	server.tool(
		"tickets_checkin",
		"Checks a ticket in by its QR code (POST /tickets/{code}/checkin).",
		{ code: z.string().describe("Ticket QR code") },
		write("tickets_checkin", { destructive: false }),
		async ({ code }) =>
			run(postTicketsTicketCodeCheckin({ path: { ticketCode: code }, client })),
	);
	server.tool(
		"tickets_reassign",
		"Moves an already sold ticket to another date and/or ticket type — for a " +
			"postponement, without refunding and reselling (PATCH /tickets/{code}). " +
			"At least one of `eventDateId` or `ticketTypeId`.",
		{
			code: z.string().describe("Ticket QR code"),
			eventDateId: z.string().min(1).optional().describe("Target date id"),
			ticketTypeId: z
				.string()
				.min(1)
				.optional()
				.describe("Target ticket type id"),
			seatLabel: z
				.string()
				.min(1)
				.optional()
				.describe("Target seat (numbered events)"),
		},
		write("tickets_reassign", { destructive: false }),
		async ({ code, ...body }) =>
			run(patchTicketsTicketCode({ path: { ticketCode: code }, body, client })),
	);
	server.tool(
		"tickets_resend",
		"Resends a ticket QR and email to the buyer (POST /tickets/{code}/resend).",
		{ code: z.string().describe("Ticket QR code") },
		write("tickets_resend", { destructive: false, openWorld: true }),
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
		write("plans_create", { destructive: false }),
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
		write("plans_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchMembershipPlansId({ path: { id }, body, client })),
	);
	server.tool(
		"plans_delete",
		`Elimina un plan de membresía (DELETE /membership-plans/{id}).${CONFIRM}`,
		{ id: z.string().describe("Plan id") },
		write("plans_delete", { destructive: true }),
		async ({ id }) => run(deleteMembershipPlansId({ path: { id }, client })),
	);
	server.tool(
		"subscriptions_cancel",
		`Cancels a member subscription (POST /subscriptions/{id}/cancel).${CONFIRM}`,
		{ id: z.string().describe("Subscription id") },
		write("subscriptions_cancel", { destructive: true }),
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
		write("venues_create", { destructive: false }),
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
		write("venues_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchVenuesId({ path: { id }, body, client })),
	);
	server.tool(
		"venues_delete",
		`Elimina un venue (DELETE /venues/{id}).${CONFIRM}`,
		{ id: z.string().describe("Venue id") },
		write("venues_delete", { destructive: true }),
		async ({ id }) => run(deleteVenuesId({ path: { id }, client })),
	);
	server.tool(
		"staff_create",
		"Invites a staff member (POST /staff).",
		{ name: z.string(), email: z.string().email() },
		write("staff_create", { destructive: false }),
		async (body) => run(postStaff({ body, client })),
	);
	server.tool(
		"staff_update_role",
		"Changes a staff member role (PATCH /staff/{id}/role).",
		{
			id: z.string().describe("Member id"),
			role: z.enum([
				"SUPER_ADMIN",
				"ADMIN",
				"STAFF",
				"VIEWER",
				"MINCULTURA",
				"MERCH_MANAGER",
			]),
		},
		write("staff_update_role", { destructive: false }),
		async ({ id, role }) =>
			run(patchStaffIdRole({ path: { id }, body: { role }, client })),
	);
	server.tool(
		"staff_delete",
		"Revokes a staff member's access to THIS workspace and ends their live " +
			"sessions; the account and its history stay (DELETE /staff/{id})." +
			CONFIRM,
		{ id: z.string().describe("Member id") },
		write("staff_delete", { destructive: true }),
		async ({ id }) => run(deleteStaffId({ path: { id }, client })),
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
		write("discounts_create", { destructive: false }),
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
		write("discounts_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchDiscountsId({ path: { id }, body, client })),
	);
	server.tool(
		"discounts_delete",
		`Elimina un cupón/descuento (DELETE /discounts/{id}).${CONFIRM}`,
		{ id: z.string().describe("Coupon id") },
		write("discounts_delete", { destructive: true }),
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
		write("webhooks_create", { destructive: false }),
		async (body) => run(postWebhooks({ body, client })),
	);
	server.tool(
		"webhooks_update",
		"Edits a webhook — url, events or active — keeping its signing secret " +
			"(PATCH /webhooks/{id}). Prefer it over delete + create, which rotates " +
			"the secret.",
		{
			id: z.string().describe("Webhook id"),
			url: z.string().url().optional(),
			events: z
				.array(z.enum(["sale.confirmed", "sale.refunded"]))
				.min(1)
				.optional(),
			active: z.boolean().optional(),
		},
		write("webhooks_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchWebhooksId({ path: { id }, body, client })),
	);
	server.tool(
		"webhooks_delete",
		`Elimina un webhook (DELETE /webhooks/{id}).${CONFIRM}`,
		{ id: z.string().describe("Webhook id") },
		write("webhooks_delete", { destructive: true }),
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
		write("customer_ticket_cancel", { destructive: true }),
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
		write("customer_subscribe", { destructive: false }),
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
		{
			workspaceId: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Which membership to cancel — only without an enterprise key; with one it is ignored",
				),
			customerSession,
		},
		write("customer_subscription_cancel", { destructive: true }),
		async ({ customerSession, ...body }) =>
			run(
				postCustomerSubscriptionsCancel({
					body,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_order_release",
		"Abandons the buyer's PENDING order and returns its stock and seats, so " +
			"they can start over (POST /customer/orders/{id}/release). Refuses with " +
			`409 \`payment_in_flight\` if a payment was already started.${CONFIRM}`,
		{
			id: z.string().describe("Sale id or reference (FT-…)"),
			customerSession,
		},
		write("customer_order_release", { destructive: true }),
		async ({ id, customerSession }) =>
			run(
				postCustomerOrdersIdRelease({
					path: { id },
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
		write("customer_profile_update", { destructive: false }),
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
		write("customer_logout", { destructive: false }),
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
		write("content_playback_token", { destructive: false }),
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

	// ── Contrato 1.19/1.20 ───────────────────────────────────────────────────
	server.tool(
		"content_posts_create",
		"Publishes a community post (POST /content/posts). `ARTICLE` requires " +
			"`title` and `body` (Markdown); `TEXT`/`IMAGE` require `content` or " +
			"`imageUrl`.",
		{
			type: z.enum(["TEXT", "IMAGE", "ARTICLE"]).default("TEXT"),
			content: z.string().max(5000).optional(),
			imageUrl: z.string().url().max(2048).nullish(),
			title: z.string().min(1).max(140).optional().describe("ARTICLE only"),
			subtitle: z.string().max(280).nullish(),
			slug: z
				.string()
				.max(200)
				.nullish()
				.describe("Derived from the title if omitted"),
			body: z
				.string()
				.min(1)
				.max(100000)
				.optional()
				.describe("Markdown — ARTICLE only"),
			locked: z.boolean().default(false).describe("true = members only"),
			eventId: z.string().min(1).nullish().describe("Link to an event"),
			publishedAt: z.string().optional().describe("ISO 8601 (UTC, Z)"),
		},
		write("content_posts_create", { destructive: false }),
		async (body) => run(postContentPosts({ body, client })),
	);
	server.tool(
		"workspaces_create",
		"Creates a new workspace; the caller becomes its ADMIN (POST /workspaces). " +
			"Subject to the plan quota; 409 `ALREADY_HAS_ACCESS` if the caller is " +
			"staff of someone else's workspace. Ignores the pinned workspace.",
		{
			name: z.string().min(2).max(80),
			slug: z
				.string()
				.min(2)
				.max(50)
				.regex(/^[a-z0-9-]+$/)
				.describe("Lowercase, digits and dashes"),
		},
		write("workspaces_create", { destructive: false }),
		async (body) => run(postWorkspaces({ body, client })),
	);

	// ── Contract 1.21–1.27 ───────────────────────────────────────────────────
	server.tool(
		"events_schedule",
		"Schedules a DRAFT event (POST /events/{id}/schedule). Send exactly one: " +
			"`publishAt` publishes it by itself at that instant (checked every ~5 " +
			"min); `saleStartsAt` publishes it NOW and opens sales at that instant " +
			"on every ticket type of the upcoming dates. Errors: 409 " +
			"`EVENT_NOT_DRAFT`, 422 `SCHEDULE_IN_PAST`, 422 " +
			"`SCHEDULE_AFTER_EVENT_DATE`, 409 `NO_FUTURE_DATE`, 409 `NO_TICKET_TYPES`.",
		{
			id: z.string().describe("Event id"),
			publishAt: z
				.string()
				.optional()
				.describe("Auto-publish instant, ISO 8601 in UTC (…Z)"),
			saleStartsAt: z
				.string()
				.optional()
				.describe(
					"Publish now and open sales at this instant, ISO 8601 UTC (…Z)",
				),
		},
		write("events_schedule", { destructive: false }),
		async ({ id, ...body }) =>
			run(postEventsIdSchedule({ path: { id }, body, client })),
	);
	server.tool(
		"events_unschedule",
		"Clears the pending scheduled publication of an event (`publishAt` → null) " +
			"and keeps its status (DELETE /events/{id}/schedule). It does not undo a " +
			"`saleStartsAt` schedule: edit the ticket types' `saleStartsAt` with " +
			"`ticket_types_update` instead.",
		{ id: z.string().describe("Event id") },
		write("events_unschedule", { destructive: false, idempotent: true }),
		async ({ id }) => run(deleteEventsIdSchedule({ path: { id }, client })),
	);

	server.tool(
		"events_artists_set",
		"Replaces the event lineup with `artistIds`, in that order " +
			"(PUT /events/{id}/artists). Artists not in the list are UNLINKED — send " +
			"the full lineup, not a diff; `[]` clears it. Ids come from " +
			"`artists_search`. Newly linked artists get a notification email; " +
			"`inviteEmails` (additive) invites artists without an account. Unknown " +
			"ids are skipped and reported in `warnings[]`. Up to 50 ids and 20 " +
			`emails per call.${CONFIRM}`,
		{
			id: z.string().describe("Event id"),
			artistIds: z
				.array(z.string().min(1).max(64))
				.max(50)
				.describe("Full lineup, in order — artist workspace ids"),
			inviteEmails: z
				.array(z.string().email())
				.max(20)
				.optional()
				.describe("Emails of artists without an account to invite"),
		},
		write("events_artists_set", {
			destructive: true,
			idempotent: true,
			openWorld: true,
		}),
		async ({ id, ...body }) =>
			run(putEventsIdArtists({ path: { id }, body, client })),
	);
	server.tool(
		"events_artists_delete",
		"Unlinks one artist from the event lineup " +
			"(DELETE /events/{id}/artists/{organizationId}). Allowed for the " +
			"workspace that owns the event, or for the artist removing itself. " +
			`404 \`ARTIST_NOT_LINKED\` if it is not in the lineup.${CONFIRM}`,
		{
			eventId: z.string().describe("Event id"),
			organizationId: z.string().describe("Artist workspace id"),
		},
		write("events_artists_delete", { destructive: true }),
		async ({ eventId, organizationId }) =>
			run(
				deleteEventsIdArtistsOrganizationId({
					path: { id: eventId, organizationId },
					client,
				}),
			),
	);
	server.tool(
		"event_artist_invitations_cancel",
		"Cancels a pending or expired artist invitation; its link stops working " +
			"(DELETE /events/{id}/artist-invitations/{invitationId}). 409 " +
			"`INVITATION_ACCEPTED` if already accepted — unlink with " +
			`\`events_artists_delete\` instead.${CONFIRM}`,
		{
			eventId: z.string().describe("Event id"),
			invitationId: z.string().describe("Invitation id"),
		},
		write("event_artist_invitations_cancel", { destructive: true }),
		async ({ eventId, invitationId }) =>
			run(
				deleteEventsIdArtistInvitationsInvitationId({
					path: { id: eventId, invitationId },
					client,
				}),
			),
	);
	server.tool(
		"event_artist_invitations_resend",
		"Resends an artist invitation email and renews its expiry to 14 days, " +
			"same link (POST /events/{id}/artist-invitations/{invitationId}/resend). " +
			"Works on expired ones. 3 resends per hour per invitation (429).",
		{
			eventId: z.string().describe("Event id"),
			invitationId: z.string().describe("Invitation id"),
		},
		write("event_artist_invitations_resend", {
			destructive: false,
			openWorld: true,
		}),
		async ({ eventId, invitationId }) =>
			run(
				postEventsIdArtistInvitationsInvitationIdResend({
					path: { id: eventId, invitationId },
					client,
				}),
			),
	);

	// ── Presale windows (member presales) ────────────────────────────────────
	const presaleCapacity = z
		.number()
		.int()
		.positive()
		.nullish()
		.describe("Max tickets sold in the presale; null = no cap");
	server.tool(
		"presale_windows_create",
		"Opens a member presale on a ticket type: active members of `planId` can " +
			"buy it between `presaleStartsAt` and `presaleEndsAt` " +
			"(POST /ticket-types/{id}/presale-windows). One window per plan and " +
			"ticket type. Errors: 422 `PLAN_NOT_ELIGIBLE`, 422 " +
			"`PRESALE_WINDOW_INVERTED`, 409 `DUPLICATE_PLAN`.",
		{
			ticketTypeId: z.string().describe("Ticket type id"),
			planId: z.string().min(1).describe("Membership plan id"),
			presaleStartsAt: z.string().describe("Start, ISO 8601 in UTC (…Z)"),
			presaleEndsAt: z.string().describe("End, ISO 8601 in UTC (…Z)"),
			presaleCapacity,
			isActive: z.boolean().default(true),
		},
		write("presale_windows_create", { destructive: false }),
		async ({ ticketTypeId, ...body }) =>
			run(
				postTicketTypesIdPresaleWindows({
					path: { id: ticketTypeId },
					body,
					client,
				}),
			),
	);
	server.tool(
		"presale_windows_update",
		"Updates a presale window; absent fields are left untouched " +
			"(PATCH /presale-windows/{id}). Same errors as `presale_windows_create`.",
		{
			id: z.string().describe("Presale window id"),
			planId: z.string().min(1).optional(),
			presaleStartsAt: z.string().optional().describe("ISO 8601 in UTC (…Z)"),
			presaleEndsAt: z.string().optional().describe("ISO 8601 in UTC (…Z)"),
			presaleCapacity,
			isActive: z.boolean().optional(),
		},
		write("presale_windows_update", { destructive: false, idempotent: true }),
		async ({ id, ...body }) =>
			run(patchPresaleWindowsId({ path: { id }, body, client })),
	);
	server.tool(
		"presale_windows_delete",
		"Permanently deletes a presale window; members lose that presale access " +
			`immediately (DELETE /presale-windows/{id}).${CONFIRM}`,
		{ id: z.string().describe("Presale window id") },
		write("presale_windows_delete", { destructive: true }),
		async ({ id }) => run(deletePresaleWindowsId({ path: { id }, client })),
	);

	// ── Landing waitlist (enterprise) ────────────────────────────────────────
	server.tool(
		"waitlist_join",
		"Adds a person to the per-city waitlist of an enterprise landing " +
			"(POST /waitlist). Requires an enterprise service API key. Idempotent " +
			"per city and contact: `created: false` when it already existed.",
		{
			city: z.string().min(1).max(60),
			name: z.string().min(1).max(80),
			contact: z
				.string()
				.min(1)
				.max(120)
				.describe("Email or phone (7-15 digits; only +, spaces and dashes)"),
			source: z
				.string()
				.max(40)
				.optional()
				.describe("Where the lead came from"),
			customerSession: z
				.string()
				.optional()
				.describe("Buyer session token — links the entry to that buyer"),
		},
		write("waitlist_join", { destructive: false, idempotent: true }),
		async ({ customerSession, ...body }) =>
			run(
				postWaitlist({
					body,
					...(customerSession
						? { headers: { "X-Customer-Session": customerSession } }
						: {}),
					client,
				}),
			),
	);

	// ── Contract 1.28–1.29: show day ─────────────────────────────────────────
	server.tool(
		"event_dates_access_close_sign",
		"Signs the access-close record of an event date " +
			"(POST /event-dates/{id}/access-close): freezes its check-in count as " +
			"the official record, signed by the key owner, and emails the record " +
			"to the workspace. Does not stop the scanner; there is no undo. " +
			"Requires ADMIN; opens 2 hours after the date starts (409 " +
			"`ACCESS_CLOSE_NOT_SIGNABLE_YET`, `details.signableFrom`). Only one " +
			"signature per date: 409 `ACCESS_ALREADY_CLOSED` is not retryable. " +
			"Read `event_dates_access_close_status` first and only sign when the " +
			`human explicitly asks for it.${CONFIRM}`,
		{
			id: z.string().describe("Event date id"),
			confirm: z
				.literal(true)
				.describe("Must be true — the API rejects the call without it"),
		},
		write("event_dates_access_close_sign", {
			destructive: true,
			openWorld: true,
		}),
		async ({ id, confirm }) =>
			run(
				postEventDatesIdAccessClose({
					path: { id },
					body: { confirm },
					client,
				}),
			),
	);
	server.tool(
		"sales_abandon",
		"Marks a PENDING sale whose payment never started as ABANDONED " +
			"(terminal) and deletes its stock reservations, so the inventory goes " +
			"back on sale at once (POST /sales/{id}/abandon). Does not touch " +
			"seats.io holds. Requires ADMIN. 409 `PAYMENT_IN_PROGRESS` when a " +
			"payment was started — wait for reconciliation; confirmed sales go " +
			`through \`sales_cancel\`.${CONFIRM}`,
		{ id: z.string().describe("Sale id") },
		write("sales_abandon", { destructive: true }),
		async ({ id }) => run(postSalesIdAbandon({ path: { id }, client })),
	);

	// ── Community posts and comments (contract 1.29) ─────────────────────────
	server.tool(
		"content_posts_update",
		"Updates a community post or article; absent fields are left untouched " +
			"and `null` clears a nullable one (PATCH /content/posts/{id}). An " +
			"ARTICLE takes `title`, `subtitle`, `body`, `slug`, `imageUrl`, " +
			"`locked`, `eventId`, `publishedAt`; a short post takes `type`, " +
			"`content`, `imageUrl`, `locked`, `eventId`, `channelId`, " +
			"`publishedAt`. Member posts cannot be edited (404). Errors: 400 for " +
			"a field that does not apply, 409 `SLUG_CONFLICT`.",
		{
			id: z.string().describe("Post id"),
			type: z
				.enum(["TEXT", "IMAGE"])
				.optional()
				.describe("Short posts only; an ARTICLE stays an ARTICLE"),
			content: z.string().max(5000).optional(),
			imageUrl: z
				.string()
				.url()
				.max(2048)
				.nullish()
				.describe("Image (cover on an ARTICLE); null removes it"),
			locked: z.boolean().optional().describe("Members only"),
			eventId: z
				.string()
				.min(1)
				.nullish()
				.describe("Linked event; null unlinks it"),
			channelId: z
				.string()
				.min(1)
				.max(64)
				.nullish()
				.describe("Short posts only; null moves it back to Announcements"),
			publishedAt: z
				.string()
				.optional()
				.describe(
					"Reschedules the post and its member notification (ISO 8601 UTC)",
				),
			title: z.string().min(1).max(140).optional().describe("ARTICLE only"),
			subtitle: z.string().max(280).nullish().describe("ARTICLE only"),
			body: z
				.string()
				.min(1)
				.max(100000)
				.optional()
				.describe("ARTICLE only (Markdown)"),
			slug: z
				.string()
				.max(200)
				.nullish()
				.describe("ARTICLE only; null re-derives it from the title"),
		},
		write("content_posts_update", { destructive: false, idempotent: true }),
		async ({ id, ...body }) =>
			run(patchContentPostsId({ path: { id }, body, client })),
	);
	server.tool(
		"content_posts_delete",
		"Soft-deletes a community post (organization post, article or member " +
			"post): unpins it, redacts the notifications that pointed to it and " +
			"removes it from the feed at once (DELETE /content/posts/{id}). It " +
			"cannot be restored through the API. To take down a member post with " +
			`a notice to its author, use \`content_member_posts_remove\`.${CONFIRM}`,
		{ id: z.string().describe("Post id") },
		write("content_posts_delete", { destructive: true }),
		async ({ id }) => run(deleteContentPostsId({ path: { id }, client })),
	);
	server.tool(
		"content_posts_pin",
		"Pins or unpins a community post (PUT /content/posts/{id}/pin). At most " +
			"one pinned post per workspace: pinning unpins the previous one. Only " +
			"a published post can be pinned. Idempotent.",
		{
			id: z.string().describe("Post id"),
			pinned: z.boolean().describe("true = pin, false = unpin"),
		},
		write("content_posts_pin", { destructive: false, idempotent: true }),
		async ({ id, pinned }) =>
			run(putContentPostsIdPin({ path: { id }, body: { pinned }, client })),
	);
	server.tool(
		"content_comments_delete",
		"Soft-deletes a community comment and, if it is top-level, all its live " +
			"replies (DELETE /content/comments/{id}). Cannot be undone through the " +
			`API; to hide it reversibly use \`content_comments_hide\`.${CONFIRM}`,
		{ id: z.string().describe("Comment id") },
		write("content_comments_delete", { destructive: true }),
		async ({ id }) => run(deleteContentCommentsId({ path: { id }, client })),
	);

	// ── Community channels ───────────────────────────────────────────────────
	const whoCanPost = z
		.enum(["STAFF", "MEMBERS"])
		.describe("Who can post in the channel");
	server.tool(
		"content_channels_create",
		"Creates a CITY or CUSTOM community channel, appended at the end " +
			"(POST /content/channels). The slug comes from the name and never " +
			"changes. Errors: 400 `city` missing on a CITY channel, 409 " +
			"`CHANNEL_LIMIT_REACHED` (archive one first).",
		{
			kind: z.enum(["CITY", "CUSTOM"]),
			name: z.string().min(1).max(40),
			description: z.string().max(200).nullish(),
			city: z
				.string()
				.max(60)
				.nullish()
				.describe("Required when kind=CITY; ignored otherwise"),
			whoCanPost: whoCanPost.default("STAFF"),
			requiresApproval: z
				.boolean()
				.default(true)
				.describe("Member posts wait for review before publishing"),
		},
		write("content_channels_create", { destructive: false }),
		async (body) => run(postContentChannels({ body, client })),
	);
	server.tool(
		"content_channels_update",
		"Updates a community channel; absent fields are left untouched and " +
			"`null` clears `description`/`city` (PATCH /content/channels/{id}). " +
			"The slug does not change on rename; archived channels cannot be " +
			"edited. Errors: 400 `ANNOUNCEMENTS_STAFF_ONLY`, 400 `CITY_REQUIRED`.",
		{
			id: z.string().describe("Channel id"),
			name: z.string().min(1).max(40).optional(),
			description: z.string().max(200).nullish(),
			city: z.string().max(60).nullish(),
			whoCanPost: whoCanPost.optional(),
			requiresApproval: z.boolean().optional(),
		},
		write("content_channels_update", { destructive: false, idempotent: true }),
		async ({ id, ...body }) =>
			run(patchContentChannelsId({ path: { id }, body, client })),
	);
	server.tool(
		"content_channels_reorder",
		"Reorders the community channels (PUT /content/channels/order). Send " +
			"EVERY active channel id from `content_channels_list` in the new " +
			"order, Announcements first; a partial list is rejected. 409 " +
			"`CHANNEL_LIST_CHANGED`: re-read and retry.",
		{
			orderedIds: z
				.array(z.string().min(1).max(64))
				.min(1)
				.max(20)
				.describe("Every active channel id, Announcements first"),
		},
		write("content_channels_reorder", { destructive: false, idempotent: true }),
		async (body) => run(putContentChannelsOrder({ body, client })),
	);
	server.tool(
		"content_channels_archive",
		"Archives a community channel: its tab disappears and staff can no " +
			"longer post to it; its posts stay visible under All " +
			"(POST /content/channels/{id}/archive). There is no unarchive and the " +
			`slug stays taken. Announcements cannot be archived.${CONFIRM}`,
		{ id: z.string().describe("Channel id") },
		write("content_channels_archive", { destructive: true }),
		async ({ id }) =>
			run(postContentChannelsIdArchive({ path: { id }, client })),
	);

	// ── Community moderation ─────────────────────────────────────────────────
	server.tool(
		"content_comments_hide",
		"Hides a community comment and resolves its open reports as HIDDEN " +
			"(POST /content/moderation/comments/{id}/hide). Reversible with " +
			"`content_comments_unhide`. Idempotent (`changed: false`).",
		{ id: z.string().describe("Comment id") },
		write("content_comments_hide", { destructive: false, idempotent: true }),
		async ({ id }) =>
			run(postContentModerationCommentsIdHide({ path: { id }, client })),
	);
	server.tool(
		"content_comments_unhide",
		"Shows a hidden community comment again, marks it as cleared (no more " +
			"auto-hide) and resolves its open reports as IGNORED " +
			"(POST /content/moderation/comments/{id}/unhide). Idempotent.",
		{ id: z.string().describe("Comment id") },
		write("content_comments_unhide", { destructive: false, idempotent: true }),
		async ({ id }) =>
			run(postContentModerationCommentsIdUnhide({ path: { id }, client })),
	);
	server.tool(
		"content_comments_ignore_reports",
		"Dismisses the open reports of a community comment, leaving it as it " +
			"is and out of the queue; it will no longer be auto-hidden " +
			"(POST /content/moderation/comments/{id}/ignore-reports). New reports " +
			"put it back in the queue.",
		{ id: z.string().describe("Comment id") },
		write("content_comments_ignore_reports", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id }) =>
			run(
				postContentModerationCommentsIdIgnoreReports({ path: { id }, client }),
			),
	);
	const decision = {
		id: z.string().describe("Member post id"),
		reason: z
			.string()
			.max(1000)
			.optional()
			.describe("Shown to the author in their inbox"),
		banAuthor: z
			.boolean()
			.default(false)
			.describe("Also ban the author from the community (requires ADMIN)"),
	};
	server.tool(
		"content_member_posts_approve",
		"Approves a pending member post: it is published at the top of the " +
			"feed and its author and mentioned members are notified " +
			"(POST /content/moderation/member-posts/{id}/approve). Only the " +
			"version you read is approved: pass its `updatedAt` from " +
			"`content_member_posts_list`; 409 `EDITED_SINCE_READ` means re-read.",
		{
			id: z.string().describe("Member post id"),
			expectedUpdatedAt: z
				.string()
				.describe("`updatedAt` of the post as read (ISO 8601)"),
		},
		write("content_member_posts_approve", { destructive: false }),
		async ({ id, ...body }) =>
			run(
				postContentModerationMemberPostsIdApprove({
					path: { id },
					body,
					client,
				}),
			),
	);
	server.tool(
		"content_member_posts_reject",
		"Rejects a pending member post: it never gets published, the author is " +
			"notified in their inbox and the image is purged " +
			"(POST /content/moderation/member-posts/{id}/reject). `banAuthor` " +
			`also bans the author in the same transaction.${CONFIRM}`,
		decision,
		write("content_member_posts_reject", { destructive: true }),
		async ({ id, ...body }) =>
			run(
				postContentModerationMemberPostsIdReject({
					path: { id },
					body,
					client,
				}),
			),
	);
	server.tool(
		"content_member_posts_remove",
		"Removes a published member post: soft-deleted, the author is notified " +
			"in their inbox and the image is purged " +
			"(POST /content/moderation/member-posts/{id}/remove). `banAuthor` " +
			`also bans the author in the same transaction.${CONFIRM}`,
		decision,
		write("content_member_posts_remove", { destructive: true }),
		async ({ id, ...body }) =>
			run(
				postContentModerationMemberPostsIdRemove({
					path: { id },
					body,
					client,
				}),
			),
	);
	server.tool(
		"content_members_ban",
		"Bans a member from the community: they can no longer post, comment " +
			"or RSVP; their RSVPs to upcoming meetups are cancelled, the comment " +
			"(or all of them with `hideAllComments`) is hidden and open reports " +
			"are resolved as BANNED (POST /content/members/{id}/ban). The ban " +
			"always comes from one of their comments. Requires ADMIN. Lift it " +
			"with `content_members_unban` — hidden comments and cancelled RSVPs " +
			`stay that way.${CONFIRM}`,
		{
			id: z
				.string()
				.describe(
					"Customer id of the member (`author.customerId` in the queue)",
				),
			commentId: z
				.string()
				.min(1)
				.describe("Comment by this member that motivates the ban"),
			reason: z.string().max(500).optional(),
			hideAllComments: z
				.boolean()
				.default(false)
				.describe("true = hide every comment of the member, not only this one"),
		},
		write("content_members_ban", { destructive: true, idempotent: true }),
		async ({ id, ...body }) =>
			run(postContentMembersIdBan({ path: { id }, body, client })),
	);
	server.tool(
		"content_members_unban",
		"Lifts a member's community ban, leaving an audit entry " +
			"(DELETE /content/members/{id}/ban). Hidden comments stay hidden and " +
			"cancelled RSVPs stay cancelled. Requires ADMIN.",
		{ id: z.string().describe("Customer id of the member") },
		write("content_members_unban", { destructive: false, idempotent: true }),
		async ({ id }) => run(deleteContentMembersIdBan({ path: { id }, client })),
	);

	// ── Community meetups ────────────────────────────────────────────────────
	const wallTime = (what: string) =>
		z
			.string()
			.describe(
				`${what}: local wall time in the workspace's timezone, YYYY-MM-DDTHH:mm`,
			);
	const meetupFields = {
		description: z.string().max(5000).optional(),
		endsAt: wallTime("End").optional(),
		city: z.string().max(80).optional(),
		locationName: z.string().max(120).optional(),
		locationDetail: z.string().max(500).optional(),
		onlineUrl: z
			.string()
			.max(500)
			.optional()
			.describe("ONLINE only; must start with https://"),
		capacity: z
			.number()
			.int()
			.min(1)
			.max(100000)
			.nullish()
			.describe("null = unlimited"),
		requiresApproval: z
			.boolean()
			.optional()
			.describe("true = staff approves each RSVP request"),
	};
	server.tool(
		"content_meetups_create",
		"Creates a community meetup as DRAFT (POST /content/meetups); publish " +
			"it with `content_meetups_publish`. ONLINE keeps `onlineUrl` and drops " +
			"the address; IN_PERSON the opposite. Errors: 400 `BAD_REQUEST`, 400 " +
			"`STARTS_IN_PAST`.",
		{
			title: z.string().min(3).max(120),
			format: z.enum(["IN_PERSON", "ONLINE"]),
			startsAt: wallTime("Start"),
			...meetupFields,
		},
		write("content_meetups_create", { destructive: false }),
		async (body) => run(postContentMeetups({ body, client })),
	);
	server.tool(
		"content_meetups_update",
		"Updates a community meetup; absent fields keep their value and an " +
			"empty string clears an optional text (PATCH /content/meetups/{id}). " +
			"Errors: 409 `EVENT_CANCELLED`, 409 `CAPACITY_BELOW_GOING`, 400 " +
			"`STARTS_IN_PAST`.",
		{
			id: z.string().describe("Meetup id"),
			title: z.string().min(3).max(120).optional(),
			format: z.enum(["IN_PERSON", "ONLINE"]).optional(),
			startsAt: wallTime("Start").optional(),
			...meetupFields,
		},
		write("content_meetups_update", { destructive: false, idempotent: true }),
		async ({ id, ...body }) =>
			run(patchContentMeetupsId({ path: { id }, body, client })),
	);
	server.tool(
		"content_meetups_publish",
		"Publishes a draft meetup: it becomes visible to members and a " +
			"notification (inbox and email) to the whole community is queued " +
			"(POST /content/meetups/{id}/publish). Errors: 409 `NOT_DRAFT`, 409 " +
			"`STARTS_IN_PAST`.",
		{ id: z.string().describe("Meetup id") },
		write("content_meetups_publish", { destructive: false, openWorld: true }),
		async ({ id }) =>
			run(postContentMeetupsIdPublish({ path: { id }, client })),
	);
	server.tool(
		"content_meetups_cancel",
		"Cancels a meetup (draft or published); CANCELLED is terminal — it " +
			"cannot be edited or published again. Confirmed members are notified " +
			"by email and inbox (POST /content/meetups/{id}/cancel). 409 " +
			`\`ALREADY_CANCELLED\`.${CONFIRM}`,
		{ id: z.string().describe("Meetup id") },
		write("content_meetups_cancel", { destructive: true, openWorld: true }),
		async ({ id }) => run(postContentMeetupsIdCancel({ path: { id }, client })),
	);
	server.tool(
		"content_meetups_rsvp_review",
		"Approves or rejects an RSVP request of a meetup with " +
			"`requiresApproval`; the member gets an email with the decision " +
			"(PATCH /content/meetups/{id}/rsvps/{rsvpId}). APPROVE also works on " +
			"a rejected request; REJECT only on a pending one. Errors: 409 " +
			"`NOT_PENDING`, `EVENT_FULL`, `EVENT_CLOSED`, `MEMBER_BANNED`, " +
			"`NO_MEMBERSHIP`.",
		{
			id: z.string().describe("Meetup id"),
			rsvpId: z.string().describe("RSVP request id"),
			decision: z.enum(["APPROVE", "REJECT"]),
		},
		write("content_meetups_rsvp_review", {
			destructive: false,
			openWorld: true,
		}),
		async ({ id, rsvpId, decision }) =>
			run(
				patchContentMeetupsIdRsvpsRsvpId({
					path: { id, rsvpId },
					body: { decision },
					client,
				}),
			),
	);
	server.tool(
		"content_meetups_attendance",
		"Marks or unmarks a confirmed (GOING) meetup attendee as checked in " +
			"(PUT /content/meetups/{id}/attendance). Repeating the same mark " +
			"changes nothing (`changed: false`).",
		{
			id: z.string().describe("Meetup id"),
			rsvpId: z.string().min(1).max(64).describe("RSVP id of the attendee"),
			attended: z.boolean(),
		},
		write("content_meetups_attendance", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id, ...body }) =>
			run(putContentMeetupsIdAttendance({ path: { id }, body, client })),
	);

	// ── Digital products and courses (contract 1.30) ─────────────────────────
	// Same rules as the dashboard's product wizard; writes need ADMIN and an
	// event-scoped key gets 403. Files and lesson videos cannot be uploaded
	// through the API: the body only references assets already uploaded in the
	// dashboard. The course tree is modelled as the contract defines it
	// (ProductModuleInput → ProductLessonInput → resources / quiz).
	const productResource = z.object({
		id: z
			.string()
			.nullish()
			.describe("Id of a saved resource; absent/null creates a new one"),
		kind: z.enum(["FILE", "LINK"]),
		label: z.string(),
		url: z.string().nullish().describe("LINK only: http(s) URL"),
		filePath: z
			.string()
			.nullish()
			.describe(
				"FILE only: path of a file already uploaded in the dashboard " +
					"(private product files bucket, under this workspace)",
			),
		fileName: z.string().nullish(),
		fileSize: z.number().int().nullish().describe("Bytes"),
	});
	const productQuiz = z.object({
		questions: z.array(
			z.object({
				id: z.string(),
				prompt: z.string(),
				options: z.array(z.object({ id: z.string(), text: z.string() })),
				correctOptionId: z
					.string()
					.describe("`id` of the correct option of this question"),
			}),
		),
		passScore: z.number().int().describe("Minimum score to pass, 0–100"),
		showAnswers: z.boolean(),
	});
	const productLesson = z.object({
		id: z
			.string()
			.nullish()
			.describe(
				"Id of a saved lesson; absent/null creates a new one. Keep ids on " +
					"edit so buyers keep their progress",
			),
		title: z.string(),
		description: z.string().nullish(),
		isLive: z.boolean(),
		content: z.enum(["VIDEO", "FILE", "TEXT", "QUIZ"]),
		body: z.string().nullish().describe("Markdown; TEXT lessons only"),
		thumbnailUrl: z.string().nullish(),
		videoId: z
			.string()
			.nullish()
			.describe(
				"VIDEO lessons only: id of a course video already uploaded in the " +
					"dashboard (videos cannot be uploaded through the API)",
			),
		fileName: z.string().nullish(),
		filePath: z
			.string()
			.nullish()
			.describe(
				"FILE lessons: path of a file already uploaded in the dashboard",
			),
		resources: z
			.array(productResource)
			.optional()
			.describe("Absent keeps the saved resources; [] removes them all"),
		isPreview: z
			.boolean()
			.optional()
			.describe(
				"Free preview on the public page (VIDEO/TEXT only, max one per " +
					"module). Absent keeps the saved value",
			),
		quiz: productQuiz.nullish().describe("QUIZ lessons only"),
	});
	const productModule = z.object({
		id: z
			.string()
			.nullish()
			.describe("Id of a saved module; absent/null creates a new one"),
		title: z.string(),
		description: z.string().nullish(),
		unlockAfterDays: z
			.number()
			.int()
			.nullish()
			.describe("Drip by days after purchase (unlockMode DAYS)"),
		unlockAt: z
			.string()
			.nullish()
			.describe("Drip by date, ISO 8601 with offset (unlockMode DATE)"),
		lessons: z.array(productLesson),
	});
	const productFields = {
		coverImageUrl: z.string().nullable(),
		price: z.number().describe("COP: integer. USD: up to 2 decimals"),
		currency: z.enum(["COP", "USD"]),
		access: z.enum(["PUBLIC", "SUBSCRIBERS"]),
		includedInMembership: z
			.boolean()
			.describe("Members of the workspace get it at no cost"),
		fileName: z.string().nullable(),
		filePath: z
			.string()
			.nullable()
			.describe(
				"DOWNLOADABLE only (required there): path of a file already " +
					"uploaded in the dashboard (private product files bucket, under " +
					"this workspace)",
			),
		sampleName: z.string().nullable(),
		samplePath: z
			.string()
			.nullable()
			.describe(
				"Free sample: path of a file already uploaded in the dashboard",
			),
		courseMeta: z
			.object({
				learn: z
					.array(z.string())
					.optional()
					.describe('"What you will learn": empty, or 3 to 8 items'),
				audience: z.string().nullish(),
				requirements: z.string().nullish(),
				level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).nullish(),
			})
			.nullish()
			.describe("COURSE only. Absent keeps the saved one; null clears it"),
		unlockMode: z
			.enum(["OPEN", "SEQUENTIAL", "DAYS", "DATE"])
			.optional()
			.describe(
				"COURSE drip rule. Absent keeps the saved one (OPEN on create)",
			),
	};
	const UPLOADS =
		" Files and lesson videos cannot be uploaded through the API: upload " +
		"them in the dashboard first and reference them here (`filePath`, " +
		"`samplePath`, lesson `videoId`/`filePath`, FILE resources).";
	const PRODUCT_ERRORS =
		" Errors: 400 `BAD_REQUEST` (a dashboard rule failed; `error.message` " +
		"says which), 400 `INVALID_FILE` (a path outside this workspace's " +
		"product files folder).";
	server.tool(
		"products_create",
		"Creates a digital product or course, as DRAFT unless `publish: true` " +
			"(POST /products). A DOWNLOADABLE needs `fileName`/`filePath`; a " +
			"COURSE needs `modules` with at least one module holding one lesson " +
			"(modules → lessons → resources / quiz). Requires ADMIN. Returns the " +
			`full product.${UPLOADS}${PRODUCT_ERRORS}`,
		{
			type: z.enum(["DOWNLOADABLE", "COURSE"]),
			name: z.string(),
			description: z.string().default(""),
			...productFields,
			coverImageUrl: productFields.coverImageUrl.default(null),
			currency: productFields.currency.default("COP"),
			access: productFields.access.default("PUBLIC"),
			includedInMembership: productFields.includedInMembership.default(false),
			fileName: productFields.fileName.default(null),
			filePath: productFields.filePath.default(null),
			sampleName: productFields.sampleName.default(null),
			samplePath: productFields.samplePath.default(null),
			modules: z
				.array(productModule)
				.default([])
				.describe("COURSE only: at least one module with one lesson"),
			publish: z
				.boolean()
				.default(false)
				.describe("true creates it PUBLISHED; default DRAFT"),
		},
		write("products_create", { destructive: false }),
		async (body) => run(postProducts({ body, client })),
	);
	server.tool(
		"products_update",
		"Updates a digital product or course; absent fields keep their saved " +
			"value (PATCH /products/{id}). ⚠️ `modules`, when sent, REPLACES THE " +
			"WHOLE COURSE TREE: modules, lessons and resources are matched by " +
			"`id` and every one missing from the list is deleted, with the " +
			"buyers' progress on it. Read the course with `products_get` " +
			"right before and send the full tree back with its ids. Omit " +
			"`modules` to edit only product fields: the course tree is left " +
			"untouched. Changing `type` or `unlockMode` requires `modules` " +
			"(400 `MODULES_REQUIRED`). New lessons on a published course with buyers " +
			"notify them, like the dashboard. Requires ADMIN. Returns the full " +
			`product.${UPLOADS}${PRODUCT_ERRORS} 409 \`COURSE_CHANGED\` (the ` +
			"course changed concurrently: read it again and retry).",
		{
			id: z.string().describe("Product id"),
			type: z.enum(["DOWNLOADABLE", "COURSE"]).optional(),
			name: z.string().optional(),
			description: z.string().optional(),
			coverImageUrl: productFields.coverImageUrl.optional(),
			price: productFields.price.optional(),
			currency: productFields.currency.optional(),
			access: productFields.access.optional(),
			includedInMembership: productFields.includedInMembership.optional(),
			fileName: productFields.fileName.optional(),
			filePath: productFields.filePath.optional(),
			sampleName: productFields.sampleName.optional(),
			samplePath: productFields.samplePath.optional(),
			modules: z
				.array(productModule)
				.optional()
				.describe(
					"FULL course tree; replaces the saved one (missing ids are " +
						"deleted). Absent keeps the saved tree",
				),
			courseMeta: productFields.courseMeta,
			unlockMode: productFields.unlockMode,
		},
		// destructive: sending `modules` deletes whatever the list leaves out.
		// openWorld: new lessons on a published course queue a buyer notification.
		write("products_update", { destructive: true, openWorld: true }),
		async ({ id, ...body }) =>
			run(patchProductsId({ path: { id }, body, client })),
	);
	server.tool(
		"products_set_status",
		"Publishes (PUBLISHED) or unpublishes (DRAFT) a digital product or " +
			"course; sending the current status is a no-op " +
			"(POST /products/{id}/status). Publishing re-checks the plan for " +
			"live lessons (403 `LIVE_LESSONS_PLAN_REQUIRED`). Requires ADMIN.",
		{
			id: z.string().describe("Product id"),
			status: z.enum(["DRAFT", "PUBLISHED"]),
		},
		write("products_set_status", { destructive: false, idempotent: true }),
		async ({ id, status }) =>
			run(postProductsIdStatus({ path: { id }, body: { status }, client })),
	);
	server.tool(
		"products_delete",
		"Deletes a digital product or course: it disappears from the dashboard, " +
			"the API and the public pages (soft delete, no restore endpoint) " +
			`(DELETE /products/{id}). Requires ADMIN.${CONFIRM}`,
		{ id: z.string().describe("Product id") },
		write("products_delete", { destructive: true }),
		async ({ id }) => run(deleteProductsId({ path: { id }, client })),
	);
}
