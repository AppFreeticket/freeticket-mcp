import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract sweep: every operation of the three specs either has a tool, or is
 * excluded here with its reason. Without this test, a new endpoint arrives in
 * the spec through `sync-openapi` and stays tool-less forever — nobody notices,
 * because nothing fails: the agent simply cannot do that thing.
 *
 * The match is by operationId against the tool sources: the generated client
 * exports one function per operationId, so if the name shows up, a tool exists.
 */
const root = join(import.meta.dirname, "..");
const source = ["admin.ts", "b2b.ts", "b2b-writes.ts", "public.ts"]
	.map((f) => readFileSync(join(root, "src", "tools", f), "utf8"))
	.join("\n");

/**
 * Operations deliberately kept out of the MCP, each with its reason: if someone
 * wants to expose one tomorrow, they argue with the reason instead of
 * rediscovering it.
 */
const EXCLUDED: Record<string, string> = {
	// Device flow mechanics: used by the embedded AS (src/handler.ts), not by an
	// agent. Exposing it as a tool would hand the model the login flow.
	postAuthDeviceCode: "device flow — handled by the AS inside the mcp",
	postAuthDeviceToken: "device flow — handled by the AS inside the mcp",
	// Credentials: an agent should not be able to mint or revoke access. That is
	// done with the CLI, where there is a human at the keyboard.
	postApiKeys: "minting credentials belongs to the CLI (`ft api-keys`)",
	deleteApiKeysId: "revoking credentials belongs to the CLI (`ft api-keys`)",
	postTokens: "minting platform PATs belongs to the CLI (`ft admin tokens`)",
	deleteTokensId:
		"revoking platform PATs belongs to the CLI (`ft admin tokens`)",
	// Mints buyer sessions from a one-time token: server-to-server between
	// free-admin and the integrator, not something an agent should fire.
	postApiCustomerAuthEnterpriseExchange:
		"third-party session exchange — server-to-server, not for an agent",
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
	["public /api/public", "public-openapi.json", 6],
])("contract %s", (_label, file, minOps) => {
	const ops = operations(file);

	it("exposes every operation as a tool (or excludes it with a reason)", () => {
		const uncovered = ops
			.filter((o) => !EXCLUDED[o.id])
			.filter((o) => !new RegExp(`\\b${o.id}\\b`).test(source))
			.map((o) => `${o.where} [${o.id}]`);
		expect(uncovered).toEqual([]);
	});

	it("did not shrink abruptly (a truncated spec would break the clients silently)", () => {
		expect(ops.length).toBeGreaterThanOrEqual(minOps);
	});
});

it("carries no exclusions for operations the contract no longer has", () => {
	// An orphaned exclusion is a rule nobody has looked at again.
	const ids = new Set(
		["openapi.json", "admin-openapi.json", "public-openapi.json"]
			.flatMap(operations)
			.map((o) => o.id),
	);
	expect(Object.keys(EXCLUDED).filter((id) => !ids.has(id))).toEqual([]);
});
