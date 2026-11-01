import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	deleteDiscountsId,
	deleteEventsId,
	deleteEventsIdArtistInvitationsInvitationId,
	deleteEventsIdArtistsOrganizationId,
	deleteEventsIdDatesDateId,
	deleteEventsIdSchedule,
	deleteMembershipPlansId,
	deletePresaleWindowsId,
	deleteStaffId,
	deleteTicketsTicketCodeCheckin,
	deleteTicketTypesId,
	deleteVenuesId,
	deleteWebhooksId,
	patchCustomerProfile,
	patchDiscountsId,
	patchEventsId,
	patchEventsIdDatesDateId,
	patchMembershipPlansId,
	patchPresaleWindowsId,
	patchSalesIdRecipient,
	patchStaffIdRole,
	patchTicketsTicketCode,
	patchTicketTypesId,
	patchVenuesId,
	patchWebhooksId,
	postContentPlaybackToken,
	postContentPosts,
	postCustomerLogout,
	postCustomerOrdersIdRelease,
	postCustomerSubscriptions,
	postCustomerSubscriptionsCancel,
	postCustomerTicketsIdCancel,
	postDiscounts,
	postEvents,
	postEventsIdArtistInvitationsInvitationIdResend,
	postEventsIdCancel,
	postEventsIdDates,
	postEventsIdPublish,
	postEventsIdSchedule,
	postMembershipPlans,
	postSales,
	postSalesIdCancel,
	postSalesIdItemsItemIdTransfer,
	postSalesIdRefund,
	postStaff,
	postSubscriptionsIdCancel,
	postTicketsTicketCodeCheckin,
	postTicketsTicketCodeResend,
	postTicketTypes,
	postTicketTypesIdPresaleWindows,
	postVenues,
	postWebhooks,
	postWorkspaces,
	putEventsIdArtists,
} from "../client/sdk.gen";

