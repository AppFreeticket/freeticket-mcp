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
	sliceCodePoints,
	type ToolResult,
	withStructured,
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

describe("truncation never skips rows (QA #43 P0)", () => {
	/** GET /sales with the API's real keyset cursor: nextCursor = last row id. */
	function pagedSales(all: ReturnType<typeof salesFixture>["data"]) {
		return (req: Request) => {
			const u = new URL(req.url);
			const limit = Number(u.searchParams.get("limit") ?? 20);
			const cursor = u.searchParams.get("cursor");
			const from = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
			const data = all.slice(from, from + limit);
			const hasMore = from + limit < all.length;
			return json({
				data,
				page: {
					hasMore,
					nextCursor: hasMore ? data[data.length - 1].id : null,
				},
			});
		};
	}
	type Page = {
		data: { id: string }[];
		page: { hasMore: boolean; nextCursor: string | null };
		truncated?: { shown: number; total: number; hint: string };
	};

	it("a cut page drops nextCursor; following the hint walks every row in order", async () => {
		const all = salesFixture(250).data;
		const { call } = await connect(pagedSales(all));
		// verbose: full rows, so a 100-row page goes over the cap.
		const first = JSON.parse(
			(await call("sales_list", { limit: 100, verbose: true })).content[0].text,
		) as Page;
		expect(first.truncated).toBeDefined();
		const shown = first.truncated?.shown ?? 0;
		expect(shown).toBeLessThan(100);
		// The API's cursor would land on row 99 and lose 100−shown rows.
		expect(first.page.nextCursor).toBeNull();
		expect(first.page.hasMore).toBe(true);
		expect(first.truncated?.hint).toContain(`limit: ${shown}`);
		expect(first.truncated?.hint).toContain("mismo `cursor`");

		// Follow the hint: same call (no cursor, it was page 1), limit = shown.
		const seen: string[] = [];
		let cursor: string | undefined;
		let page = JSON.parse(
			(await call("sales_list", { limit: shown, verbose: true })).content[0]
				.text,
		) as Page;
		for (let guard = 0; guard < 20; guard++) {
			expect(page.truncated).toBeUndefined();
			seen.push(...page.data.map((r) => r.id));
			if (!page.page.hasMore) break;
			cursor = page.page.nextCursor ?? undefined;
			expect(cursor).toBeDefined();
			page = JSON.parse(
				(await call("sales_list", { limit: shown, cursor, verbose: true }))
					.content[0].text,
			) as Page;
		}
		// Contiguous and complete: every row once, in order, none skipped.
		expect(seen).toEqual(all.map((r) => r.id));
		// The rows shown on the cut page are exactly the head of that walk.
		expect(first.data.map((r) => r.id)).toEqual(seen.slice(0, shown));
	});

	it("the API's last page cut still says there is more", () => {
		const p = salesFixture(300);
		p.page = { nextCursor: null, hasMore: false } as never;
		const parsed = JSON.parse(capJson(p).text) as Page;
		expect(parsed.page).toEqual({ nextCursor: null, hasMore: true });
	});
});

describe("capJson: shapes (QA #43 P1)", () => {
	it("trims a nested list ({ data: { events: [...] } })", () => {
		const payload = {
			data: { events: salesFixture(300).data, summary: { count: 300 } },
		};
		const { text, truncated } = capJson(payload);
		expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
		const parsed = JSON.parse(text) as {
			data: { events: unknown[]; summary: unknown };
			preview?: string;
		};
		expect(parsed.preview).toBeUndefined();
		expect(truncated?.field).toBe("data.events");
		expect(parsed.data.events).toHaveLength(truncated?.shown ?? -1);
		expect(truncated?.shown).toBeGreaterThan(0);
		expect(parsed.data.summary).toEqual({ count: 300 });
	});

	it("the fan-out cuts the rows, not a heavier errors list", () => {
		const errors = Array.from({ length: 400 }, (_, i) => ({
			workspaceId: `ws_${i}`,
			workspaceName: `Workspace con un nombre bastante largo ${i}`,
			error: { code: "forbidden", message: "x".repeat(60) },
		}));
		const data = salesFixture(60).data;
		expect(JSON.stringify(errors).length).toBeGreaterThan(
			JSON.stringify(data).length,
		);
		// Cap that fits the errors plus some rows.
		const max = JSON.stringify(errors).length + 10_000;
		const { text, truncated } = capJson({ data, errors }, { max });
		const parsed = JSON.parse(text) as { data: unknown[]; errors: unknown[] };
		expect(truncated?.field).toBe("data");
		expect(parsed.errors).toHaveLength(400);
		expect(parsed.data.length).toBeGreaterThan(0);
		expect(parsed.data.length).toBeLessThan(60);
	});

	it("the preview never splits an emoji (surrogate pair)", () => {
		const loneSurrogate =
			/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
		const payload = { blob: "🎟️".repeat(MAX_TEXT_CHARS) };
		// Sweep the cap so the cut lands on every offset of the 3-unit emoji,
		// with and without slack left by escaping.
		// "a🎟" is a + D83C DF9F: a cut at 2 must not keep the high half.
		expect(sliceCodePoints("a🎟b", 2)).toBe("a");
		expect(sliceCodePoints("a🎟b", 3)).toBe("a🎟");
		for (let max = 600; max < 640; max++) {
			const { text } = capJson(payload, { max });
			expect(text.length).toBeLessThanOrEqual(max);
			expect(text).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
			const { preview } = JSON.parse(text) as { preview: string };
			expect(preview.length).toBeGreaterThan(0);
			expect(loneSurrogate.test(preview)).toBe(false);
		}
	});

	it("an escape-heavy preview (JSON quotes) still fits the cap", () => {
		const { text } = capJson({ blob: '"'.repeat(MAX_TEXT_CHARS * 2) });
		expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
		expect(
			(JSON.parse(text) as { preview: string }).preview.length,
		).toBeGreaterThan(0);
	});
});

describe("withStructured: the view sees the cut (QA #43 P1)", () => {
	it("a truncated view tool passes the note to structuredContent", async () => {
		const { call } = await connect(() => json(salesFixture(100)));
		const res = await call("sales_list", { limit: 100, verbose: true });
		const text = JSON.parse(res.content[0].text) as {
			data: unknown[];
			truncated: { shown: number; total: number };
		};
		expect(text.truncated.total).toBe(100);
		const sc = res.structuredContent as {
			data: unknown[];
			truncated?: { shown: number; total: number };
		};
		expect(sc.truncated).toEqual(text.truncated);
		expect(sc.data).toHaveLength(text.truncated.shown);
	});

	it("the preview fallback reaches the view as text, not as an object", async () => {
		const r = withStructured({
			content: [
				{
					type: "text",
					text: capJson({ blob: "x".repeat(MAX_TEXT_CHARS * 2) }).text,
				},
			],
		});
		expect(typeof r.structuredContent?.data).toBe("string");
		expect(r.structuredContent?.truncated?.shown).toBe(0);
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
