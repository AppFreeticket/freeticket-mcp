import { createClient, createConfig } from "@hey-api/client-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server";
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
	const creds = {
		apiUrl: "https://api.test",
		apiKey: "ft_test",
		customerSession: "sess_buyer",
	};
	registerB2bTools(server, client, creds);
	registerB2bWriteTools(server, client, creds);
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
		// The buyer session is the connection's credential, not an argument.
		args: { code: "M-7K3Q9ZTA" },
		method: "POST",
		url: "https://api.test/api/v1/merch/orders/lookup",
		// The buyer session travels in a header, never in the body.
		body: { code: "M-7K3Q9ZTA" },
		headers: { "X-Customer-Session": "sess_buyer" },
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

/**
 * The buyer layer (customer_*): the session comes from the connection, never
 * from the model. Boundary: the real buildServer and generated SDK, with a
 * fake global fetch.
 */
describe("customer_* carry the buyer session as a credential", () => {
	afterEach(() => vi.unstubAllGlobals());

	const build = (creds: Record<string, string>) => {
		const calls: Request[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
				calls.push(new Request(input, init));
				return new Response("{}", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}),
		);
		const server = buildServer({ apiUrl: "https://api.test", ...creds });
		const tools = (
			server as unknown as {
				_registeredTools: Record<
					string,
					{
						handler: (args: unknown, extra: unknown) => Promise<unknown>;
						inputSchema?: { shape?: Record<string, unknown> };
					}
				>;
			}
		)._registeredTools;
		return { calls, tools };
	};

	it("no tool takes the session as an argument", () => {
		const { tools } = build({
			apiKey: "ft_test",
			customerSession: "sess_buyer",
		});
		for (const [name, t] of Object.entries(tools))
			expect(
				Object.keys(t.inputSchema?.shape ?? {}),
				`${name} exposes the buyer session to the model`,
			).not.toContain("customerSession");
	});

	it("sends X-Customer-Session from the credential and never the B2B key", async () => {
		const { calls, tools } = build({
			apiKey: "ft_test",
			customerSession: "sess_buyer",
		});
		await tools.customer_tickets.handler({}, {});
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("https://api.test/api/v1/customer/tickets");
		expect(calls[0].headers.get("X-Customer-Session")).toBe("sess_buyer");
		expect(calls[0].headers.get("Authorization")).toBeNull();
	});

	it("registers the layer only with a buyer session", () => {
		expect(build({ apiKey: "ft_test" }).tools.customer_me).toBeUndefined();
		expect(build({ customerSession: "s" }).tools.customer_me).toBeDefined();
		// merch_orders_lookup needs both credentials by contract.
		expect(
			build({ customerSession: "s" }).tools.merch_orders_lookup,
		).toBeUndefined();
	});
});
