import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	deleteContentCommentsId,
	deleteContentLivesId,
	deleteContentMembersIdBan,
	deleteContentPostsId,
	deleteContentSeriesId,
	deleteContentVideosId,
	deleteCustomerAddressesId,
	deleteDiscountsId,
	deleteEventsId,
	deleteEventsIdArtistInvitationsInvitationId,
	deleteEventsIdArtistsOrganizationId,
	deleteEventsIdDatesDateId,
	deleteEventsIdSchedule,
	deleteEventsIdViewersViewerId,
	deleteMasterQrsId,
	deleteMembershipPlansId,
	deletePresaleWindowsId,
	deleteProductsId,
	deleteStaffId,
	deleteTicketsTicketCodeCheckin,
	deleteTicketTemplatesId,
	deleteTicketTypesId,
	deleteVenuesId,
	deleteWebhooksId,
	patchContentChannelsId,
	patchContentLivesId,
	patchContentMeetupsId,
	patchContentMeetupsIdRsvpsRsvpId,
	patchContentPostsId,
	patchContentSeriesId,
	patchContentVideosId,
	patchCustomerAddressesId,
	patchCustomerProfile,
	patchDiscountsId,
	patchEventsId,
	patchEventsIdDatesDateId,
	patchMasterQrsId,
	patchMembershipPlansId,
	patchMerchProductsIdStatus,
	patchOrganization,
	patchOrganizationAnalytics,
	patchOrganizationProfile,
	patchPresaleWindowsId,
	patchProductsId,
	patchSalesIdRecipient,
	patchStaffIdRole,
	patchTicketsTicketCode,
	patchTicketTemplatesId,
	patchTicketTypesId,
	patchVenuesId,
	patchWebhooksId,
	postContentChannels,
	postContentChannelsIdArchive,
	postContentLives,
	postContentLivesIdResetKey,
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
	postContentSeries,
	postCustomerAddresses,
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
	postEventsIdValidators,
	postEventsIdViewers,
	postMasterQrs,
	postMembershipPlans,
	postMerchProducts,
	postProducts,
	postProductsIdStatus,
	postSales,
	postSalesIdAbandon,
	postSalesIdCancel,
	postSalesIdItemsItemIdTransfer,
	postSalesIdRefund,
	postStaff,
	postStaffIdResendInvite,
	postSubscriptionsIdCancel,
	postTicketsTicketCodeCheckin,
	postTicketsTicketCodeResend,
	postTicketTemplates,
	postTicketTemplatesIdInstantiate,
	postTicketTypes,
	postTicketTypesIdPresaleWindows,
	postVenues,
	postWaitlist,
	postWebhooks,
	postWorkspaces,
	putContentChannelsOrder,
	putContentMeetupsIdAttendance,
	putContentPostsIdPin,
	putContentSeriesIdPublished,
	putContentVideosIdPublished,
	putContentVideosIdSeries,
	putEventsIdArtists,
	putMasterQrsIdActive,
	putMerchProductsIdImages,
	putStaffIdAccess,
	putWebsite,
	putWebsitePublished,
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
			name: z.string().min(1).max(100),
			description: z.string().optional(),
			price: z
				.number()
				.min(0)
				.max(9999999999)
				.describe("Price in the given currency"),
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
			name: z.string().min(1).max(100).optional(),
			description: z.string().nullish(),
			price: z.number().min(0).max(9999999999).optional(),
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
		// openWorld: cancels the recurring charge in Stripe / Mercado Pago.
		write("subscriptions_cancel", { destructive: true, openWorld: true }),
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
		// openWorld: emails the invitation (sendStaffInvite).
		write("staff_create", { destructive: false, openWorld: true }),
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
		// openWorld: cancels the recurring charge in Stripe / Mercado Pago.
		write("customer_subscription_cancel", {
			destructive: true,
			openWorld: true,
		}),
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

	// ── On-demand videos, series and live streams, Mux (contract 1.31) ──────
	// Same rules as the dashboard's Content screen; writes need ADMIN and an
	// event-scoped key gets 403. Uploading a video is not possible through the
	// API (the Mux direct upload needs a browser); course lesson videos are
	// managed from their course (`products_update`) and answer 404 here.
	const STREAM_KEY_SECRET =
		" 🔒 SECRET: `streamKey` lets whoever has it broadcast on this stream in " +
		"the organization's name. Hand it to the human only if they explicitly " +
		"ask for it; do not echo it into the chat, summaries or docs otherwise, " +
		"and never paste it in shared places (tickets, channels, repos). If it " +
		"leaked, rotate it with `content_lives_reset_key`.";
	const scheduledAt =
		'Wall-clock time "YYYY-MM-DDTHH:mm" in the WORKSPACE time zone (not ' +
		"UTC, no offset); future and at most 2 years ahead";
	server.tool(
		"content_videos_update",
		"Edits an on-demand video (draft or published); only the fields sent " +
			"are written, at least one (PATCH /content/videos/{id}). Requires ADMIN.",
		{
			id: z.string().describe("Video id"),
			title: z.string().min(1).max(120).optional(),
			description: z
				.string()
				.max(2000)
				.nullish()
				.describe('null or "" clears it'),
			memberOnly: z
				.boolean()
				.optional()
				.describe("true = only current members can play it"),
		},
		write("content_videos_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchContentVideosId({ path: { id }, body, client })),
	);
	server.tool(
		"content_videos_set_published",
		"Publishes or unpublishes an on-demand video; publishing puts it in the " +
			"community feed as a VIDEO post and notifies members (once, even if " +
			"republished), unpublishing removes it from the feed " +
			"(PUT /content/videos/{id}/published). Errors: 409 `VIDEO_NOT_READY` " +
			"(Mux still processing), 409 `MEMBERSHIP_PREREQ` (no active " +
			"membership plan), 403 `FEATURE_LOCKED`. Requires ADMIN.",
		{ id: z.string().describe("Video id"), published: z.boolean() },
		// openWorld: publishing notifies the members.
		write("content_videos_set_published", {
			destructive: false,
			idempotent: true,
			openWorld: true,
		}),
		async ({ id, published }) =>
			run(
				putContentVideosIdPublished({
					path: { id },
					body: { published },
					client,
				}),
			),
	);
	server.tool(
		"content_videos_set_series",
		"Moves a video into a series, or out of it with `seriesId: null`; does " +
			"not change whether it is published (PUT /content/videos/{id}/series). " +
			"Requires ADMIN.",
		{
			id: z.string().describe("Video id"),
			seriesId: z
				.string()
				.min(1)
				.nullable()
				.describe("Series id (`content_series_list`); null leaves it loose"),
		},
		write("content_videos_set_series", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id, seriesId }) =>
			run(
				putContentVideosIdSeries({ path: { id }, body: { seriesId }, client }),
			),
	);
	server.tool(
		"content_videos_delete",
		"Deletes an on-demand video and its asset in Mux: the encoded file is " +
			"gone (no restore through the API or the dashboard) and members lose " +
			`access immediately (DELETE /content/videos/{id}). Requires ADMIN.${CONFIRM}`,
		{ id: z.string().describe("Video id") },
		// openWorld: deletes the asset in Mux.
		write("content_videos_delete", { destructive: true, openWorld: true }),
		async ({ id }) => run(deleteContentVideosId({ path: { id }, client })),
	);
	server.tool(
		"content_series_create",
		"Creates a video series, born unpublished and empty " +
			"(POST /content/series). Add videos with `content_videos_set_series` " +
			"and publish it with `content_series_set_published`. Errors: 409 " +
			"`MEMBERSHIP_PREREQ`, 403 `FEATURE_LOCKED`. Requires ADMIN.",
		{
			title: z.string().min(1).max(120),
			description: z.string().max(2000).nullish(),
			coverImageUrl: z.string().nullish().describe("Absolute URL of the cover"),
			memberOnly: z.boolean().optional().describe("Default true"),
		},
		write("content_series_create", { destructive: false }),
		async (body) => run(postContentSeries({ body, client })),
	);
	server.tool(
		"content_series_update",
		"Edits a video series; only the fields sent are written, at least one " +
			"(PATCH /content/series/{id}). Requires ADMIN.",
		{
			id: z.string().describe("Series id"),
			title: z.string().min(1).max(120).optional(),
			description: z.string().max(2000).nullish().describe("null clears it"),
			coverImageUrl: z
				.string()
				.nullish()
				.describe("Absolute URL; null clears it"),
			memberOnly: z.boolean().optional(),
		},
		write("content_series_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchContentSeriesId({ path: { id }, body, client })),
	);
	server.tool(
		"content_series_set_published",
		"Publishes or unpublishes a video series; its videos keep their own " +
			"published state. Publishing again refreshes `publishedAt` " +
			"(PUT /content/series/{id}/published). Requires ADMIN.",
		{ id: z.string().describe("Series id"), published: z.boolean() },
		write("content_series_set_published", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id, published }) =>
			run(
				putContentSeriesIdPublished({
					path: { id },
					body: { published },
					client,
				}),
			),
	);
	server.tool(
		"content_series_delete",
		"Deletes a video series (soft delete, no restore through the API). Its " +
			"videos are NOT deleted or unpublished but are left loose, so the " +
			`grouping and order are lost (DELETE /content/series/{id}). Requires ADMIN.${CONFIRM}`,
		{ id: z.string().describe("Series id") },
		write("content_series_delete", { destructive: true }),
		async ({ id }) => run(deleteContentSeriesId({ path: { id }, client })),
	);
	server.tool(
		"content_lives_create",
		"Creates a live stream in Mux and returns the RTMPS server (`rtmpUrl`) " +
			"and the `streamKey` to configure OBS or any encoder " +
			"(POST /content/lives). The key comes back ONLY here and from " +
			"`content_lives_reset_key`, never from the reads. `memberOnly` is " +
			"forced to false without an active membership plan; with " +
			"`eventDateId` and no `scheduledAt` it inherits the show's start. " +
			"Errors: 400 `INVALID_SCHEDULE`, 403 `FEATURE_LOCKED`, 409 " +
			"`EVENT_DATE_HAS_LIVE`, 502 `MUX_ERROR` (nothing created). Requires " +
			`ADMIN.${STREAM_KEY_SECRET}`,
		{
			title: z.string().min(1).max(120),
			eventDateId: z
				.string()
				.nullish()
				.describe("Show date to tie it to (one stream per date)"),
			memberOnly: z.boolean().optional().describe("Default true"),
			scheduledAt: z.string().nullish().describe(scheduledAt),
		},
		// openWorld: creates the stream in Mux.
		write("content_lives_create", { destructive: false, openWorld: true }),
		async (body) => run(postContentLives({ body, client })),
	);
	server.tool(
		"content_lives_update",
		"Changes a live stream's scheduled time and/or members-only flag; absent " +
			"fields keep their value. Never returns the stream key " +
			"(PATCH /content/lives/{id}). Errors: 409 `LIVE_NOT_IDLE` " +
			"(`scheduledAt` on a stream on air or ended), 409 `MEMBERSHIP_PREREQ`. " +
			"Requires ADMIN.",
		{
			id: z.string().describe("Live stream id"),
			scheduledAt: z
				.string()
				.nullish()
				.describe(`${scheduledAt}; null removes it. Only while IDLE`),
			memberOnly: z.boolean().optional(),
		},
		write("content_lives_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchContentLivesId({ path: { id }, body, client })),
	);
	server.tool(
		"content_lives_reset_key",
		"Rotates a live stream's stream key in Mux and returns the new one with " +
			"the RTMPS server (POST /content/lives/{id}/reset-key). The current " +
			"key stops working immediately: an encoder on it is disconnected and " +
			"must be reconfigured. Use it when the key may have leaked. 502 " +
			`\`MUX_ERROR\`: the old key keeps working. Requires ADMIN.${CONFIRM}` +
			STREAM_KEY_SECRET,
		{ id: z.string().describe("Live stream id") },
		// openWorld: calls Mux.
		write("content_lives_reset_key", { destructive: true, openWorld: true }),
		async ({ id }) => run(postContentLivesIdResetKey({ path: { id }, client })),
	);
	server.tool(
		"content_lives_delete",
		"Deletes a live stream in Mux (its stream key stops working and an " +
			"encoder on air is cut off) and soft-deletes it locally; no restore " +
			`through the API (DELETE /content/lives/{id}). Requires ADMIN.${CONFIRM}`,
		{ id: z.string().describe("Live stream id") },
		// openWorld: deletes the stream in Mux.
		write("content_lives_delete", { destructive: true, openWorld: true }),
		async ({ id }) => run(deleteContentLivesId({ path: { id }, client })),
	);

	// ── Workspace configuration (contract 1.32) ──────────────────────────────
	// Website, profile, organization identity, ticket templates and box-office
	// QR codes. Writes need ADMIN; an event-scoped key gets 403.
	const nullableText = (max: number) => z.string().max(max).nullable();
	const nullableUrl = z.string().url().max(500).nullish();
	server.tool(
		"website_put",
		"Saves the workspace website configuration (PUT /website). ⚠️ FULL " +
			"REPLACEMENT: every field is required and `null` clears an optional " +
			"text. Read `website_get` first and send everything back. `name`, " +
			"`bio`, `instagramUrl`, `tiktokUrl` and `youtubeUrl` are the same " +
			"columns `organization_profile_update` edits: a `null` here wipes them " +
			"there too. Photo and cover are not edited here " +
			"(`organization_update`). Errors: 403 `FEATURE_LOCKED` (plan without " +
			`custom landing), 400 \`INVALID_SECTIONS\`. Requires ADMIN.${CONFIRM}`,
		{
			name: z.string().min(1).max(100),
			tagline: nullableText(200),
			bio: nullableText(5000),
			instagramUrl: nullableText(500),
			tiktokUrl: nullableText(500),
			youtubeUrl: nullableText(500),
			accentColor: z
				.string()
				.regex(/^#[0-9a-fA-F]{6}$/)
				.describe("#RRGGBB"),
			webTemplate: z.string().min(1).max(32),
			webSections: z
				.record(z.union([z.boolean(), z.array(z.string())]))
				.describe(
					"Visibility booleans for shows, productos, posts, membresias, " +
						"contenido, bio, redes, plus `order` (array of section ids). " +
						"Unknown keys are dropped",
				),
		},
		// destructive: a full replace; any field sent as null is wiped, here and
		// on the profile that shares the columns.
		write("website_put", { destructive: true, idempotent: true }),
		async (body) => run(putWebsite({ body, client })),
	);
	server.tool(
		"website_set_published",
		"Lists or unlists the organization's public page in /artistas " +
			"(PUT /website/published); send the desired state. Only the " +
			"organization's primary workspace can do it. Errors: 409 " +
			"`NOT_PRIMARY_WORKSPACE`, 409 `NO_ORGANIZATION`, 409 " +
			"`PROFILE_INCOMPLETE` (publishing needs brand name and profile " +
			"photo). Requires ADMIN.",
		{ published: z.boolean() },
		write("website_set_published", { destructive: false, idempotent: true }),
		async ({ published }) =>
			run(putWebsitePublished({ body: { published }, client })),
	);
	server.tool(
		"organization_update",
		"Updates the umbrella organization's public identity: name, profile " +
			"photo and cover; absent fields keep their value, `null` clears an " +
			"image (PATCH /organization). The name is mirrored to the primary " +
			"workspace; the slug cannot be changed here. Requires ADMIN and being " +
			"OWNER/ADMIN of the organization (403 `ORG_ADMIN_REQUIRED`).",
		{
			name: z.string().min(2).max(80).optional(),
			logoUrl: nullableUrl,
			coverUrl: nullableUrl,
		},
		write("organization_update", { destructive: false }),
		async (body) => run(patchOrganization({ body, client })),
	);
	server.tool(
		"organization_analytics_update",
		"Sets the brand's own GA4 Measurement ID, added to the checkout of its " +
			"events next to FreeTicket's; `null` disconnects it " +
			"(PATCH /organization/analytics). Requires ADMIN and being " +
			"OWNER/ADMIN of the organization (403 `ORG_ADMIN_REQUIRED`).",
		{
			ga4MeasurementId: z
				.string()
				.max(32)
				.nullable()
				.describe("G-XXXXXXXXXX; null disconnects it"),
		},
		write("organization_analytics_update", {
			destructive: false,
			idempotent: true,
		}),
		async (body) => run(patchOrganizationAnalytics({ body, client })),
	);
	server.tool(
		"organization_profile_update",
		"Updates the workspace profile by optional sections: `artist`, `visual` " +
			"(brand photo/cover, on the umbrella organization), `contact` and " +
			"`social` (PATCH /organization/profile). Only the fields sent are " +
			"written; `null` clears an optional one. Sections apply in order " +
			"artist → visual → contact → social and a failure keeps the earlier " +
			"ones saved. Changing `artist.slug` changes the workspace's URLs. " +
			"`visual` and `artist.name` also require being OWNER/ADMIN of the " +
			"organization (403 `ORG_ADMIN_REQUIRED`, checked before writing " +
			"anything). Errors: 409 `SLUG_TAKEN`, 409 `ORG_NOT_INITIALIZED`. " +
			"Requires ADMIN.",
		{
			artist: z
				.object({
					name: z.string().min(1).max(100).optional(),
					slug: z
						.string()
						.min(1)
						.max(50)
						.regex(/^[a-z0-9-]+$/)
						.optional(),
					bio: z.string().max(5000).nullish(),
					type: z.enum(["ARTIST", "VENUE", "ORGANIZER"]).optional(),
					country: z
						.string()
						.length(2)
						.optional()
						.describe("ISO 3166-1 alpha-2"),
					timezone: z.string().min(1).optional().describe("IANA time zone"),
				})
				.optional(),
			visual: z
				.object({ logoUrl: nullableUrl, coverUrl: nullableUrl })
				.optional(),
			contact: z
				.object({
					email: z.string().email().max(200).nullish(),
					phone: z.string().max(40).nullish(),
					website: nullableUrl,
				})
				.optional(),
			social: z
				.object({
					instagramUrl: nullableUrl,
					facebookUrl: nullableUrl,
					twitterUrl: nullableUrl,
					spotifyUrl: nullableUrl,
					youtubeUrl: nullableUrl,
					tiktokUrl: nullableUrl,
				})
				.optional(),
		},
		write("organization_profile_update", { destructive: false }),
		async (body) => run(patchOrganizationProfile({ body, client })),
	);

	const templateField = z.object({
		label: z.string().min(1).max(100),
		fieldType: z.enum(["TEXT", "NUMBER", "SELECT", "EMAIL", "PHONE"]),
		options: z
			.array(z.string().min(1).max(100))
			.max(20)
			.optional()
			.describe("SELECT only: at least 2 options"),
		isRequired: z.boolean().default(false),
	});
	const templateFields = {
		description: nullableText(500).optional(),
		capacity: z.number().int().positive().nullish().describe("null = no cap"),
		accentColor: z.string().nullish(),
		includes: nullableText(500).optional(),
		instructions: nullableText(2000).optional(),
		discount: z
			.object({
				planId: z
					.string()
					.min(1)
					.max(50)
					.describe("Active membership plan of this workspace"),
				percent: z.number().int().min(1).max(100),
			})
			.nullish()
			.describe("Member discount; null = none"),
		membersOnlyPlanId: z
			.string()
			.min(1)
			.max(50)
			.nullish()
			.describe("Members-only gate plan; null = open to everyone"),
	};
	const TEMPLATE_ERRORS =
		" Errors: 400 `INVALID_CURRENCY`, 400 `DISCOUNT_PLAN_INVALID`, 400 " +
		"`MEMBERS_ONLY_PLAN_INVALID`.";
	server.tool(
		"ticket_templates_create",
		"Creates a reusable ticket template (POST /ticket-templates). A SELECT " +
			`field needs at least 2 options (422). Requires ADMIN.${TEMPLATE_ERRORS}`,
		{
			name: z.string().min(1).max(100),
			price: z.number().min(0),
			currency: z.string().length(3).default("COP"),
			maxPerOrder: z.number().int().positive().default(10),
			organizerAbsorbsFee: z.boolean().default(false),
			isActive: z.boolean().default(true),
			sortOrder: z.number().int().default(0),
			fields: z
				.array(templateField)
				.max(15)
				.default([])
				.describe("Buyer form fields"),
			...templateFields,
		},
		write("ticket_templates_create", { destructive: false }),
		async (body) => run(postTicketTemplates({ body, client })),
	);
	server.tool(
		"ticket_templates_update",
		"Edits a ticket template; only the fields sent are written and `null` " +
			"clears an optional one (PATCH /ticket-templates/{id}). `fields`, when " +
			"sent, replaces the whole buyer-form list. Ticket types already " +
			"created from the template are copies and do not change. Requires " +
			`ADMIN.${TEMPLATE_ERRORS}`,
		{
			id: z.string().describe("Template id"),
			name: z.string().min(1).max(100).optional(),
			price: z.number().min(0).optional(),
			currency: z.string().length(3).optional(),
			maxPerOrder: z.number().int().positive().optional(),
			organizerAbsorbsFee: z.boolean().optional(),
			isActive: z.boolean().optional(),
			sortOrder: z.number().int().optional(),
			fields: z
				.array(templateField)
				.max(15)
				.optional()
				.describe("Replaces the whole list; absent keeps it"),
			...templateFields,
		},
		write("ticket_templates_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchTicketTemplatesId({ path: { id }, body, client })),
	);
	server.tool(
		"ticket_templates_delete",
		"Deletes a ticket template (soft delete, no restore through the API); " +
			"ticket types already created from it keep working " +
			`(DELETE /ticket-templates/{id}). Requires ADMIN.${CONFIRM}`,
		{ id: z.string().describe("Template id") },
		write("ticket_templates_delete", { destructive: true }),
		async ({ id }) => run(deleteTicketTemplatesId({ path: { id }, client })),
	);
	server.tool(
		"ticket_templates_instantiate",
		"Creates a ticket type on an event date by copying a template (price, " +
			"capacity, discount, members-only gate, buyer form) " +
			"(POST /ticket-templates/{id}/instantiate). `name`, `price` and " +
			"`capacity` override the template's; a discount or gate whose plan " +
			"is no longer valid is dropped instead of failing. Returns " +
			"`ticketTypeId`. Errors: 404 `EVENT_DATE_NOT_FOUND`, 400 " +
			"`CAPACITY_REQUIRED` (template without capacity). Requires ADMIN.",
		{
			id: z.string().describe("Template id"),
			eventDateId: z.string().min(1).describe("Event date of this workspace"),
			name: z.string().min(1).max(100).optional(),
			price: z.number().min(0).optional(),
			capacity: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Required when the template has no capacity"),
		},
		write("ticket_templates_instantiate", { destructive: false }),
		async ({ id, ...body }) =>
			run(postTicketTemplatesIdInstantiate({ path: { id }, body, client })),
	);

	const QR_SECRET =
		" 🔒 SECRET: the returned `code` and `url` are what the printed QR " +
		"encodes and open the sale flow; they cannot be rotated. Do not echo " +
		"them into the chat or any doc unless the human explicitly asks, and " +
		"never paste them in shared places; refer to the QR by `id`/`label`.";
	const qrTarget = {
		eventId: z
			.string()
			.min(1)
			.max(60)
			.nullish()
			.describe("Event id; absent/null = org-wide QR (all shows)"),
		ticketTypeId: z
			.string()
			.min(1)
			.max(60)
			.nullish()
			.describe("Pins a ticket type of that event; not on org-wide QRs"),
	};
	const qrMode = z
		.enum(["EVENT", "TODAY"])
		.describe(
			"EVENT: opens the event page (or the tenant listings when org-wide). " +
				"TODAY: jumps to today's show",
		);
	server.tool(
		"master_qrs_create",
		"Creates a master box-office QR code (POST /master-qrs). Error: 400 " +
			`\`INVALID_TARGET\`. Requires ADMIN.${QR_SECRET}`,
		{ label: z.string().min(1).max(80), mode: qrMode, ...qrTarget },
		write("master_qrs_create", { destructive: false }),
		async (body) => run(postMasterQrs({ body, client })),
	);
	server.tool(
		"master_qrs_update",
		"Edits a master QR: `label` and `mode` alone, or the target " +
			"(`eventId` + `ticketTypeId`) as a pair, 422 otherwise " +
			"(PATCH /master-qrs/{id}). The code does not change: the printed QR " +
			"keeps working and now points to the new target. Requires " +
			`ADMIN.${QR_SECRET}`,
		{
			id: z.string().describe("QR id"),
			label: z.string().min(1).max(80).optional(),
			mode: qrMode.optional(),
			...qrTarget,
		},
		write("master_qrs_update", { destructive: false }),
		async ({ id, ...body }) =>
			run(patchMasterQrsId({ path: { id }, body, client })),
	);
	server.tool(
		"master_qrs_set_active",
		"Activates or pauses a master QR; while inactive, scanning it answers " +
			"404 (PUT /master-qrs/{id}/active). Send the desired state. Requires " +
			"ADMIN.",
		{ id: z.string().describe("QR id"), active: z.boolean() },
		write("master_qrs_set_active", { destructive: false, idempotent: true }),
		async ({ id, active }) =>
			run(putMasterQrsIdActive({ path: { id }, body: { active }, client })),
	);
	server.tool(
		"master_qrs_delete",
		"Deletes a master QR: the printed code stops working for good (soft " +
			"delete, scan history kept, no restore through the API) " +
			"(DELETE /master-qrs/{id}). To pause it instead use " +
			`\`master_qrs_set_active\`. Requires ADMIN.${CONFIRM}`,
		{ id: z.string().describe("QR id") },
		write("master_qrs_delete", { destructive: true }),
		async ({ id }) => run(deleteMasterQrsId({ path: { id }, client })),
	);

	// ── Contract 1.33–1.36: transfers, courtesies, check-in undo, access ─────
	server.tool(
		"sales_transfer",
		"Transfers ONE ticket of a sale to another person " +
			"(POST /sales/{id}/items/{itemId}/transfer). Voids the previous QR " +
			"(the ticket code rotates and Apple Wallet passes stop working) and " +
			"emails the new holder and the buyer. The recipient must already have " +
			"a verified FreeTicket buyer account; each ticket transfers only once, " +
			"until the show starts. 422 RECIPIENT_NOT_REGISTERED / SELF_TRANSFER: " +
			"ask the human for a different email. 409 CONFLICT: re-read the sale " +
			`and retry. Not idempotent: do not retry after success.${CONFIRM}`,
		{
			saleId: z.string().describe("Sale id"),
			itemId: z.string().describe("Sale item (ticket) id, from sales_tickets"),
			email: z
				.string()
				.email()
				.max(254)
				.describe("Recipient's FreeTicket email"),
		},
		write("sales_transfer", {
			destructive: true,
			idempotent: false,
			openWorld: true,
		}),
		async ({ saleId, itemId, email }) =>
			run(
				postSalesIdItemsItemIdTransfer({
					path: { id: saleId, itemId },
					body: { email },
					client,
				}),
			),
	);
	server.tool(
		"sales_recipient_update",
		"Corrects the recipient of a dashboard-issued courtesy sale and resends " +
			"its tickets by email (PATCH /sales/{id}/recipient). If the email " +
			"changes, the QRs already sent are voided (`ticketCodesRotated: true`). " +
			`Any non-courtesy sale answers 404.${CONFIRM}`,
		{
			saleId: z.string().describe("Courtesy sale id"),
			name: z.string().min(2).max(120).describe("Recipient name"),
			email: z.string().email().max(254).describe("Recipient email"),
		},
		write("sales_recipient_update", {
			destructive: true,
			idempotent: false,
			openWorld: true,
		}),
		async ({ saleId, name, email }) =>
			run(
				patchSalesIdRecipient({
					path: { id: saleId },
					body: { name, email },
					client,
				}),
			),
	);
	server.tool(
		"tickets_checkin_undo",
		"Undoes a door check-in so the ticket is valid again " +
			"(DELETE /tickets/{code}/checkin), to fix a wrong scan; it is recorded " +
			"in the audit log. Requires ADMIN. Idempotent: a ticket that is not " +
			"checked in answers `undone: false`. 409 CHECKIN_CHANGED: re-read the " +
			`ticket (tickets_access) and retry.${CONFIRM}`,
		{ code: z.string().describe("Ticket QR code") },
		write("tickets_checkin_undo", { destructive: true, idempotent: true }),
		async ({ code }) =>
			run(
				deleteTicketsTicketCodeCheckin({ path: { ticketCode: code }, client }),
			),
	);
	server.tool(
		"events_viewers_add",
		"Grants a person read-only access to one event's statistics and emails " +
			"them the link (POST /events/{id}/viewers). Without an account for that " +
			"email, a read-only account is created and a second email lets them set " +
			"a password. 201 new access, 200 already existed (the email is sent " +
			"again). 502 EMAIL_NOT_SENT: the access WAS granted, retry only to " +
			"resend. 10 per 10 minutes per key (429).",
		{
			eventId: z.string().describe("Event id"),
			email: z.string().email().max(255).describe("Viewer's email"),
		},
		write("events_viewers_add", { destructive: false, openWorld: true }),
		async ({ eventId, email }) =>
			run(
				postEventsIdViewers({
					path: { id: eventId },
					body: { email },
					client,
				}),
			),
	);
	server.tool(
		"events_viewers_delete",
		"Revokes one person's read-only access to an event's statistics " +
			"(DELETE /events/{id}/viewers/{viewerId}); their account is kept. " +
			"`viewerId` is the access id from `events_viewers_list`, not the user " +
			`id.${CONFIRM}`,
		{
			eventId: z.string().describe("Event id"),
			viewerId: z.string().describe("Access id from events_viewers_list"),
		},
		write("events_viewers_delete", { destructive: true }),
		async ({ eventId, viewerId }) =>
			run(
				deleteEventsIdViewersViewerId({
					path: { id: eventId, viewerId },
					client,
				}),
			),
	);
	server.tool(
		"events_validators_add",
		"Assigns door staff to validate tickets for one event " +
			"(POST /events/{id}/validators). Without an account for that email, a " +
			"STAFF account is created and an invitation email is sent " +
			"(`invited: true`). Assignments are additive. To remove a validator, " +
			"use `staff_access_set` or `staff_delete`. 409 " +
			"VALIDATOR_OTHER_WORKSPACE when that person cannot be a validator here. " +
			"10 per 10 minutes per key (429).",
		{
			eventId: z.string().describe("Event id"),
			name: z.string().min(2).max(100).describe("Validator's name"),
			email: z.string().email().max(255).describe("Validator's email"),
		},
		write("events_validators_add", { destructive: false, openWorld: true }),
		async ({ eventId, ...body }) =>
			run(postEventsIdValidators({ path: { id: eventId }, body, client })),
	);
	server.tool(
		"staff_resend_invite",
		"Emails a staff member their invitation link again, the same persistent " +
			"link (POST /staff/{id}/resend-invite); the link itself is never " +
			"returned. 409 NO_EMAIL for quick-access accounts without email. 502 " +
			"EMAIL_NOT_SENT: retry. 3 per hour per key and user (429).",
		{ id: z.string().describe("Staff member (user) id") },
		write("staff_resend_invite", { destructive: false, openWorld: true }),
		async ({ id }) => run(postStaffIdResendInvite({ path: { id }, client })),
	);
	server.tool(
		"staff_access_set",
		"REPLACES what a staff member can do in the active workspace " +
			"(PUT /staff/{id}/access): whatever the body leaves out is removed. " +
			"`accessType`: `admin` (everything; only a SUPER_ADMIN grants it), " +
			"`validador` (ticket validation only, limited to `validatorEventIds`, " +
			"empty = every event), `personalizado` (only the listed `sections`; " +
			"`validar` also enables validation) or `lectura` (read-only stats of " +
			"`viewerEventIds`). `expiresAt` `YYYY-MM-DD` or null = permanent. " +
			`Nobody can change their own access (409 SELF_ACCESS).${CONFIRM}`,
		{
			id: z.string().describe("Staff member (user) id"),
			accessType: z.enum(["admin", "validador", "personalizado", "lectura"]),
			sections: z
				.array(
					z.enum([
						"inicio",
						"eventos",
						"validar",
						"membresias",
						"contenido",
						"productos",
						"pagina_web",
						"comunicacion",
						"informes",
						"liquidaciones",
						"tienda",
						"perfil",
					]),
				)
				.max(50)
				.optional()
				.describe("Dashboard sections, for `personalizado`"),
			validatorEventIds: z
				.array(z.string().min(1).max(64))
				.max(200)
				.optional()
				.describe("Events it can validate (empty = all)"),
			viewerEventIds: z
				.array(z.string().min(1).max(64))
				.max(200)
				.optional()
				.describe("Events whose stats it can read, for `lectura`"),
			expiresAt: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.nullable()
				.optional()
				.describe("Last day of access (YYYY-MM-DD), null = permanent"),
		},
		write("staff_access_set", { destructive: true, idempotent: true }),
		async ({ id, ...body }) =>
			run(putStaffIdAccess({ path: { id }, body, client })),
	);

	// ── Buyer address book (contract 1.39+) ──────────────────────────────────
	// Shared across brands: it belongs to the buyer's FreeTicket account, so
	// any key (or none) with the buyer session edits the same book.
	const ADDRESS_NOTE =
		" Colombia only: `departmentCode` is the 2-digit DANE department and " +
		"`cityCode` the 5-digit DANE city that starts with it (Bogotá = `11` / " +
		"`11001`); 422 when the city does not belong to the department. Requires " +
		"the buyer session; the enterprise API key is optional.";
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
			customerSession,
		},
		write("customer_addresses_create", { destructive: false }),
		async ({ customerSession, ...body }) =>
			run(
				postCustomerAddresses({
					body,
					headers: { "X-Customer-Session": customerSession },
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
			customerSession,
		},
		write("customer_addresses_update", { destructive: false }),
		async ({ id, customerSession, ...body }) =>
			run(
				patchCustomerAddressesId({
					path: { id },
					body,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_addresses_delete",
		"Deletes one of the buyer's addresses (DELETE /customer/addresses/{id}); " +
			"deleting the default promotes the most recent remaining one. Another " +
			"buyer's address answers 404 `ADDRESS_NOT_FOUND`. Requires the buyer " +
			`session.${CONFIRM}`,
		{ id: z.string().describe("Address id"), customerSession },
		write("customer_addresses_delete", { destructive: true }),
		async ({ id, customerSession }) =>
			run(
				deleteCustomerAddressesId({
					path: { id },
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);

	// ── Merch store catalog admin (contract 1.37+) ───────────────────────────
	// The store is always the workspace organization's. Roles: ADMIN,
	// SUPER_ADMIN or MERCH_MANAGER. Uploading photo bytes is not a tool (see
	// coverage.test.ts): `ft merch products create` does it from disk.
	const MERCH_ERRORS =
		" Requires ADMIN, SUPER_ADMIN or MERCH_MANAGER. 403 MERCH_STORE_LOCKED " +
		"without an active Legend plan; 404 STORE_NOT_FOUND when the store was " +
		"never created (it is created from the dashboard).";
	const IMAGE_URLS =
		"Each must be a `publicUrl` already uploaded for this organization " +
		"(422 `INVALID_IMAGE_URL` otherwise); external URLs are never fetched";
	server.tool(
		"merch_products_create",
		"Creates a merch product with its options and the FULL variant matrix " +
			"in one transaction, always as DRAFT — publish it with " +
			"`merch_products_set_status` (POST /merch/products). Variants must be " +
			"exactly the combinations of the option values, each once; no options " +
			"= one variant with empty `attributes`. 400 `BAD_REQUEST` when a " +
			"dashboard rule fails (`error.message` says which), 409 `SLUG_TAKEN` / " +
			`\`SKU_TAKEN\`.${MERCH_ERRORS}`,
		{
			name: z.string().min(1).max(120),
			description: z.string().max(5000).nullish(),
			slug: z
				.string()
				.max(60)
				.optional()
				.describe("Lowercase, digits and dashes; omitted = from the name"),
			maxPerOrder: z
				.number()
				.int()
				.min(1)
				.max(100)
				.describe("Maximum units of this product per order"),
			maxPerCustomer: z
				.number()
				.int()
				.min(1)
				.max(1_000_000)
				.nullish()
				.describe(
					"Soft limit of units per person across their orders; omitted/null = no limit",
				),
			membersOnly: z
				.boolean()
				.optional()
				.describe("Only buyers with an active membership can order it"),
			sortOrder: z.number().int().optional(),
			options: z
				.array(
					z.object({
						name: z.string().min(1).max(40).describe("e.g. `Talla`"),
						values: z
							.array(z.string().min(1).max(60))
							.min(1)
							.max(30)
							.describe('Values in display order, e.g. `["S", "M"]`'),
					}),
				)
				.max(3)
				.optional()
				.describe("Up to 3 options"),
			variants: z
				.array(
					z.object({
						attributes: z
							.record(z.string(), z.string())
							.optional()
							.describe('One value per option: `{ "Talla": "M" }`'),
						sku: z
							.string()
							.min(1)
							.max(64)
							.describe("Unique in the store; letters, digits, `.`, `-`, `_`"),
						// The OpenAPI only says integer; the server's dashboard rule
						// (free-admin tienda/rules.ts) answers 400 outside 1..100M.
						price: z
							.number()
							.int()
							.positive()
							.max(100_000_000)
							.describe("COP, integer, VAT included, 1 to 100,000,000"),
						compareAtPrice: z
							.number()
							.int()
							.positive()
							.max(100_000_000)
							.nullish()
							.describe("Strikethrough price, greater than `price`"),
						stock: z.number().int().min(0),
						isActive: z.boolean().optional(),
					}),
				)
				.min(1)
				.max(100),
			imageUrls: z
				.array(z.string())
				.max(10)
				.optional()
				.describe(`Ordered photos, the first is the cover. ${IMAGE_URLS}`),
		},
		write("merch_products_create", { destructive: false }),
		async (body) => run(postMerchProducts({ body, client })),
	);
	server.tool(
		"merch_products_set_status",
		"Publishes (PUBLISHED) or hides (DRAFT) a merch product; sending the " +
			"current status is a no-op (PATCH /merch/products/{id}/status). " +
			"Publishing needs the store onboarding done (409 " +
			"`STORE_NOT_ONBOARDED`), a connected Mercado Pago account (409 " +
			"`STORE_PAYMENTS_NOT_CONNECTED`) and an active variant (409 " +
			"`NO_ACTIVE_VARIANT`). DRAFT keeps existing orders." +
			MERCH_ERRORS,
		{
			id: z.string().describe("Merch product id"),
			status: z.enum(["DRAFT", "PUBLISHED"]),
		},
		write("merch_products_set_status", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id, status }) =>
			run(
				patchMerchProductsIdStatus({ path: { id }, body: { status }, client }),
			),
	);
	server.tool(
		"merch_products_set_images",
		"Replaces the ordered photos of a merch product; the first is the cover, " +
			"max 10, no repeats (PUT /merch/products/{id}/images). Photos that " +
			"leave the list are DELETED from storage; `[]` clears them all. " +
			`${IMAGE_URLS}, or one the product already has.${MERCH_ERRORS}${CONFIRM}`,
		{
			id: z.string().describe("Merch product id"),
			imageUrls: z
				.array(z.string())
				.max(10)
				.describe("FULL ordered list; replaces the current one"),
		},
		// destructive: photos left out of the list are deleted from storage.
		write("merch_products_set_images", { destructive: true, idempotent: true }),
		async ({ id, imageUrls }) =>
			run(
				putMerchProductsIdImages({ path: { id }, body: { imageUrls }, client }),
			),
	);
}
