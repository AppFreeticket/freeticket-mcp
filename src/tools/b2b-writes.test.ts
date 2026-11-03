import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { makeB2bClient } from "../api";
import { registerB2bWriteTools } from "./b2b-writes";

const stub = makeB2bClient({ apiUrl: "http://localhost", apiKey: "test" });

interface Registered {
	description?: string;
	annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
}

function registered(): Record<string, Registered> {
	const server = new McpServer({ name: "t", version: "0.0.0" });
	registerB2bWriteTools(server, stub);
	// ponytail: _registeredTools is SDK-internal; if it changes, this test says so.
	return (server as unknown as { _registeredTools: Record<string, Registered> })
		._registeredTools;
}

/**
 * Writes that delete, cancel or refund are the surface where an agent mistake
 * does not undo itself. The host confirmation gate hangs off `destructiveHint`,
 * and the reminder in the description is the only part the model sees. Nothing
 * used to verify either one: a refactor could leave a delete with no annotation
 * and no test would notice (issue #15).
 */
const DESTRUCTIVE = [
	"events_delete",
	"event_dates_delete",
	"ticket_types_delete",
	"plans_delete",
	"discounts_delete",
	"venues_delete",
	"webhooks_delete",
	"sales_cancel",
	"sales_refund",
	"subscriptions_cancel",
	"events_cancel",
	"staff_delete",
	"customer_order_release",
	"presale_windows_delete",
	"event_dates_access_close_sign",
	"sales_abandon",
	"content_posts_delete",
	"content_comments_delete",
	"content_channels_archive",
	"content_member_posts_reject",
	"content_member_posts_remove",
	"content_members_ban",
	"content_meetups_cancel",
	"products_delete",
	"content_videos_delete",
	"content_series_delete",
	"content_lives_delete",
	"content_lives_reset_key",
	"ticket_templates_delete",
	"master_qrs_delete",
	// Contract 1.33–1.36: voids QRs, reopens a used ticket, revokes access.
	"sales_transfer",
	"sales_recipient_update",
	"tickets_checkin_undo",
	"events_viewers_delete",
	"staff_access_set",
	// Full replace: every null wipes a field, here and on the profile.
	"website_put",
];

describe("writes destructivos", () => {
	const tools = registered();

	it("destructive tools exist and are annotated as such", () => {
		for (const name of DESTRUCTIVE) {
			expect(tools[name], `missing tool ${name}`).toBeDefined();
			expect(
				tools[name].annotations?.destructiveHint,
				`${name} has no destructiveHint: the host will not ask for confirmation`,
			).toBe(true);
		}
	});

	it("destructive tools also warn in the description", () => {
		for (const name of DESTRUCTIVE) {
			expect(
				tools[name].description,
				`${name} is missing the irreversible warning in its description`,
			).toContain("Irreversible");
		}
	});

	it("no write is left without annotations", () => {
		for (const [name, tool] of Object.entries(tools)) {
			expect(
				tool.annotations?.destructiveHint,
				`${name} has no annotations`,
			).toBeDefined();
		}
	});
});
