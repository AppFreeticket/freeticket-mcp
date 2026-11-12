import { createClient, createConfig } from "@hey-api/client-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerB2bTools } from "./b2b";
import { registerB2bWriteTools } from "./b2b-writes";

/**
 * Invokes the registered callback of the tools whose request is easy to get
 * wrong (two path ids, a full-replace body, a header-borne buyer session) and
 * checks the HTTP request that reaches the network. The annotation and
 * coverage tests only prove the tool exists; a swapped `id`/`itemId` or a
 * session leaked into the body would pass both and hit the wrong ticket.
 *
 * Boundary: real tool code and real generated SDK; `fetch` is a fake that
 * records the Request and answers 200 `{}`.
 */
type Captured = {
	method: string;
	url: string;
	headers: Headers;
	body: unknown;
};

function setup() {
	const calls: Captured[] = [];
	const fetch = async (input: Request | string | URL, init?: RequestInit) => {
		const req = new Request(input, init);
		const text = await req.text();
		calls.push({
			method: req.method,
			url: req.url,
			headers: req.headers,
			body: text ? JSON.parse(text) : undefined,
		});
		return new Response("{}", {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};
	const client = createClient(
		createConfig({
			baseUrl: "https://api.test/api/v1",
			headers: { Authorization: "Bearer ft_test" },
			fetch,
		}),
	);
	const server = new McpServer({ name: "t", version: "0.0.0" });
	registerB2bTools(server, client, {
		apiUrl: "https://api.test",
		apiKey: "ft_test",
	});
	registerB2bWriteTools(server, client);
	const tools = (
		server as unknown as {
			_registeredTools: Record<
				string,
				{ handler: (args: unknown, extra: unknown) => Promise<unknown> }
			>;
		}
	)._registeredTools;
	return { calls, tools };
}

describe.each([
	{
		tool: "sales_transfer",
		args: { saleId: "sale_1", itemId: "item_2", email: "nueva@correo.co" },
		method: "POST",
		url: "https://api.test/api/v1/sales/sale_1/items/item_2/transfer",
		body: { email: "nueva@correo.co" },
	},
	{
		tool: "sales_recipient_update",
		args: { saleId: "sale_1", name: "José Peña", email: "jose@correo.co" },
		method: "PATCH",
		url: "https://api.test/api/v1/sales/sale_1/recipient",
		body: { name: "José Peña", email: "jose@correo.co" },
	},
	{
		tool: "tickets_checkin_undo",
		args: { code: "FT-ABC123" },
		method: "DELETE",
		url: "https://api.test/api/v1/tickets/FT-ABC123/checkin",
		body: undefined,
	},
	{
		tool: "staff_access_set",
		args: {
			id: "user_9",
			accessType: "validador",
			validatorEventIds: ["ev_1"],
			expiresAt: null,
		},
		method: "PUT",
		url: "https://api.test/api/v1/staff/user_9/access",
		// `id` is the path, never part of the full-replace body.
		body: {
			accessType: "validador",
			validatorEventIds: ["ev_1"],
			expiresAt: null,
		},
	},
	{
		tool: "merch_orders_lookup",
		args: { code: "M-7K3Q9ZTA", customerSession: "sess_buyer" },
		method: "POST",
		url: "https://api.test/api/v1/merch/orders/lookup",
		// The buyer session travels in a header, never in the body.
		body: { code: "M-7K3Q9ZTA" },
		headers: { "X-Customer-Session": "sess_buyer" },
	},
	// Moderating a post never bans its author: even a stray `banAuthor: true`
	// from the model goes out as false. Banning is `content_members_ban`.
	{
		tool: "content_member_posts_reject",
		args: { id: "post_1", reason: "Spam", banAuthor: true },
		method: "POST",
		url: "https://api.test/api/v1/content/moderation/member-posts/post_1/reject",
		body: { reason: "Spam", banAuthor: false },
	},
	{
		tool: "content_member_posts_remove",
		args: { id: "post_2", banAuthor: true },
		method: "POST",
		url: "https://api.test/api/v1/content/moderation/member-posts/post_2/remove",
		body: { banAuthor: false },
	},
])("$tool request", ({ tool, args, method, url, body, headers }) => {
	it(`sends ${method} to the resolved path with the expected body`, async () => {
		const { calls, tools } = setup();
		expect(tools[tool], `missing tool ${tool}`).toBeDefined();
		const result = (await tools[tool].handler(args, {})) as {
			isError?: boolean;
		};
		expect(result.isError).toBeUndefined();
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call.method).toBe(method);
		expect(call.url).toBe(url);
		expect(call.body).toEqual(body);
		expect(call.headers.get("Authorization")).toBe("Bearer ft_test");
		for (const [k, v] of Object.entries(headers ?? {}))
			expect(call.headers.get(k)).toBe(v);
		if (!headers) expect(call.headers.get("X-Customer-Session")).toBeNull();
	});
});
