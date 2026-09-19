// @vitest-environment jsdom
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { BRAND } from "./brand";
import { buildServer } from "./server";
import { UI_MIME, UI_PROTOCOL, UI_URI } from "./ui";

/**
 * The MCP Apps extension contract: a `ui://` resource plus the tools pointing
 * at it through `_meta.ui.resourceUri`. If either half breaks, the host draws
 * nothing and there is no visible error — which is why the wiring is tested.
 *
 * The view is also genuinely mounted (jsdom): it is ~150 lines of JS inside a
 * template literal that neither tsc nor biome looks at, and it renders
 * arbitrary API payloads. A string test would not have caught a broken escape
 * or branding overridden by the host theme.
 */
function internals(server: McpServer) {
	return server as unknown as {
		_registeredResources: Record<
			string,
			{ metadata?: { mimeType?: string }; readCallback: (u: URL) => unknown }
		>;
		_registeredTools: Record<string, { _meta?: Record<string, unknown> }>;
	};
}

const server = buildServer({
	apiUrl: "http://localhost",
	apiKey: "k",
	adminSession: "s",
});

async function viewHtml(): Promise<string> {
	const res = internals(server)._registeredResources[UI_URI];
	const out = (await res.readCallback(new URL(UI_URI))) as {
		contents: { text: string; mimeType: string }[];
	};
	return out.contents[0].text;
}

const uiTools = () =>
	Object.entries(internals(server)._registeredTools).filter(
		([, t]) => (t._meta?.ui as { resourceUri?: string })?.resourceUri,
	);

describe("MCP Apps wiring", () => {
	it("registers the ui:// resource with the profile mime type", () => {
		const res = internals(server)._registeredResources[UI_URI];
		expect(res).toBeDefined();
		expect(res.metadata?.mimeType).toBe(UI_MIME);
		expect(UI_URI.startsWith("ui://")).toBe(true);
	});

	it("serves self-contained HTML that speaks the ui/ dialect", async () => {
		const html = await viewHtml();
		// Métodos verificados contra ext-apps/src/spec.types.ts (2026-01-26).
		for (const m of [
			"ui/initialize",
			"ui/notifications/initialized",
			"ui/notifications/tool-result",
			"ui/notifications/host-context-changed",
			"ui/notifications/size-changed",
			"ui/resource-teardown",
		])
			expect(html).toContain(m);
		expect(html).toContain(UI_PROTOCOL);
		// Self-contained: the markup pulls nothing from the network, so the host's
		// deny-by-default CSP cannot break it. The only remote thing the view ever
		// loads is an event cover, and that URL comes from the payload at runtime.
		expect(html).not.toMatch(/<script[^>]+src=/);
		expect(html).not.toMatch(
			/<(link|img|iframe|source)[^>]+(src|href)="https?:/,
		);
	});

	it("points every list/report tool at that resource", () => {
		const tools = internals(server)._registeredTools;
		const withUi = new Set(uiTools().map(([n]) => n));
		// Lists and reports read better as a table or KPIs; without `_meta.ui`
		// they come out as a JSON dump and nobody notices what is missing.
		const byName = Object.keys(tools).filter((n) =>
			/_list$|^reports_(summary|by_event|timeseries|inventory|financials)$|^reconciliation$/.test(
				n,
			),
		);
		// The admin lists do not follow the `_list` suffix: they go by name.
		const expected = [
			...byName,
			"admin_workspaces",
			"admin_users",
			"admin_audit_log",
			"admin_tokens",
		];
		expect(expected.length).toBeGreaterThan(15);
		expect(expected.filter((n) => !withUi.has(n))).toEqual([]);
		for (const [, t] of uiTools())
			expect((t._meta?.ui as { resourceUri: string }).resourceUri).toBe(UI_URI);
	});

	it("keeps detail/write tools out of the view", () => {
		const withUi = new Set(uiTools().map(([n]) => n));
		// A lone object or a write acknowledgement gains nothing from the table,
		// and a free view on a delete misleads: the host draws it as if there
		// were data.
		for (const n of [
			"events_get",
			"sales_get",
			"events_create",
			"events_delete",
			"sales_refund",
			"tickets_checkin",
			"whoami",
		])
			expect(withUi.has(n)).toBe(false);
	});

	it("declares only the CSP the event covers need", () => {
		const res = internals(server)._registeredResources[UI_URI];
		const meta = (res.metadata as { _meta?: { ui?: Record<string, unknown> } })
			?._meta?.ui;
		// Images only: no connect-src, no script-src. A view that could call out
		// would be a way to leak the payload the host just handed it.
		expect(meta?.csp).toEqual({ "img-src": ["https:"] });
	});
});

