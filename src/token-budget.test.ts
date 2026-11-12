import { createClient, createConfig } from "@hey-api/client-fetch";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	capJson,
	errorResult,
	httpErrorResult,
	MAX_TEXT_CHARS,
	run,
	type ToolResult,
} from "./api";
import { registerB2bTools } from "./tools/b2b";
import { registerUi } from "./ui";

/**
 * Token budget (Block MCP playbook): compact JSON, a hard cap with a note,
 * trimmed views on the heavy lists, actionable errors, numeric `limit`.
 */

/** A realistic GET /sales page at the contract's maximum (limit=100). */
function salesFixture(n = 100) {
	const statuses = [
		"CONFIRMED",
		"CONFIRMED",
		"CONFIRMED",
		"PENDING",
		"ABANDONED",
	];
	return {
		data: Array.from({ length: n }, (_, i) => {
			const status = statuses[i % statuses.length];
			const confirmed = status === "CONFIRMED";
			return {
				id: `cmh${String(i).padStart(4, "0")}x9k2a7q0001sale`,
				reference: `FT-2026-${String(48213 + i)}`,
				status,
				channel: "WEB",
				subtotal: 180000,
				discountAmount: 0,
				serviceFee: 18000,
				iva: 3420,
				total: 201420,
				currency: "COP",
				buyerName: `Comprador Número ${i}`,
				buyerEmail: `comprador.${i}@correo.example.co`,
				buyerPhone: "+573001234567",
				buyerDocumentType: "CC",
				buyerDocumentNumber: String(1020304050 + i),
				organizationId: "cmorg0001workspace",
				paymentProvider: "mercadopago",
				paymentRef: confirmed ? `MP-${88000000000 + i}` : null,
				confirmedAt: confirmed ? "2026-11-10T21:04:11.000Z" : null,
				createdAt: "2026-11-10T21:02:57.000Z",
				failureReason: status === "ABANDONED" ? "timeout" : null,
				paymentStatus: confirmed ? "approved" : null,
				declineCode: null,
			};
		}),
		page: { nextCursor: "cmh0100x9k2a7q0001sale", hasMore: true },
	};
}

function fakeApi(handler: (req: Request) => Response) {
	const calls: Request[] = [];
	const fetch = async (input: Request | string | URL, init?: RequestInit) => {
		const req = new Request(input, init);
		calls.push(req);
		return handler(req);
	};
	return {
		calls,
		client: createClient(
			createConfig({ baseUrl: "https://api.test/api/v1", fetch }),
		),
	};
}

const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});

/** A real MCP client over an in-memory transport: zod validation included. */
async function connect(handler: (req: Request) => Response) {
	const api = fakeApi(handler);
	const server = new McpServer({ name: "t", version: "0.0.0" });
	registerUi(server);
	// Pinned workspace: the tools take the single-workspace path (no /me).
	registerB2bTools(server, api.client, {
		apiUrl: "https://api.test",
		apiKey: "ft_test",
		workspaceId: "ws_1",
	});
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "c", version: "0.0.0" });
	await Promise.all([server.connect(a), client.connect(b)]);
	const call = async (name: string, args: Record<string, unknown> = {}) =>
		(await client.callTool({ name, arguments: args })) as ToolResult;
	return { ...api, client, call };
}

describe("size: sales_list before/after", () => {
	it("compact + trimmed view cuts the 100-row page by more than half", async () => {
		const fixture = salesFixture();
		// Before (0.20.0): indented JSON in the text AND the same rows again in
		// structuredContent.
		const beforeText = JSON.stringify(fixture, null, 2).length;
		const beforeStructured = JSON.stringify({ data: fixture.data }).length;
		const before = beforeText + beforeStructured;

		const { call } = await connect(() => json(fixture));
		const res = await call("sales_list", { limit: 100 });
		const afterText = res.content[0].text.length;
		const after = afterText + JSON.stringify(res.structuredContent).length;
		const verbose = await call("sales_list", { limit: 100, verbose: true });

		console.info(
			`[token-budget] sales_list x100 — antes: texto ${beforeText} + structured ${beforeStructured} = ${before} chars · ` +
				`después: texto ${afterText} (modelo), con structured para la vista ${after} · verbose ${verbose.content[0].text.length}`,
		);
		expect(afterText).toBeLessThanOrEqual(MAX_TEXT_CHARS);
		expect(afterText).toBeLessThan(beforeText / 2);
		// The trimmed row still carries what the agent chains on.
		const row = (
			JSON.parse(res.content[0].text) as { data: Record<string, unknown>[] }
		).data[0];
		expect(Object.keys(row)).toEqual(
			expect.arrayContaining([
				"id",
				"reference",
				"status",
				"total",
				"buyerEmail",
			]),
		);
		expect(row).not.toHaveProperty("buyerDocumentNumber");
		expect(row).not.toHaveProperty("declineCode"); // null → dropped
	});
});

