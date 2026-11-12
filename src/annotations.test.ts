import { describe, expect, it } from "vitest";
import { buildServer } from "./server";
import { toolOperations } from "./test-support/contract";

/**
 * Hosts gate tools by their hints: a read without `readOnlyHint` is treated as
 * a destructive write (spec defaults), and the Anthropic connector directory
 * requires a title plus explicit readOnly, destructive and open-world hints.
 * Those fields are set at registration (`read` / `write` in tool-meta.ts).
 */
const server = buildServer({
	apiUrl: "http://127.0.0.1:9",
	apiKey: "ft_test",
	adminSession: "test",
	customerSession: "test",
});
const tools = Object.entries(
	(
		server as unknown as {
			_registeredTools: Record<
				string,
				{ annotations?: Record<string, unknown> }
			>;
		}
	)._registeredTools,
).map(([name, t]) => ({ name, a: t.annotations ?? {} }));

/**
 * `readOnlyHint` is derived from the HTTP methods each tool calls in the spec
 * (src/test-support/contract.ts maps tool → operations by scanning the
 * registrations): only GETs → read-only; any POST/PATCH/PUT/DELETE → a write.
 * It used to be inferred from the tool name by regex, which only judged the
 * names it recognized: a read named `*_lookup` or `*_preview` was never
 * checked, and a write whose name looked like a read would pass as one.
 *
 * Reads that go over POST, each with the reason the contract uses a POST.
 */
const POST_READS: Record<string, string> = {
	merch_orders_lookup:
		"POST /merch/orders/lookup: the order code goes in the body so it never " +
		"lands in URLs or access logs; it only reads one order",
	admin_crm_audience_preview:
		"POST /api/admin/crm/audience-preview: the audience filter is a JSON " +
		"body; it counts recipients and sends nothing",
};

/**
 * GETs that write server-side, so they are not announced as reads. Each with
 * what the GET writes.
 */
const GET_WRITES: Record<string, string> = {
	content_channels_list:
		"GET /content/channels creates the default Announcements and General " +
		"channels on a workspace that has none (listChannelsCore)",
};

/**
 * Tools that bypass the generated SDK, with the method they send. Both are
 * 302s to a signed URL, which the generated client would follow.
 */
const DIRECT: Record<string, string> = {
	settlements_document: "GET",
	settlements_proof: "GET",
};

const toolOps = toolOperations();

/** Destructive = the host asks the human before running it. Exact set. */
const DESTRUCTIVE = [
	"admin_impersonate",
	"admin_workspaces_assign_plan",
	"admin_workspaces_delete",
	"admin_workspaces_suspend",
	"content_channels_archive",
	"content_comments_delete",
	"content_lives_delete",
	"content_lives_reset_key",
	"content_meetups_cancel",
	"content_member_posts_reject",
	"content_member_posts_remove",
	"content_members_ban",
	"content_posts_delete",
	"content_series_delete",
	"content_videos_delete",
	"customer_addresses_delete",
	"customer_order_release",
	"customer_subscription_cancel",
	"customer_ticket_cancel",
	"discounts_delete",
	"event_artist_invitations_cancel",
	"event_dates_access_close_sign",
	"event_dates_delete",
	"event_dates_update",
	"events_artists_delete",
	"events_artists_set",
	"events_cancel",
	"events_delete",
	"events_unschedule",
	"events_viewers_delete",
	"master_qrs_delete",
	"merch_products_set_images",
	"plans_delete",
	"presale_windows_delete",
	"products_delete",
	"products_update",
	"sales_abandon",
	"sales_cancel",
	"sales_recipient_update",
	"sales_refund",
	"sales_transfer",
	"staff_access_set",
	"staff_delete",
	"staff_update_role",
	"subscriptions_cancel",
	"ticket_templates_delete",
	"ticket_templates_update",
	"ticket_types_delete",
	"tickets_checkin_undo",
	"tickets_reassign",
	"venues_delete",
	"webhooks_delete",
	"webhooks_update",
	"website_put",
];