/** Mounts the real view in jsdom with a fake `window.parent` that records what is sent. */
async function mount() {
	const html = await viewHtml();
	const sent: Record<string, unknown>[] = [];
	const parent = {
		postMessage: (m: Record<string, unknown>) => sent.push(m),
	} as unknown as Window;
	Object.defineProperty(window, "parent", {
		value: parent,
		configurable: true,
	});
	// jsdom has no ResizeObserver and the view uses it to report its height.
	(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
		observe() {}
		disconnect() {}
	};
	document.documentElement.removeAttribute("style");
	document.documentElement.removeAttribute("data-theme");
	document.documentElement.innerHTML = html
		.replace(/[\s\S]*?<head>/, "")
		.replace("</head>", "")
		.replace("<body>", "<body-marker>")
		.replace(/<script>[\s\S]*<\/script>/, "");
	// jsdom builds the <body> separately: we reinject its content and run the
	// script the way the browser would, once the DOM already exists.
	const body = html.match(/<body>([\s\S]*?)<script>/)?.[1] ?? "";
	document.body.innerHTML = body;
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
	new Function(script)();

	/** Pushes a message from the host, the way the parent iframe would. */
	const post = (data: unknown, source: unknown = parent) => {
		const ev = new MessageEvent("message", { data });
		Object.defineProperty(ev, "source", { value: source });
		window.dispatchEvent(ev);
	};
	return { sent, post, parent };
}

const toolResult = (data: unknown) => ({
	method: "ui/notifications/tool-result",
	params: {
		content: [{ type: "text", text: JSON.stringify({ data }) }],
		structuredContent: { data },
	},
});

describe("MCP Apps view — render", () => {
	beforeEach(() => {
		document.documentElement.innerHTML = "";
	});

	it("handshakes on load and reports its size", async () => {
		const { sent } = await mount();
		const init = sent.find((m) => m.method === "ui/initialize") as {
			params: { protocolVersion: string; appCapabilities: unknown };
			id: number;
		};
		expect(init).toBeDefined();
		expect(init.params.protocolVersion).toBe(UI_PROTOCOL);
		expect(init.id).toBe(1);
	});

	it("renders a list as a table with our columns", async () => {
		const { post } = await mount();
		post(
			toolResult([
				{ name: "Concierto", status: "PUBLISHED", grossAmount: 1250000 },
				{ name: "Teatro", status: "DRAFT", grossAmount: 90000 },
			]),
		);
		const table = document.querySelector("table");
		expect(table).toBeTruthy();
		expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
		expect(document.getElementById("sub")?.textContent).toBe("2 results");
		// camelCase → a readable label, and the amount formatted, not the raw number.
		expect(table?.textContent).toContain("gross Amount");
		expect(table?.textContent).toContain("1.250.000");
		// A terminal status marked as a brand pill.
		expect(document.querySelector(".pill.ok")?.textContent).toBe("PUBLISHED");
	});

	it("renders an event list as cards, not as a table", async () => {
		const { post } = await mount();
		post(
			toolResult([
				{
					slug: "gabo-chapinero",
					name: "El comediante Gabo",
					description: "Stand up en Chapinero",
					coverImageUrl: "https://cdn.example.com/gabo.jpg",
					city: "Bogotá",
					nextDate: "2026-09-19T19:00:00-05:00",
					priceFrom: 78330,
					currency: "COP",
				},
			]),
		);
		expect(document.querySelector("table")).toBeNull();
		const card = document.querySelector(".card");
		expect(card?.querySelector("h3")?.textContent).toBe("El comediante Gabo");
		expect(card?.querySelector(".cover img")?.getAttribute("src")).toBe(
			"https://cdn.example.com/gabo.jpg",
		);
		expect(card?.querySelector(".meta")?.textContent).toContain("Bogotá");
		// Price from, in the event currency — not a raw number in a column.
		expect(card?.querySelector(".pill.ok")?.textContent).toContain("78.330");
	});

	it("keeps a cover the host refuses from leaving a hole", async () => {
		const { post } = await mount();
		post(
			toolResult([{ slug: "s", name: "E", coverImageUrl: "http://x/y.jpg" }]),
		);
		const img = document.querySelector(".cover img") as HTMLImageElement;
		img.onerror?.(new Event("error"));
		expect(document.querySelector(".cover")).toBeNull();
		expect(document.querySelector(".card h3")?.textContent).toBe("E");
	});

	it("refuses a cover that is not http(s)", async () => {
		const { post } = await mount();
		post(
			toolResult([
				{ slug: "s", name: "E", coverImageUrl: "javascript:alert(1)" },
			]),
		);
		expect(document.querySelector(".card")).toBeTruthy();
		expect(document.querySelector("img")).toBeNull();
	});

	it("renders a single object as KPI tiles", async () => {
		const { post } = await mount();
		post(toolResult({ ticketsSold: 412, revenue: 8300000, nested: { a: 1 } }));
		const tiles = document.querySelectorAll(".tile");
		expect(tiles).toHaveLength(2); // `nested` se descarta, no es un KPI
		expect(document.body.textContent).toContain("tickets Sold");
		expect(document.body.textContent).toContain("412");
	});

	it("unwraps the { data: [...] } envelope of the API", async () => {
		const { post } = await mount();
		post({
			method: "ui/notifications/tool-result",
			params: {
				content: [
					{ type: "text", text: JSON.stringify({ data: [{ id: "1" }] }) },
				],
			},
		});
		expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
	});

	it("escapes API data instead of executing it", async () => {
		const { post } = await mount();
		post(toolResult([{ name: '<img src=x onerror="alert(1)">' }]));
		expect(document.querySelector("tbody img")).toBeNull();
		expect(document.querySelector("tbody td")?.textContent).toContain("<img");
	});

	it("shows tool errors as text, not as an empty frame", async () => {
		const { post } = await mount();
		post({
			method: "ui/notifications/tool-result",
			params: { isError: true, content: [{ type: "text", text: "401 boom" }] },
		});
		expect(document.getElementById("sub")?.textContent).toBe("error");
		expect(document.body.textContent).toContain("401 boom");
	});

	it("ignores messages that did not come from the host frame", async () => {
		const { post } = await mount();
		post(toolResult([{ name: "spoof" }]), { fake: true });
		expect(document.querySelector("table")).toBeNull();
	});

	it("answers ui/resource-teardown so the host can unmount cleanly", async () => {
		const { post, sent } = await mount();
		post({
			jsonrpc: "2.0",
			id: 99,
			method: "ui/resource-teardown",
			params: {},
		});
		expect(sent.find((m) => m.id === 99)).toMatchObject({ result: {} });
	});
});