describe("capJson: truncation", () => {
	it("cuts whole items, stays valid JSON and says how to page", () => {
		const payload = salesFixture(300);
		const { text, truncated } = capJson(payload);
		expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
		const parsed = JSON.parse(text) as {
			data: unknown[];
			page: unknown;
			truncated: { shown: number; total: number; hint: string };
		};
		expect(truncated).toBeDefined();
		expect(parsed.truncated.total).toBe(300);
		expect(parsed.data).toHaveLength(parsed.truncated.shown);
		expect(parsed.truncated.shown).toBeGreaterThan(0);
		expect(parsed.truncated.hint).toContain(`limit: ${parsed.truncated.shown}`);
		expect(parsed.truncated.hint).toContain("cursor");
		// The envelope survives: page is still there to read nextCursor from.
		expect(parsed.page).toBeDefined();
	});

	it("without a page it points at the filters instead of a cursor", () => {
		const { text } = capJson({ data: salesFixture(300).data });
		const parsed = JSON.parse(text) as { truncated: { hint: string } };
		expect(parsed.truncated.hint).toContain("no pagina");
		expect(parsed.truncated.hint).toContain("filtros");
	});

	it("a bare array is wrapped so the note fits", () => {
		const { text } = capJson(salesFixture(300).data);
		const parsed = JSON.parse(text) as { data: unknown[]; truncated: unknown };
		expect(Array.isArray(parsed.data)).toBe(true);
		expect(parsed.truncated).toBeDefined();
	});

	it("a single oversized object degrades to a valid preview", () => {
		const { text } = capJson({ blob: "x".repeat(MAX_TEXT_CHARS * 2) });
		expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
		const parsed = JSON.parse(text) as { preview: string; truncated: unknown };
		expect(parsed.preview.length).toBeGreaterThan(0);
		expect(parsed.truncated).toBeDefined();
	});

	it("under the cap it is plain compact JSON, no note", () => {
		const { text, truncated } = capJson({ data: [{ a: 1 }] });
		expect(text).toBe('{"data":[{"a":1}]}');
		expect(truncated).toBeUndefined();
	});
});

describe("structuredContent only where a view reads it", () => {
	it("a view tool (sales_list) carries it, a plain one (sales_get) does not", async () => {
		const { call } = await connect((req) =>
			req.url.includes("/sales?") || req.url.endsWith("/sales")
				? json(salesFixture(3))
				: json({ data: salesFixture(1).data[0] }),
		);
		const list = await call("sales_list");
		expect(list.structuredContent?.data).toHaveLength(3);
		const one = await call("sales_get", { id: "x" });
		expect(one.structuredContent).toBeUndefined();
		expect(one.content[0].text).not.toContain("\n");
	});
});

