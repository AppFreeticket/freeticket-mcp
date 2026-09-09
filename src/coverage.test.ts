import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Barrido de contrato: cada operación de los tres specs tiene un tool, o está
 * excluida acá con su razón. Sin este test, un endpoint nuevo entra al spec con
 * `sync-openapi` y se queda sin tool para siempre — nadie lo nota, porque no
 * falla nada: simplemente el agente no puede hacer esa cosa.
 *
 * El match es por operationId contra el fuente de los tools: el cliente generado
 * exporta una función por operationId, así que si el nombre aparece, hay tool.
 */
const root = join(import.meta.dirname, "..");
const source = ["admin.ts", "b2b.ts", "b2b-writes.ts", "public.ts"]
	.map((f) => readFileSync(join(root, "src", "tools", f), "utf8"))
	.join("\n");

/**
 * Operaciones deliberadamente fuera del MCP. Cada una con su motivo: si mañana
 * alguien quiere exponerla, que discuta el motivo, no que lo descubra.
 */
const EXCLUDED: Record<string, string> = {
	// Mecánica del device flow: la usa el AS embebido (src/handler.ts), no un
	// agente. Exponerla como tool sería darle al modelo el flujo de login.
	postAuthDeviceCode: "device flow — lo maneja el AS del propio mcp",
	postAuthDeviceToken: "device flow — lo maneja el AS del propio mcp",
	// Credenciales: un agente no debería poder acuñar ni revocar acceso. Se hace
	// con el CLI, donde hay un humano en el teclado.
	postApiKeys: "acuñar credenciales es del CLI (`ft api-keys`)",
	deleteApiKeysId: "revocar credenciales es del CLI (`ft api-keys`)",
	postTokens: "acuñar PAT de plataforma es del CLI (`ft admin tokens`)",
	deleteTokensId: "revocar PAT de plataforma es del CLI (`ft admin tokens`)",
	// Mintea sesiones de comprador a partir de un one-time token: server-to-server
	// entre free-admin y el integrador, no algo que un agente deba disparar.
	postApiCustomerAuthEnterpriseExchange:
		"canje de sesión de terceros — server-to-server, no de agente",
};

function operations(specFile: string): { id: string; where: string }[] {
	const spec = JSON.parse(readFileSync(join(root, specFile), "utf8")) as {
		paths: Record<string, Record<string, { operationId?: string }>>;
	};
	const out: { id: string; where: string }[] = [];
	for (const [path, item] of Object.entries(spec.paths ?? {}))
		for (const [method, op] of Object.entries(item)) {
			if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
			if (op.operationId)
				out.push({
					id: op.operationId,
					where: `${method.toUpperCase()} ${path}`,
				});
		}
	return out;
}

describe.each([
	["B2B /api/v1", "openapi.json", 81],
	["superadmin /api/admin", "admin-openapi.json", 23],
	["público /api/public", "public-openapi.json", 6],
])("contrato %s", (_label, file, minOps) => {
	const ops = operations(file);

	it("expone todas sus operaciones como tools (o las excluye con motivo)", () => {
		const uncovered = ops
			.filter((o) => !EXCLUDED[o.id])
			.filter((o) => !new RegExp(`\\b${o.id}\\b`).test(source))
			.map((o) => `${o.where} [${o.id}]`);
		expect(uncovered).toEqual([]);
	});

	it("no encogió de golpe (un spec truncado rompería los clientes en silencio)", () => {
		expect(ops.length).toBeGreaterThanOrEqual(minOps);
	});
});

it("no arrastra exclusiones de operaciones que el contrato ya no tiene", () => {
	// Una exclusión huérfana es una regla que nadie volvió a mirar.
	const ids = new Set(
		["openapi.json", "admin-openapi.json", "public-openapi.json"]
			.flatMap(operations)
			.map((o) => o.id),
	);
	expect(Object.keys(EXCLUDED).filter((id) => !ids.has(id))).toEqual([]);
});
