---
name: show-day-close
description: Close out a FreeTicket show day with the FreeTicket MCP tools — live attendance, the access-close record, attendance vs. capacity, sales and revenue of the date, stuck payments, attendee export and settlement status. Use when the user asks for the end-of-night/show-day report, the "cierre" or "acta de cierre de acceso" of an event date, or how a show went.
---

# Show-day close

Read-only unless the human asks for an action. Ask for the event (or find it
with `events_list` + `q`) and the date (`event_dates_list`).

1. **Live door.** While the show is on, `reports_live_attendance` lists the
   dates happening right now with `sold`, `validated` and `validatedPct`
   (`scope: "own"` drops hosted shows). Fine to poll, not faster than ~20 s.
2. **Access-close record.** `event_dates_access_close_status` with the date
   id: `live.issued`, `live.checkins` (what a signature would freeze now) and,
   if already closed, `closedCheckins` and who signed. Report it; do **not**
   sign on your own initiative. `event_dates_access_close_sign` is
   irreversible, emails the record to the workspace and needs ADMIN: call it
   only when the human explicitly asks to sign the record for that date,
   after showing them the current `live.checkins`. It opens 2 hours after the
   start (409 `ACCESS_CLOSE_NOT_SIGNABLE_YET` gives `signableFrom`); 409
   `ACCESS_ALREADY_CLOSED` means it is done — do not retry.
3. **Capacity and sold.** `reports_inventory` with `eventDateId`
   (`groupBy: "ticketType"`): capacity, sold, reserved, available.
4. **Revenue.** `reports_by_event` with `from`/`to` around the date, and
   `reports_timeseries` (`interval: "day"`, `event`) for the sales curve.
5. **Stuck payments.** `sales_payment_intents` with `event` and `eventDate`
   (`onlyAbandoned: true` for journeys that picked seats and never paid):
   `funnel` gives the drop-off, each journey its `stage` and `outcome`
   (`REJECTED` carries the gateway `reason`). For a specific PENDING sale,
   `sales_list` with `eventDate` and `status: "PENDING"`, then
   `sales_attempts` explains what the gateway did. Releasing the stock of a
   PENDING sale whose payment never started is `sales_abandon`; cancelling
   or refunding a confirmed one is `sales_cancel` / `sales_refund`. All three
   are irreversible: only on explicit request.
6. **Door, one ticket.** `tickets_access` with its QR code (read-only).
   Admitting someone is `tickets_checkin` — only on request.
7. **Attendees.** `reports_export_attendees` with `eventDate` (one row per
   ticket). It contains personal data: summarize, do not paste it whole
   unless asked. The same goes for names and emails in
   `sales_payment_intents`.
8. **Money.** `reports_financials` with `event` (gross, fees, net to settle
   per date) and `settlements_list` with `event` for the payout status.
   `settlements_document` returns a 5-minute signed link, not the file.

Close with a short summary: validated / sold / capacity (%), access-close
status (open, or signed with the frozen count), gross and net, abandoned or
failed payments needing attention, and the settlement status.
