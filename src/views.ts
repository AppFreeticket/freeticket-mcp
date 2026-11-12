import { z } from "zod";

/**
 * Trimmed views for the heaviest lists, and the shared `limit` param.
 *
 * A view keeps what an agent needs to answer and to chain the next call (ids,
 * codes, status, amounts, dates, names/emails) and drops the rest: document
 * numbers, phones, gateway refs, fee breakdowns. Null fields are dropped too —
 * an absent key reads the same as `null` and costs nothing. `verbose: true` on
 * the tool returns the row as the API sent it, so nothing trimmed here is lost.
 * ponytail: trimming in the client. If the API grows a `fields` param, ask for
 * it upstream and delete this.
 */

/**
 * `limit` as a number (what the contract says), still accepting the string
 * the schemas used to declare so older clients keep working.
 */
export const limitParam = z.coerce
	.number()
	.int()
	.min(1)
	.max(100)
	.optional()
	.describe("Results per page (1-100)");

/** The `verbose` escape hatch, same name and meaning as in `events_list`. */
export const verboseParam = z
	.boolean()
	.optional()
	.describe(
		"Return each row exactly as the API sends it. The trimmed view is the " +
			"default: ids, codes, status, amounts, dates and buyer name/email.",
	);

/** Keeps `fields` (in that order) and drops null/undefined values. */
export function pick(
	row: unknown,
	fields: readonly string[],
): Record<string, unknown> {
	const full = (row ?? {}) as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const f of fields) {
		const v = full[f];
		if (v !== null && v !== undefined) out[f] = v;
	}
	return out;
}

export const SALE_FIELDS = [
	"id",
	"reference",
	"status",
	"channel",
	"total",
	"discountAmount",
	"currency",
	"buyerName",
	"buyerEmail",
	"createdAt",
	"confirmedAt",
	"paymentStatus",
	"failureReason",
	"declineCode",
	// Fan-out tags (workspaces.ts): they must survive the trim.
	"workspaceId",
	"workspaceName",
] as const;

export const SALE_TICKET_FIELDS = [
	"id",
	"ticketCode",
	"ticketTypeId",
	"ticketTypeName",
	"quantity",
	"seatLabel",
	"checkedInAt",
	"refundedAt",
	"refundAmount",
] as const;

export const SALE_ATTEMPT_FIELDS = [
	"id",
	"provider",
	"status",
	"amount",
	"declineCode",
	"declineReason",
	"createdAt",
] as const;

export const ATTENDEE_FIELDS = [
	"reference",
	"ticketCode",
	"name",
	"email",
	"quantity",
	"checkedInAt",
	"eventId",
	"eventName",
	"eventDateId",
	"eventDateStartsAt",
	"ticketTypeId",
	"ticketTypeName",
	"saleStatus",
	"createdAt",
] as const;

const BUYER_FIELDS = [
	"reference",
	"name",
	"email",
	"total",
	"currency",
	"saleStatus",
	"createdAt",
] as const;

const BUYER_ITEM_FIELDS = [
	"eventId",
	"eventName",
	"eventDateId",
	"ticketTypeName",
	"quantity",
] as const;

/** Buyer export row: the nested items keep only what names the purchase. */
export function slimBuyer(row: unknown): Record<string, unknown> {
	const slim = pick(row, BUYER_FIELDS);
	const items = (row as { items?: unknown[] } | null)?.items;
	if (Array.isArray(items))
		slim.items = items.map((i) => pick(i, BUYER_ITEM_FIELDS));
	return slim;
}

type Envelope = { data?: unknown; [k: string]: unknown };

/**
 * Applies a row view to an SDK result (`{ data: { data: rows, page } }`),
 * leaving errors and non-list shapes untouched. Returns the same type so it
 * slots into `run()` and `runWorkspaceList()` as-is.
 */
export function slimResult<R extends { data?: unknown; error?: unknown }>(
	res: R,
	view: (row: unknown) => Record<string, unknown>,
	verbose?: boolean,
): R {
	if (verbose || res.error !== undefined || !res.data) return res;
	const env = res.data as Envelope;
	if (!Array.isArray(env.data)) return res;
	return { ...res, data: { ...env, data: env.data.map(view) } };
}

/** `pick` bound to a field list, for `slimResult`. */
export const fields =
	(f: readonly string[]) =>
	(row: unknown): Record<string, unknown> =>
		pick(row, f);
