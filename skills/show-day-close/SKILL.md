---
name: show-day-close
description: Close out a FreeTicket show day with the FreeTicket MCP tools — attendance vs. capacity, sales and revenue of the date, stuck payments, attendee export and settlement status. Use when the user asks for the end-of-night/show-day report, the "cierre" of an event date, or how a show went.
---

# Show-day close

Read-only unless the human asks for an action. Ask for the event (or find it
with `events_list` + `q`) and the date (`event_dates_list`).

1. **Capacity and sold.** `reports_inventory` with `eventDateId`
   (`groupBy: "ticketType"`): capacity, sold, reserved, available.
2. **Revenue.** `reports_by_event` with `from`/`to` around the date, and
   `reports_timeseries` (`interval: "day"`, `event`) for the sales curve.
3. **Problem sales.** `sales_list` with `eventDate` and `status: "PENDING"`;
   for any that look stuck, `sales_attempts` explains what the gateway did.
   Do not cancel or refund without explicit confirmation (`sales_cancel`,
   `sales_refund` are irreversible).
4. **Door.** A single ticket's status: `tickets_access` with its QR code
   (read-only). Admitting someone is `tickets_checkin` — only on request.
5. **Attendees.** `reports_export_attendees` with `eventDate` (one row per
   ticket). It contains personal data: summarize, do not paste it whole
   unless asked.
6. **Money.** `reports_financials` with `event` (gross, fees, net to settle
   per date) and `settlements_list` with `event` for the payout status.
   `settlements_document` returns a 5-minute signed link, not the file.

Close with a short summary: sold / capacity (%), gross and net, pending or
failed sales needing attention, and the settlement status.
