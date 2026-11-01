import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { makeB2bClient } from "../api";
import { registerB2bTools } from "./b2b";
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
	"events_artists_remove",
	"events_artist_invitations_cancel",
	"presale_windows_delete",
	"sales_transfer",
	"tickets_checkin_undo",
	"sales_recipient_update",
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

describe("lineup tools (contract 1.25.0)", () => {
	function all(): Record<
		string,
		Registered & { annotations?: { readOnlyHint?: boolean } }
	> {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerB2bTools(server, stub, {
			apiUrl: "http://localhost",
			apiKey: "test",
		});
		registerB2bWriteTools(server, stub);
		return (
			server as unknown as { _registeredTools: Record<string, Registered> }
		)._registeredTools;
	}

	// The annotation table agreed in free-admin#1155: the host's confirmation
	// gate and its retry policy both hang off these hints.
	it.each([
		["artists_search", { readOnlyHint: true }],
		["events_artist_invitations_list", { readOnlyHint: true }],
		["events_artists_set", { destructiveHint: true, idempotentHint: true }],
		["events_artists_remove", { destructiveHint: true, idempotentHint: true }],
		[
			"events_artist_invitations_resend",
			{ destructiveHint: false, idempotentHint: false },
		],
		[
			"events_artist_invitations_cancel",
			{ destructiveHint: true, idempotentHint: true },
		],
	])("%s carries %j", (name, hints) => {
		expect(all()[name]?.annotations).toMatchObject(hints);
	});

	it("events_artists_set warns that it replaces the whole lineup", () => {
		expect(all().events_artists_set.description).toMatch(/FULL list/);
	});
});

describe("dashboard-parity tools (contract 1.25.0)", () => {
	const tools = {
		...(() => {
			const server = new McpServer({ name: "t", version: "0.0.0" });
			registerB2bTools(server, stub, {
				apiUrl: "http://localhost",
				apiKey: "test",
			});
			return (
				server as unknown as { _registeredTools: Record<string, Registered> }
			)._registeredTools;
		})(),
		...registered(),
	} as Record<
		string,
		Registered & { annotations?: { readOnlyHint?: boolean } }
	>;

	// Annotation table from free-admin#1156/#1157: the host's confirmation gate
	// and its retry policy both hang off these hints.
	it.each([
		["events_schedule", { destructiveHint: false }],
		["events_unschedule", { destructiveHint: false }],
		["presale_windows_list", { readOnlyHint: true }],
		["presale_windows_create", { destructiveHint: false }],
		["presale_windows_update", { destructiveHint: false }],
		["presale_windows_delete", { destructiveHint: true }],
		["sales_transfer", { destructiveHint: true, idempotentHint: false }],
		["tickets_checkin_undo", { destructiveHint: true, idempotentHint: true }],
		["sales_recipient_update", { destructiveHint: true }],
		["event_dates_courtesy_seats", { readOnlyHint: true }],
	])("%s carries %j", (name, hints) => {
		expect(tools[name]?.annotations).toMatchObject(hints);
	});
});
