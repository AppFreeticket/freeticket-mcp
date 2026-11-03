---
name: publish-event
description: Publish a FreeTicket event end to end with the FreeTicket MCP tools — venue, event, dates, ticket types, optional member presale and lineup, then publish now or schedule it. Use when the user wants to create, set up, launch or put on sale a show/event in FreeTicket.
---

# Publish an event end to end

Work in ONE workspace (writes are never global). If the session reaches
several, ask which one and confirm with `whoami`.

1. **Venue.** `venues_list`; if it does not exist, `venues_create`
   (name, address, city, country ISO-2).
2. **Event (draft).** `events_create` with `name`, a unique `slug`,
   `venueId` and at least one date (`startsAt` ISO 8601, `timezone`,
   default `America/Bogota`). It is born as `DRAFT`.
3. **More dates.** `event_dates_create` per extra show. Use
   `maxPerCustomer` for a per-buyer cap and `doorsOpenAt` if known.
4. **Classification and images.** `events_update`: `genre` (+ `subgenre` or
   `genreOther` when `genre` is `otro`), `audience`, `coverImageUrl`,
   `squareImageUrl`, `storyImageUrl`. Performing arts above 400 capacity per
   date need `pulepCode` (422 `PULEP_REQUIRED`).
5. **Ticket types.** `event_dates_list` to get the date ids, then
   `ticket_types_create` per date (price in COP, `capacity`, `maxPerOrder`,
   `isVisible`, `organizerAbsorbsFee`; `saleStartsAt`/`saleEndsAt` optional).
   If the workspace has reusable templates (`ticket_templates_list`), prefer
   `ticket_templates_instantiate` with `eventDateId` (override `name`,
   `price` or `capacity` if needed): it copies price, discount, members-only
   gate and buyer form in one call.
6. **Member presale (optional).** `plans_list` → `presale_windows_create` on
   each ticket type (`planId`, `presaleStartsAt`, `presaleEndsAt` in UTC `…Z`,
   optional `presaleCapacity`). Check with `presale_windows_list`.
7. **Lineup (optional).** `artists_search` (`q` ≥ 2 chars) → `events_artists_set`
   with the FULL ordered list of ids; artists without an account go in
   `inviteEmails`. This sends emails: confirm first. Pending invites:
   `event_artist_invitations_list`.
8. **Go live — pick one, after the human confirms:**
   - now: `events_publish`;
   - later: `events_schedule` with `publishAt` (auto-publish) **or**
     `saleStartsAt` (publish now, open sales later). Undo a `publishAt`
     with `events_unschedule`.
9. **Verify.** `events_get` (status) and `reports_inventory` with `eventId`
   (capacity per date and type). Report what was created, with ids.

Rules: never invent ids — read them from the previous tool's result. Surface
API errors (`error.code`) to the human as-is instead of retrying blindly.
