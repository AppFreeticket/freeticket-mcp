import { describe, expect, it } from "vitest";
import { buildServer } from "./server";

/**
 * Hosts gate tools by their hints: a read without `readOnlyHint` is treated as
 * a destructive write (spec defaults), and the Anthropic connector directory
 * requires a title plus readOnly/destructive hints on every tool.
 */
const server = buildServer({
	apiUrl: "http://127.0.0.1:9",
	apiKey: "ft_test",
	adminSession: "test",
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

const READ =
	/_(list|get|me|attempts|tickets|subscribers|access|summary|by_event|timeseries|inventory|financials|document|proof|membership|profile|pending|videos|posts|lives|workspaces|users|tokens|audit_log)$|^(whoami|admin_whoami|reconciliation|customer_me|reports_export_.*)$/;
const DESTRUCTIVE = /_(delete|cancel|refund)$/;

describe("tool annotations", () => {
	it("registers the whole surface", () => {
		expect(tools.length).toBeGreaterThan(100);
	});

	it.each(tools)("$name has a title and explicit read/destructive hints", ({
		a,
	}) => {
		expect(typeof a.title).toBe("string");
		expect(typeof a.readOnlyHint).toBe("boolean");
		expect(typeof a.destructiveHint).toBe("boolean");
	});

	it("marks reads read-only and deletes/cancels/refunds destructive", () => {
		const wrongRead = tools.filter(
			(t) => READ.test(t.name) && t.a.readOnlyHint !== true,
		);
		const wrongDestructive = tools.filter(
			(t) =>
				DESTRUCTIVE.test(t.name) &&
				(t.a.destructiveHint !== true || t.a.readOnlyHint !== false),
		);
		expect(wrongRead.map((t) => t.name)).toEqual([]);
		expect(wrongDestructive.map((t) => t.name)).toEqual([]);
	});

	it("does not announce the ticket resend (it sends email) as a read", () => {
		const resend = tools.find((t) => t.name === "public_tickets_resend");
		expect(resend?.a.readOnlyHint).toBe(false);
	});
});
