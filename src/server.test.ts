import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildServer, INSTRUCTIONS } from "./server";

async function connect(creds: Parameters<typeof buildServer>[0]) {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await buildServer(creds).connect(serverSide);
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(clientSide);
	return client;
}

describe("server instructions", () => {
	it("are sent in initialize, for every credential layer", async () => {
		for (const creds of [
			{ apiUrl: "https://api.test" },
			{ apiUrl: "https://api.test", apiKey: "ft_test" },
		]) {
			const client = await connect(creds);
			expect(client.getInstructions()).toBe(INSTRUCTIONS);
			await client.close();
		}
	});

	it("are static: no dates, times or version numbers", () => {
		expect(INSTRUCTIONS).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/);
		expect(INSTRUCTIONS).not.toMatch(/\d+\.\d+\.\d+/);
		expect(INSTRUCTIONS.length).toBeLessThan(2500);
	});

	it("cover the layers, the call order and the house rules", () => {
		for (const needle of [
			"public_*",
			"customer_*",
			"admin_*",
			"whoami",
			"events_list",
			"un solo workspace",
			"COP",
			"cursor",
			"slug",
		])
			expect(INSTRUCTIONS).toContain(needle);
	});

	it("only name tools that exist", async () => {
		const client = await connect({
			apiUrl: "https://api.test",
			apiKey: "ft_test",
		});
		const { tools } = await client.listTools();
		await client.close();
		const names = new Set(tools.map((t) => t.name));
		const mentioned = INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
		for (const name of mentioned) expect(names, name).toContain(name);
	});
});

describe("member post moderation", () => {
	it("reject and remove do not offer banAuthor and point to content_members_ban", async () => {
		const client = await connect({
			apiUrl: "https://api.test",
			apiKey: "ft_test",
		});
		const { tools } = await client.listTools();
		await client.close();
		for (const name of [
			"content_member_posts_approve",
			"content_member_posts_reject",
			"content_member_posts_remove",
		]) {
			const tool = tools.find((t) => t.name === name);
			expect(tool, name).toBeDefined();
			expect(Object.keys(tool?.inputSchema.properties ?? {})).not.toContain(
				"banAuthor",
			);
		}
		const reject = tools.find((t) => t.name === "content_member_posts_reject");
		expect(reject?.description).toContain("content_members_ban");
		const ban = tools.find((t) => t.name === "content_members_ban");
		expect(ban?.annotations?.destructiveHint).toBe(true);
	});
});
