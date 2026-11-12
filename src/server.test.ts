import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildServer, INSTRUCTIONS } from "./server";

async function connect(
	creds: Parameters<typeof buildServer>[0],
	opts?: Parameters<typeof buildServer>[1],
) {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await buildServer(creds, opts).connect(serverSide);
	const client = new Client({ name: "test", version: "0.0.0" });
	await client.connect(clientSide);
	return client;
}

describe("server instructions", () => {
	const api = "https://api.test";
	const layers: [
		string,
		Parameters<typeof buildServer>[0],
		{ listProtected?: boolean }?,
	][] = [
		["public", { apiUrl: api }],
		["lazy auth (listProtected)", { apiUrl: api }, { listProtected: true }],
		["b2b", { apiUrl: api, apiKey: "ft_test" }],
		["b2b read-only", { apiUrl: api, apiKey: "ft_test", readOnly: true }],
		["customer", { apiUrl: api, customerSession: "sess_buyer" }],
		[
			"b2b + customer",
			{ apiUrl: api, apiKey: "ft_test", customerSession: "sess_buyer" },
		],
	];

	it.each(layers)("are sent in initialize: %s", async (_, creds, opts) => {
		const client = await connect(creds, opts);
		expect(client.getInstructions()).toBe(INSTRUCTIONS);
		await client.close();
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

	// Every layer that lists the B2B tools (read-only included: the
	// instructions only name reads) must have each tool they name.
	it.each(
		layers.filter(([, c, o]) => c.apiKey || o?.listProtected),
	)("only name tools that exist: %s", async (_, creds, opts) => {
		const client = await connect(creds, opts);
		const { tools } = await client.listTools();
		await client.close();
		const names = new Set(tools.map((t) => t.name));
		const mentioned = INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
		expect(mentioned.length).toBeGreaterThan(0);
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