describe("tool annotations", () => {
	it("registers the whole surface", () => {
		expect(tools.length).toBeGreaterThan(100);
	});

	it.each(tools)("$name has a title and the directory booleans", ({ a }) => {
		expect(typeof a.title).toBe("string");
		expect((a.title as string).length).toBeGreaterThan(0);
		expect(typeof a.readOnlyHint).toBe("boolean");
		expect(typeof a.destructiveHint).toBe("boolean");
		expect(typeof a.openWorldHint).toBe("boolean");
	});

	it("marks only outbound writes as open world", () => {
		const open = tools
			.filter((t) => t.a.openWorldHint === true)
			.map((t) => t.name)
			.sort();
		// Leaving FreeTicket counts a payment gateway (Mercado Pago, Stripe),
		// an email, Mux, seats.io, an outbound webhook and publishing to the
		// public web — see `write()` in tool-meta.ts.
		expect(open).toEqual([
			"admin_workspaces_assign_plan",
			"content_lives_create",
			"content_lives_delete",
			"content_lives_reset_key",
			"content_meetups_cancel",
			"content_meetups_publish",
			"content_meetups_rsvp_review",
			"content_videos_delete",
			"content_videos_set_published",
			"customer_subscription_cancel",
			"event_artist_invitations_resend",
			"event_dates_access_close_sign",
			"event_dates_update",
			"events_artists_set",
			"events_publish",
			"events_schedule",
			"events_update",
			"events_validators_add",
			"events_viewers_add",
			"merch_products_set_status",
			"products_create",
			"products_set_status",
			"products_update",
			"public_orders_create",
			"public_tickets_resend",
			"sales_create",
			"sales_recipient_update",
			"sales_refund",
			"sales_transfer",
			"staff_create",
			"staff_resend_invite",
			"subscriptions_cancel",
			"tickets_resend",
			"webhooks_create",
			"webhooks_update",
			"website_set_published",
		]);
	});

	it("maps every tool to the spec operations it calls", () => {
		const unmapped = tools
			.map((t) => t.name)
			.filter((n) => !DIRECT[n] && !toolOps.get(n)?.ops.length);
		expect(unmapped).toEqual([]);
		// A DIRECT entry that now goes through the SDK is a stale exception.
		const stale = Object.keys(DIRECT).filter(
			(n) => !toolOps.has(n) || toolOps.get(n)?.ops.length,
		);
		expect(stale).toEqual([]);
	});

	it("is read-only exactly when every call it makes is a GET", () => {
		const wrong = tools.flatMap((t) => {
			const methods = DIRECT[t.name]
				? [DIRECT[t.name]]
				: (toolOps.get(t.name)?.ops.map((o) => o.method) ?? []);
			const reads =
				(methods.every((m) => m === "GET") && !(t.name in GET_WRITES)) ||
				t.name in POST_READS;
			return t.a.readOnlyHint === reads
				? []
				: [
						`${t.name} (${methods.join(", ")}) readOnlyHint=${t.a.readOnlyHint}`,
					];
		});
		expect(wrong).toEqual([]);
	});

	it("lists only GET writes that really are GETs", () => {
		const stale = Object.keys(GET_WRITES).filter(
			(n) => !toolOps.get(n)?.ops.every((o) => o.method === "GET"),
		);
		expect(stale).toEqual([]);
	});

	it("allowlists only POST reads that really are POSTs", () => {
		const stale = Object.keys(POST_READS).filter(
			(n) => !toolOps.get(n)?.ops.some((o) => o.method !== "GET"),
		);
		expect(stale).toEqual([]);
	});

	it("marks exactly the expected tools destructive (and never as reads)", () => {
		const destructive = tools
			.filter((t) => t.a.destructiveHint === true)
			.map((t) => t.name)
			.sort();
		expect(destructive).toEqual(DESTRUCTIVE);
		const asRead = tools.filter(
			(t) => t.a.destructiveHint === true && t.a.readOnlyHint !== false,
		);
		expect(asRead.map((t) => t.name)).toEqual([]);
	});

	it("does not announce the ticket resend (it sends email) as a read", () => {
		const resend = tools.find((t) => t.name === "public_tickets_resend");
		expect(resend?.a.readOnlyHint).toBe(false);
	});
});
