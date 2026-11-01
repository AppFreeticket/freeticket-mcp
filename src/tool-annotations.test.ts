import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { buildServer } from "./server";

it("advertises explicit directory hints over the MCP transport for every credential layer", async () => {
	const server = buildServer({
		apiUrl: "http://localhost",
		apiKey: "test",
		adminSession: "test",
	});
	const client = new Client({ name: "directory-check", version: "1.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		const { tools } = await client.listTools();
		expect(tools).toHaveLength(117);
		for (const tool of tools) {
			expect(tool.annotations?.title, tool.name).toBeTruthy();
			for (const hint of [
				"readOnlyHint",
				"destructiveHint",
				"idempotentHint",
				"openWorldHint",
			] as const) {
				expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe(
					"boolean",
				);
			}
		}
		const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
		for (const name of [
			"public_events_list",
			"events_get",
			"events_list",
			"admin_tokens",
		]) {
			expect(byName[name].annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
			});
		}
		for (const name of [
			"public_orders_create",
			"public_tickets_resend",
			"events_create",
			"admin_impersonate_stop",
		]) {
			expect(byName[name].annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: false,
			});
		}
		for (const name of [
			"events_delete",
			"staff_delete",
			"sales_refund",
			"admin_impersonate",
		]) {
			expect(byName[name].annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: true,
			});
		}
	} finally {
		await client.close();
		await server.close();
	}
});
