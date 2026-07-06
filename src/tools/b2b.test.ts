import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerAdminTools } from "./admin";
import { registerB2bTools } from "./b2b";

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
		registerB2bTools(server);
		const t = names(server);
		expect(t.length).toBeGreaterThanOrEqual(24);
		expect(new Set(t).size).toBe(t.length);
		for (const n of ["whoami", "events_list", "sales_list", "reconciliation"]) {
			expect(t).toContain(n);
		}
		// Ola A = solo reads: ningún tool de escritura todavía.
		expect(t.join(",")).not.toMatch(
			/create|update|delete|cancel|refund|checkin/,
		);
	});

	it("admin tools live under the admin_ prefix", () => {
		const server = new McpServer({ name: "t", version: "0.0.0" });
		registerAdminTools(server);
		for (const n of names(server)) expect(n).toMatch(/^admin_/);
	});
});