describe("limit: number, still accepting strings", () => {
	it.each([[20], ["20"]])("limit %j reaches the API as 20", async (limit) => {
		const { call, calls } = await connect(() => json(salesFixture(1)));
		const res = await call("sales_list", { limit });
		expect(res.isError).toBeFalsy();
		expect(new URL(calls[0].url).searchParams.get("limit")).toBe("20");
	});

	it.each([
		[0],
		[101],
		["abc"],
	])("limit %j is rejected before the API", async (limit) => {
		const { call, calls } = await connect(() => json(salesFixture(1)));
		const res = await call("sales_list", { limit });
		expect(res.isError).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

describe("actionable errors", () => {
	const envelope = (code: string, extra: Record<string, unknown> = {}) => ({
		error: { code, message: `msg ${code}`, retryable: false, ...extra },
	});
	const parse = (r: ToolResult) =>
		JSON.parse(r.content[0].text) as {
			error: {
				code: string;
				status?: number;
				hint: string;
				retryable: boolean;
				retryAfterSeconds?: number;
			};
		};

	it.each([
		[401, "UNAUTHORIZED", /ft login/],
		[403, "FORBIDDEN", /whoami/],
		[404, "NOT_FOUND", /_list/],
		[409, "CONFLICT", /Relee/],
	])("%i keeps the code and adds a recovery hint", async (status, code, hint) => {
		const res = await run(
			Promise.resolve({
				error: envelope(code),
				response: new Response(null, { status }),
			}),
		);
		expect(res.isError).toBe(true);
		const { error } = parse(res);
		expect(error.code).toBe(code);
		expect(error.status).toBe(status);
		expect(error.hint).toMatch(hint);
		expect(error.retryable).toBe(false);
	});

	it("403 names the active workspace when the API sends it", () => {
		const { error } = parse(
			errorResult(
				403,
				envelope("FORBIDDEN", {
					details: { activeWorkspaceId: "ws_9", activeWorkspaceName: "Teatro" },
				}),
			),
		);
		expect(error.hint).toContain("Teatro (ws_9)");
	});

	it("422 echoes the field errors", () => {
		const { error } = parse(
			errorResult(
				422,
				envelope("UNPROCESSABLE_ENTITY", {
					details: [
						{ path: ["price"], message: "must be > 0" },
						{ path: ["dates", 0, "startsAt"], message: "invalid date" },
					],
				}),
			),
		);
		expect(error.hint).toContain("price: must be > 0");
		expect(error.hint).toContain("dates.0.startsAt: invalid date");
	});

	it("429 reads Retry-After and says how long to wait", async () => {
		const { call } = await connect(() =>
			json(envelope("RATE_LIMITED", { retryable: true }), 429, {
				"Retry-After": "12",
			}),
		);
		const { error } = parse(await call("sales_get", { id: "x" }));
		expect(error.retryAfterSeconds).toBe(12);
		expect(error.retryable).toBe(true);
		expect(error.hint).toContain("12 s");
	});

	it("5xx is retryable even without an envelope", async () => {
		const { call } = await connect(
			() => new Response("upstream timeout", { status: 503 }),
		);
		const { error } = parse(await call("sales_get", { id: "x" }));
		expect(error.status).toBe(503);
		expect(error.retryable).toBe(true);
		expect(error.hint).toMatch(/Reintenta/);
	});

	it("a network failure is retryable with code network_error", async () => {
		const { error } = parse(
			await run(Promise.reject(new Error("fetch failed"))),
		);
		expect(error.code).toBe("network_error");
		expect(error.retryable).toBe(true);
	});

	it("httpErrorResult maps a raw text body", async () => {
		const { error } = parse(
			await httpErrorResult(
				new Response("<html>Not found</html>", { status: 404 }),
			),
		);
		expect(error.code).toBe("HTTP_404");
		expect(error.hint).toMatch(/_list/);
	});
});

describe("signedDownload (settlements_document)", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("a 404 without Location gets the same mapping, not raw HTTP text", async () => {
		vi.stubGlobal("fetch", async () => json(envelope404(), 404));
		const { call } = await connect(() => json({}));
		const res = await call("settlements_document", { id: "st_1" });
		expect(res.isError).toBe(true);
		const parsed = JSON.parse(res.content[0].text) as {
			error: { code: string; hint: string };
		};
		expect(parsed.error.code).toBe("NOT_FOUND");
		expect(parsed.error.hint).toMatch(/_list/);
	});

	it("the 302 returns the link as compact JSON", async () => {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(null, {
					status: 302,
					headers: { Location: "https://s.test/f.pdf" },
				}),
		);
		const { call } = await connect(() => json({}));
		const res = await call("settlements_document", { id: "st_1" });
		expect(res.content[0].text).toBe(
			'{"url":"https://s.test/f.pdf","expiresInMinutes":5}',
		);
	});
});

function envelope404() {
	return {
		error: {
			code: "NOT_FOUND",
			message: "Settlement not found",
			retryable: false,
		},
	};
}
