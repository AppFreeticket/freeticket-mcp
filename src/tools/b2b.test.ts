import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { makeB2bClient } from "../api";
import { buildServer } from "../server";
import { registerAdminTools } from "./admin";
import { registerB2bTools } from "./b2b";
import { registerB2bWriteTools } from "./b2b-writes";
import { registerPublicTools } from "./public";

// Client aislado de juguete: el registro no hace red, solo necesita el objeto.
const stubCreds = { apiUrl: "http://localhost", apiKey: "test" };
const stub = makeB2bClient(stubCreds);

// El registro no debe tirar y no debe haber nombres duplicados entre capas.
function names(server: McpServer): string[] {
	// ponytail: _registeredTools es interno del SDK; si cambia, este test avisa.
	return Object.keys(
		(server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools,
	);
}

describe("tool registration", () => {
	it("registers B2B read tools without collisions", () => {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerB2bTools(server, stub, stubCreds);
		const t = names(server);
		expect(t.length).toBeGreaterThanOrEqual(24);
		expect(new Set(t).size).toBe(t.length);
		for (const n of [
			"whoami",
			"events_list",
			"sales_list",
			"reconciliation",
			"settlements_list",
			"reports_financials",
			"api_keys_list",
		]) {
			expect(t).toContain(n);
		}
	});

	it("registers B2B write tools without collisions", () => {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerB2bWriteTools(server, stub);
		const t = names(server);
		// 35 writes: 29 del contrato 1.5.0 + los 6 del 1.7.0 (área de socios y
		// token de reproducción de contenido).
		expect(t.length).toBe(35);
		expect(new Set(t).size).toBe(t.length);
		for (const n of [
			"events_create",
			"events_publish",
			"sales_create",
			"tickets_checkin",
			"discounts_create",
			"event_dates_create",
			"event_dates_update",
			"ticket_types_update",
			"plans_update",
			"venues_update",
		]) {
			expect(t).toContain(n);
		}
	});

	it("reads and writes share no tool names", () => {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerB2bTools(server, stub, stubCreds);
		registerB2bWriteTools(server, stub);
		const t = names(server);
		expect(new Set(t).size).toBe(t.length);
	});

	it("admin tools live under the admin_ prefix", () => {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerAdminTools(server, stub);
		const t = names(server);
		// 4 reads originales + 15 de la Ola C + admin_tokens (admin 1.1.0)
		// + admin_workspaces_assign_plan (admin 1.3.0).
		expect(t.length).toBe(21);
		expect(new Set(t).size).toBe(t.length);
		for (const n of t) expect(n).toMatch(/^admin_/);
		for (const n of [
			"admin_workspaces_suspend",
			"admin_impersonate",
			"admin_platform_plans_create",
			"admin_feature_flags_set",
		]) {
			expect(t).toContain(n);
		}
	});

	it("registers public B2C tools without collisions", () => {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerPublicTools(server, stub);
		const t = names(server);
		expect(t.length).toBe(6);
		expect(new Set(t).size).toBe(t.length);
		for (const n of t) expect(n).toMatch(/^public_/);
		for (const n of [
			"public_events_list",
			"public_events_availability",
			"public_orders_create",
			"public_orders_get",
			"public_tickets_resend",
		]) {
			expect(t).toContain(n);
		}
	});

	it("buildServer layers tools by credential level", () => {
		// Anónimo (sin apiKey): solo public_*.
		const anon = names(buildServer({ apiUrl: "http://localhost" }));
		expect(anon.every((n) => n.startsWith("public_"))).toBe(true);
		expect(anon).toContain("public_events_list");

		// Con apiKey: public + B2B, sin admin.
		const b2b = names(buildServer({ apiUrl: "http://localhost", apiKey: "k" }));
		expect(b2b).toContain("public_events_list");
		expect(b2b).toContain("events_create");
		expect(b2b.some((n) => n.startsWith("admin_"))).toBe(false);

		// Con adminSession: las tres capas.
		const full = names(
			buildServer({
				apiUrl: "http://localhost",
				apiKey: "k",
				adminSession: "s",
			}),
		);
		expect(full.some((n) => n.startsWith("admin_"))).toBe(true);
		expect(full.some((n) => n.startsWith("public_"))).toBe(true);
	});
});
