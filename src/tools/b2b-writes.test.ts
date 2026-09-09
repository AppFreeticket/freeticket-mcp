import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { makeB2bClient } from "../api";
import { registerB2bWriteTools } from "./b2b-writes";

const stub = makeB2bClient({ apiUrl: "http://localhost", apiKey: "test" });

interface Registered {
	description?: string;
	annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
}

function registered(): Record<string, Registered> {
	const server = new McpServer({ name: "t", version: "0.0.0" });
	registerB2bWriteTools(server, stub);
	// ponytail: _registeredTools es interno del SDK; si cambia, este test avisa.
	return (server as unknown as { _registeredTools: Record<string, Registered> })
		._registeredTools;
}

/**
 * Los writes que borran, cancelan o reembolsan son la superficie donde un
 * error del agente no se deshace. El gate de confirmación del host cuelga de
 * `destructiveHint`, y el recordatorio en la descripción es lo único que ve el
 * modelo. Antes nada verificaba ninguno de los dos: un refactor podía dejar un
 * delete sin annotation y ningún test se enteraba (issue #15).
 */
const DESTRUCTIVE = [
	"events_delete",
	"event_dates_delete",
	"ticket_types_delete",
	"plans_delete",
	"discounts_delete",
	"venues_delete",
	"webhooks_delete",
	"sales_cancel",
	"sales_refund",
	"subscriptions_cancel",
];

describe("writes destructivos", () => {
	const tools = registered();

	it("los destructivos existen y están anotados como tales", () => {
		for (const name of DESTRUCTIVE) {
			expect(tools[name], `falta el tool ${name}`).toBeDefined();
			expect(
				tools[name].annotations?.destructiveHint,
				`${name} sin destructiveHint: el host no va a pedir confirmación`,
			).toBe(true);
		}
	});

	it("los destructivos avisan también en la descripción", () => {
		for (const name of DESTRUCTIVE) {
			expect(
				tools[name].description,
				`${name} sin el aviso de irreversible en la descripción`,
			).toContain("Irreversible");
		}
	});

	it("ningún write queda sin annotations", () => {
		for (const [name, tool] of Object.entries(tools)) {
			expect(
				tool.annotations?.destructiveHint,
				`${name} sin annotations`,
			).toBeDefined();
		}
	});
});
