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
	// ── Contract 1.37–1.42: merch admin catalog, buyer address book ──────
	{
		tool: "merch_products_list",
		args: {},
		method: "GET",
		url: "https://api.test/api/v1/merch/products",
		body: undefined,
	},
	{
		tool: "merch_products_create",
		args: {
			name: "Camiseta Gira",
			maxPerOrder: 4,
			options: [{ name: "Talla", values: ["S", "M"] }],
			variants: [
				{ attributes: { Talla: "S" }, sku: "CAM-S", price: 80000, stock: 10 },
				{ attributes: { Talla: "M" }, sku: "CAM-M", price: 80000, stock: 0 },
			],
		},
		method: "POST",
		url: "https://api.test/api/v1/merch/products",
		body: {
			name: "Camiseta Gira",
			maxPerOrder: 4,
			options: [{ name: "Talla", values: ["S", "M"] }],
			variants: [
				{ attributes: { Talla: "S" }, sku: "CAM-S", price: 80000, stock: 10 },
				{ attributes: { Talla: "M" }, sku: "CAM-M", price: 80000, stock: 0 },
			],
		},
	},
	{
		tool: "merch_products_set_status",
		args: { id: "prod_1", status: "PUBLISHED" },
		method: "PATCH",
		url: "https://api.test/api/v1/merch/products/prod_1/status",
		// `id` is the path, never part of the body.
		body: { status: "PUBLISHED" },
	},
	{
		tool: "merch_products_set_images",
		args: { id: "prod_1", imageUrls: [] },
		method: "PUT",
		url: "https://api.test/api/v1/merch/products/prod_1/images",
		// `[]` is a full replace that clears every photo; it must reach the API.
		body: { imageUrls: [] },
	},
	{
		tool: "customer_merch_orders",
		args: { cursor: "c_2", customerSession: "sess_buyer" },
		method: "GET",
		url: "https://api.test/api/v1/customer/merch-orders?cursor=c_2",
		body: undefined,
		headers: { "X-Customer-Session": "sess_buyer" },
	},
	{
		tool: "customer_addresses_list",
		args: { customerSession: "sess_buyer" },
		method: "GET",
		url: "https://api.test/api/v1/customer/addresses",
		body: undefined,
		headers: { "X-Customer-Session": "sess_buyer" },
	},
	{
		tool: "customer_addresses_create",
		args: {
			recipientName: "María Muñoz",
			departmentCode: "11",
			cityCode: "11001",
			address: "Calle 80 # 12-34",
			isDefault: true,
			customerSession: "sess_buyer",
		},
		method: "POST",
		url: "https://api.test/api/v1/customer/addresses",
		body: {
			recipientName: "María Muñoz",
			departmentCode: "11",
			cityCode: "11001",
			address: "Calle 80 # 12-34",
			isDefault: true,
		},
		headers: { "X-Customer-Session": "sess_buyer" },
	},
	{
		tool: "customer_addresses_update",
		args: { id: "addr_1", cityCode: "05001", customerSession: "sess_buyer" },
		method: "PATCH",
		url: "https://api.test/api/v1/customer/addresses/addr_1",
		body: { cityCode: "05001" },
		headers: { "X-Customer-Session": "sess_buyer" },
	},
	{
		tool: "customer_addresses_delete",
		args: { id: "addr_1", customerSession: "sess_buyer" },
		method: "DELETE",
		url: "https://api.test/api/v1/customer/addresses/addr_1",
		body: undefined,
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

describe("customer_addresses_update partial semantics", () => {
	it("sends null to clear a field and omits the fields left undefined", async () => {
		const { calls, tools } = setup();
		await tools.customer_addresses_update.handler(
			{
				id: "addr_1",
				label: null,
				phone: undefined,
				addressExtra: null,
				customerSession: "sess_buyer",
			},
			{},
		);
		const body = calls[0].body as Record<string, unknown>;
		// `null` clears it on the server; a missing key leaves it untouched.
		expect(body).toStrictEqual({ label: null, addressExtra: null });
		expect("phone" in body).toBe(false);
		expect("recipientName" in body).toBe(false);
	});
});

/**
 * Input limits as the agent sees them: the zod schema the SDK registered,
 * parsed the same way the server parses a `tools/call`.
 */
function schemaOf(tool: string) {
	const { tools } = setup();
	const schema = (
		tools[tool] as unknown as {
			inputSchema: { safeParse: (v: unknown) => { success: boolean } };
		}
	).inputSchema;
	return (v: unknown) => schema.safeParse(v).success;
}

const ticketTypeBase = {
	eventDateId: "date_1",
	name: "General",
	price: 50000,
	capacity: 100,
	maxPerOrder: 10,
	isVisible: true,
	organizerAbsorbsFee: false,
};

describe.each([
	{ tool: "ticket_types_create", base: ticketTypeBase },
	{ tool: "ticket_types_update", base: { id: "tt_1" } },
])("$tool limits (contract TicketType*: price 0..9999999999, name 1..100)", ({
	tool,
	base,
}) => {
	const ok = schemaOf(tool);
	it("accepts a free ticket (price 0) and the max price", () => {
		expect(ok({ ...base, price: 0 })).toBe(true);
		expect(ok({ ...base, price: 9_999_999_999 })).toBe(true);
	});
	it("rejects a price above 9999999999 and a negative price", () => {
		expect(ok({ ...base, price: 10_000_000_000 })).toBe(false);
		expect(ok({ ...base, price: -1 })).toBe(false);
	});
	it("accepts a 100-char name and rejects empty or 101 chars", () => {
		expect(ok({ ...base, name: "Á".repeat(100) })).toBe(true);
		expect(ok({ ...base, name: "" })).toBe(false);
		expect(ok({ ...base, name: "a".repeat(101) })).toBe(false);
	});
});

describe("merch_products_create variant price", () => {
	const ok = schemaOf("merch_products_create");
	const product = (variant: Record<string, unknown>) => ({
		name: "Gorra",
		maxPerOrder: 2,
		variants: [{ sku: "GOR-1", stock: 5, price: 45000, ...variant }],
	});
	it("accepts an integer COP price up to 100,000,000", () => {
		expect(ok(product({ price: 1 }))).toBe(true);
		expect(ok(product({ price: 100_000_000 }))).toBe(true);
	});
	it("rejects negative, zero and above-range prices before the API 400s", () => {
		expect(ok(product({ price: -45000 }))).toBe(false);
		expect(ok(product({ price: 0 }))).toBe(false);
		expect(ok(product({ price: 100_000_001 }))).toBe(false);
	});
	it("rejects a negative strikethrough price", () => {
		expect(ok(product({ compareAtPrice: -1 }))).toBe(false);
		expect(ok(product({ compareAtPrice: null }))).toBe(true);
	});
});