/** Deletes/refunds/cancels: irreversibles. Piden confirmación humana explícita. */
const destructive = { destructiveHint: true, idempotentHint: false } as const;
/** Creates/publish: no borran datos, pero mutan. */
const mutating = { destructiveHint: false, idempotentHint: false } as const;
/** Mutates, and repeating the same call lands in the same state. */
const mutatingIdempotent = {
	destructiveHint: false,
	idempotentHint: true,
} as const;
/** Removes data, but repeating the same call lands in the same state. */
const destructiveIdempotent = {
	destructiveHint: true,
	idempotentHint: true,
} as const;
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
			slug: z.string().optional().describe("Public URL slug (409 if taken)"),
			squareImageUrl: z.string().nullish().describe("1:1 image URL"),
			storyImageUrl: z.string().nullish().describe("9:16 image URL"),
			pulepCode: z
				.string()
				.nullish()
				.describe(
					"PULEP code (Colombia). Required for performing arts with capacity over 400",
				),
			listedOnPortal: z
				.boolean()
				.optional()
				.describe("Show the event on the public portal listings"),
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
				.optional(),
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
				.nullish(),
			genreOther: z
				.string()
				.optional()
				.describe('Free-text genre when genre is "otro"'),
			audience: z
				.enum(["todo_publico", "mayores_14", "mayores_18", "infantil"])
				.nullish(),
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
		"events_cancel",
		"Cancels an event and ALL its dates, keeping the record, its sales and " +
			"tickets (POST /events/{id}/cancel). Idempotent. It does not refund: " +
			`refunds go one by one with \`sales_refund\`.${CONFIRM}`,
		{ id: z.string().describe("Event id") },
		destructive,
		async ({ id }) => run(postEventsIdCancel({ path: { id }, client })),
	);

	// ── Lineup (contract 1.25.0) ────────────────────────────────────────────
	server.tool(
		"events_artists_set",
		"Replaces an event's whole lineup (PUT /events/{id}/artists). Send the " +
			"FULL list in display order, not a diff: artists left out are unlinked, " +
			"and `[]` clears the lineup. Get ids with `artists_search` first. Newly " +
			"linked artists get a notification email. `inviteEmails` invites artists " +
			"without an account (once per email and event; additive, it never " +
			"cancels existing invitations). Ids that are not a registered artist come " +
			"back in `warnings[]` as ARTIST_IDS_IGNORED — tell the human. To drop a " +
			"single artist prefer `events_artists_remove`. If it would remove anyone, " +
			"confirm with the human first. Limits: 50 ids, 20 emails, 20 changes/hour.",
		{
			eventId: z.string().describe("Event id"),
			artistIds: z
				.array(z.string().min(1).max(64))
				.max(50)
				.describe(
					"Full lineup in order: artist workspace ids from artists_search",
				),
			inviteEmails: z
				.array(z.string().email())
				.max(20)
				.optional()
				.describe("Emails of artists without an account to invite"),
		},
		destructiveIdempotent,
		async ({ eventId, ...body }) =>
			run(putEventsIdArtists({ path: { id: eventId }, body, client })),
	);
	server.tool(
		"events_artists_remove",
		"Unlinks ONE artist from an event's lineup and leaves the rest intact " +
			"(DELETE /events/{id}/artists/{organizationId}). Works for the event's " +
			`owner, or for the artist removing itself.${CONFIRM}`,
		{
			eventId: z.string().describe("Event id"),
			organizationId: z.string().describe("Artist workspace id to unlink"),
		},
		destructiveIdempotent,
		async ({ eventId, organizationId }) =>
			run(
				deleteEventsIdArtistsOrganizationId({
					path: { id: eventId, organizationId },
					client,
				}),
			),
	);
	server.tool(
		"events_artist_invitations_resend",
		"Resends a pending or expired artist invitation email and renews it for " +
			"14 days with the same link " +
			"(POST /events/{id}/artist-invitations/{invitationId}/resend). Every call " +
			"sends another email (max 3/hour per invitation): do not retry in a loop. " +
			"409 INVITATION_ACCEPTED means the artist already joined.",
		{
			eventId: z.string().describe("Event id"),
			invitationId: z
				.string()
				.describe("Invitation id from events_artist_invitations_list"),
		},
		mutating,
		async ({ eventId, invitationId }) =>
			run(
				postEventsIdArtistInvitationsInvitationIdResend({
					path: { id: eventId, invitationId },
					client,
				}),
			),
	);
	server.tool(
		"events_artist_invitations_cancel",
		"Cancels (deletes) an artist invitation so its link stops working " +
			"(DELETE /events/{id}/artist-invitations/{invitationId}). 409 " +
			`INVITATION_ACCEPTED means the artist already joined: use \`events_artists_remove\` instead.${CONFIRM}`,
		{
			eventId: z.string().describe("Event id"),
			invitationId: z
				.string()
				.describe("Invitation id from events_artist_invitations_list"),
		},
		destructiveIdempotent,
		async ({ eventId, invitationId }) =>
			run(
				deleteEventsIdArtistInvitationsInvitationId({
					path: { id: eventId, invitationId },
					client,
				}),
			),
	);
	// ── Dashboard parity (contract 1.25.0) ──────────────────────────────────
	server.tool(
		"events_schedule",
		"Schedules a DRAFT event (POST /events/{id}/schedule). Send exactly one: " +
			"`publishAt` publishes it automatically at that UTC instant (checked " +
			"every ~5 min; future and before one of its dates), or `saleStartsAt` " +
			"publishes it NOW and opens sales at that instant on every upcoming " +
			"ticket type. 409 EVENT_NOT_DRAFT: re-read the event, it is no longer " +
			"a draft. 422 SCHEDULE_IN_PAST / SCHEDULE_AFTER_EVENT_DATE: fix the date.",
		{
			id: z.string().describe("Event id"),
			publishAt: z
				.string()
				.datetime()
				.optional()
				.describe("Publish automatically at this instant (UTC, ISO 8601)"),
			saleStartsAt: z
				.string()
				.datetime()
				.optional()
				.describe("Publish now; open sales at this instant (UTC, ISO 8601)"),
		},
		mutating,
		async ({ id, publishAt, saleStartsAt }) =>
			run(
				postEventsIdSchedule({
					path: { id },
					body: publishAt ? { publishAt } : { saleStartsAt },
					client,
				}),
			),
	);
	server.tool(
		"events_unschedule",
		"Cancels a pending scheduled publication (DELETE /events/{id}/schedule): " +
			"`publishAt` becomes null and the event keeps its status. It does not " +
			"undo a `saleStartsAt` schedule: edit the ticket types' `saleStartsAt`.",
		{ id: z.string().describe("Event id") },
		mutatingIdempotent,
		async ({ id }) => run(deleteEventsIdSchedule({ path: { id }, client })),
	);
	server.tool(
		"presale_windows_create",
		"Opens a membership presale window on a ticket type " +
			"(POST /ticket-types/{id}/presale-windows): active members of `planId` " +
			"can buy between `presaleStartsAt` and `presaleEndsAt`. One window per " +
			"plan and ticket type (409 DUPLICATE_PLAN: update the existing one). " +
			"422 PLAN_NOT_ELIGIBLE: the plan must be an active plan of the " +
			"workspace that owns the event.",
		{
			ticketTypeId: z.string().describe("Ticket type id"),
			planId: z.string().min(1).describe("Membership plan id"),
			presaleStartsAt: z.string().datetime().describe("Start (UTC, ISO 8601)"),
			presaleEndsAt: z.string().datetime().describe("End (UTC), after start"),
			presaleCapacity: z
				.number()
				.int()
				.positive()
				.nullish()
				.describe("Max tickets sold in the presale (null = no cap)"),
			isActive: z.boolean().optional(),
		},
		mutating,
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
		"Edits a presale window (PATCH /presale-windows/{id}); absent fields are " +
			"left untouched. 422 PRESALE_WINDOW_INVERTED: the end must be after the start.",
		{
			id: z.string().describe("Presale window id"),
			planId: z.string().min(1).optional(),
			presaleStartsAt: z.string().datetime().optional(),
			presaleEndsAt: z.string().datetime().optional(),
			presaleCapacity: z.number().int().positive().nullish(),
			isActive: z.boolean().optional(),
		},
		mutatingIdempotent,
		async ({ id, ...body }) =>
			run(patchPresaleWindowsId({ path: { id }, body, client })),
	);
	server.tool(
		"presale_windows_delete",
		"Deletes a presale window (DELETE /presale-windows/{id}); the plan's " +
			`members lose that presale access immediately.${CONFIRM}`,
		{ id: z.string().describe("Presale window id") },
		destructive,
		async ({ id }) => run(deletePresaleWindowsId({ path: { id }, client })),
	);
	server.tool(
		"sales_transfer",
		"Transfers ONE ticket of a sale to another person " +
			"(POST /sales/{id}/items/{itemId}/transfer). Voids the previous QR and " +
			"emails the new holder. The recipient must already have a verified " +
			"FreeTicket buyer account; each ticket transfers only once, until the " +
			"show starts. 422 RECIPIENT_NOT_REGISTERED / SELF_TRANSFER: ask the " +
			"human for a different email. 409 CONFLICT: re-read the sale and retry. " +
			`Not idempotent: do not retry after success.${CONFIRM}`,
		{
			saleId: z.string().describe("Sale id"),
			itemId: z.string().describe("Sale item (ticket) id, from sales_tickets"),
			email: z.string().email().describe("Recipient's FreeTicket email"),
		},
		destructive,
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
		"tickets_checkin_undo",
		"Undoes a door check-in so the ticket is valid again " +
			"(DELETE /tickets/{code}/checkin), to fix a wrong scan. Requires ADMIN. " +
			"Idempotent: a ticket that is not checked in answers `undone: false`. " +
			"409 CHECKIN_CHANGED: re-read the ticket (tickets_access) and retry." +
			CONFIRM,
		{ code: z.string().describe("Ticket QR code") },
		destructiveIdempotent,
		async ({ code }) =>
			run(
				deleteTicketsTicketCodeCheckin({ path: { ticketCode: code }, client }),
			),
	);
	server.tool(
		"sales_recipient_update",
		"Corrects the recipient of a dashboard-issued courtesy sale and resends " +
			"its tickets (PATCH /sales/{id}/recipient). If the email changes, the " +
			"QRs already sent are voided (`ticketCodesRotated: true`). Any non-" +
			`courtesy sale answers 404.${CONFIRM}`,
		{
			saleId: z.string().describe("Courtesy sale id"),
			name: z.string().min(2).max(120).describe("Recipient name"),
			email: z.string().email().describe("Recipient email"),
		},
		destructive,
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
			maxPerCustomer: z
				.number()
				.int()
				.positive()
				.nullish()
				.describe(
					"Max tickets one buyer can hold for this date (null = no cap)",
				),
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
			maxPerCustomer: z
				.number()
				.int()
				.positive()
				.nullish()
				.describe(
					"Max tickets one buyer can hold for this date (null = no cap)",
				),
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
			currency: z.enum(["COP"]).default("COP").describe("Only COP"),
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
		mutating,
		async ({ code, ...body }) =>
			run(patchTicketsTicketCode({ path: { ticketCode: code }, body, client })),
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
	server.tool(
		"staff_delete",
		"Revokes a staff member's access to THIS workspace and ends their live " +
			"sessions; the account and its history stay (DELETE /staff/{id})." +
			CONFIRM,
		{ id: z.string().describe("Member id") },
		destructive,
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
		mutating,
		async ({ id, ...body }) =>
			run(patchWebhooksId({ path: { id }, body, client })),
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
		destructive,
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
		destructive,
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
		mutating,
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
		mutating,
		async (body) => run(postWorkspaces({ body, client })),
	);
}