describe("MCP Apps view — the branding stays ours", () => {
	beforeEach(() => {
		document.documentElement.innerHTML = "";
	});

	it("ships the FreeTicket mark and accent inline", async () => {
		const html = await viewHtml();
		expect(html).toContain(BRAND.accent);
		await mount();
		// Logo real de brand.ts, no un cuadradito de CSS.
		expect(document.querySelector("header svg")).toBeTruthy();
		expect(document.querySelector("header b")?.textContent).toBe("FreeTicket");
	});

	it("adopts the host palette but never its brand overrides", async () => {
		const { post } = await mount();
		post({
			method: "ui/notifications/host-context-changed",
			params: {
				theme: "dark",
				locale: "en-US",
				styles: {
					variables: {
						"--color-text-primary": "#eee",
						"--ft": "#ff0000",
						"--font-sans": "Comic Sans MS",
					},
				},
			},
		});
		const root = document.documentElement;
		expect(root.style.getPropertyValue("--color-text-primary")).toBe("#eee");
		expect(root.style.getPropertyValue("--font-sans")).toBe("Comic Sans MS");
		// The host may paint the chat; FreeTicket's accent is untouchable.
		expect(root.style.getPropertyValue("--ft")).toBe("");
		// Theme: data-theme AND color-scheme, otherwise light-dark() follows the OS.
		expect(root.dataset.theme).toBe("dark");
		expect(root.style.colorScheme).toBe("dark");
	});

	it("formats money in the host locale when it declares one", async () => {
		const { post } = await mount();
		post({
			method: "ui/notifications/host-context-changed",
			params: { locale: "en-US" },
		});
		post(toolResult([{ totalAmount: 1250000 }]));
		expect(document.querySelector("tbody td")?.textContent).toBe("1,250,000");
	});

	it("survives a bogus locale from the host", async () => {
		const { post } = await mount();
		post({
			method: "ui/notifications/host-context-changed",
			params: { locale: "no-such-locale!!" },
		});
		post(toolResult([{ totalAmount: 1000 }]));
		expect(document.querySelector("tbody td")?.textContent).toBeTruthy();
	});
});
