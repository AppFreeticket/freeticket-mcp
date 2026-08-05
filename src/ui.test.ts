import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server";
import { UI_MIME, UI_URI } from "./ui";

/**
 * Contrato de la extensión MCP Apps: recurso `ui://` + tools que lo apuntan por
 * `_meta.ui.resourceUri`. Si una de las dos mitades se cae, el host no dibuja
 * nada y no hay error visible — por eso se testea el cableado.
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

const server = buildServer({ apiUrl: "http://localhost", apiKey: "k" });

describe("MCP Apps view", () => {
	it("registers the ui:// resource with the profile mime type", () => {
		const res = internals(server)._registeredResources[UI_URI];
		expect(res).toBeDefined();
		expect(res.metadata?.mimeType).toBe(UI_MIME);
		expect(UI_URI.startsWith("ui://")).toBe(true);
	});

	it("serves self-contained HTML that speaks the ui/ dialect", async () => {
		const res = internals(server)._registeredResources[UI_URI];
		const out = (await res.readCallback(new URL(UI_URI))) as {
			contents: { text: string; mimeType: string }[];
		};
		const html = out.contents[0].text;
		expect(out.contents[0].mimeType).toBe(UI_MIME);
		expect(html).toContain("ui/initialize");
		expect(html).toContain("ui/notifications/initialized");
		expect(html).toContain("ui/notifications/tool-result");
		expect(html).toContain("ui/notifications/size-changed");
		// Autocontenido: sin red, el CSP del host no puede romperlo.
		expect(html).not.toMatch(/<script[^>]+src=/);
		expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
	});

	it("ships a script that parses", async () => {
		// El view vive dentro de un template literal: un typo ahí no lo ve ni tsc
		// ni biome, y en el host se manifiesta como un iframe en blanco.
		const res = internals(server)._registeredResources[UI_URI];
		const out = (await res.readCallback(new URL(UI_URI))) as {
			contents: { text: string }[];
		};
		const script = out.contents[0].text.match(
			/<script>([\s\S]*?)<\/script>/,
		)?.[1];
		expect(script).toBeTruthy();
		expect(() => new Function(script as string)).not.toThrow();
	});

	it("points the list/report tools at that resource", () => {
		const tools = internals(server)._registeredTools;
		for (const name of [
			"events_list",
			"sales_list",
			"reports_summary",
			"settlements_list",
			"reports_financials",
		]) {
			expect(
				(tools[name]?._meta?.ui as { resourceUri?: string })?.resourceUri,
			).toBe(UI_URI);
		}
	});
});
