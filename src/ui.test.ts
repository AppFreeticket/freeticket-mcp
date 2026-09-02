// @vitest-environment jsdom
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";
import { BRAND } from "./brand";
import { buildServer } from "./server";
import { UI_MIME, UI_PROTOCOL, UI_URI } from "./ui";

/**
 * Contrato de la extensión MCP Apps: recurso `ui://` + tools que lo apuntan por
 * `_meta.ui.resourceUri`. Si una de las dos mitades se cae, el host no dibuja
 * nada y no hay error visible — por eso se testea el cableado.
 *
 * El view además se monta de verdad (jsdom): es ~150 líneas de JS dentro de un
 * template literal que ni tsc ni biome miran, y renderiza payloads arbitrarios
 * de la API. Un test de strings no habría visto un escape roto ni una marca
 * pisada por el tema del host.
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
		// Autocontenido: sin red, el CSP deny-by-default del host no lo rompe.
		expect(html).not.toMatch(/<script[^>]+src=/);
		expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
	});

	it("points every list/report tool at that resource", () => {
		const tools = internals(server)._registeredTools;
		const withUi = new Set(uiTools().map(([n]) => n));
		// Los listados y reportes se ven mejor como tabla/KPIs; sin `_meta.ui`
		// salen como un volcado de JSON y nadie se entera de que les falta.
		const byName = Object.keys(tools).filter((n) =>
			/_list$|^reports_(summary|by_event|timeseries|inventory|financials)$|^reconciliation$/.test(
				n,
			),
		);
		// Los listados admin no siguen el sufijo `_list`: van por nombre.
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
		// Un objeto suelto o un ack de write no gana nada con la tabla, y el view
		// gratis en un delete confunde: el host lo dibuja como si hubiera datos.
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

	it("declares no external CSP origins (the view asks for no network)", () => {
		const res = internals(server)._registeredResources[UI_URI];
		const meta = (res.metadata as { _meta?: { ui?: Record<string, unknown> } })
			?._meta?.ui;
		expect(meta?.csp).toEqual({});
	});
});

/** Monta el view real en jsdom con un `window.parent` falso que graba lo enviado. */
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
	// jsdom no trae ResizeObserver y el view lo usa para reportar su alto.
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
	// El <body> lo arma jsdom aparte: reinyectamos su contenido y corremos el
	// script como lo haría el navegador, una vez que el DOM ya existe.
	const body = html.match(/<body>([\s\S]*?)<script>/)?.[1] ?? "";
	document.body.innerHTML = body;
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
	new Function(script)();

	/** Empuja un mensaje del host, como haría el iframe padre. */
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
		expect(document.getElementById("sub")?.textContent).toBe("2 resultados");
		// camelCase → etiqueta legible, y el importe formateado, no el número crudo.
		expect(table?.textContent).toContain("gross Amount");
		expect(table?.textContent).toContain("1.250.000");
		// Estado terminal marcado como pill de marca.
		expect(document.querySelector(".pill.ok")?.textContent).toBe("PUBLISHED");
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

describe("MCP Apps view — la marca sigue siendo nuestra", () => {
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
		// El host puede pintar el chat; el acento de FreeTicket no se toca.
		expect(root.style.getPropertyValue("--ft")).toBe("");
		// Tema: data-theme Y color-scheme, si no light-dark() sigue al SO.
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
