import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	operations,
	root,
	SPECS,
	type SpecFile,
	toolFiles,
} from "./test-support/contract";

/**
 * Contract sweep: every operation of the three specs either has a tool, or is
 * excluded here with its reason. Without this test, a new endpoint arrives in
 * the spec through `sync-openapi` and stays tool-less forever — nobody notices,
 * because nothing fails: the agent simply cannot do that thing.
 *
 * The match is by operationId against the tool sources: the generated client
 * exports one function per operationId, so if the name shows up, a tool exists.
 */
/**
 * Each spec is matched only against the tools that use ITS client. A single
 * merged source let one spec mask another: `postWorkspaces` of /api/admin
 * counted v1's `POST /workspaces` as covered when no B2B tool called it.
 */
const sourceOf = (files: string[]) =>
	files
		.map((f) => readFileSync(join(root, "src", "tools", f), "utf8"))
		.join("\n");

/**
 * Operations deliberately kept out of the MCP, each with its reason: if someone
 * wants to expose one tomorrow, they argue with the reason instead of
 * rediscovering it.
 *
 * Operations the contract itself marks `x-ft-mcp: { expose: false }` do not go
 * here: their reason lives in the spec (see `operations()`). Today that is the
 * CRM master writes of /api/admin — `postCrmCampaigns`,
 * `postCrmCampaignsIdBatchesNext`, `postCrmCampaignsIdBatchesStop` and
 * `postCrmCampaignsIdCancel` — which send real messages to buyers. If
 * free-admin drops the marker, the coverage test demands a tool for them, so
 * removing it is never a silent way in.
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
	// Account and credential bootstrap: sign-up and the buyer's device grant.
	// The MCP gets its credentials from its own consent page (src/handler.ts);
	// a tool that opens accounts or mints buyer sessions is new auth, not a tool.
	postAuthSignup:
		"account sign-up belongs to the CLI (`ft signup`) and the web",
	postCustomerAuthRequest:
		"buyer device-grant bootstrap — a login flow, not a tool",
	postCustomerAuthVerify:
		"buyer device-grant bootstrap — a login flow, not a tool",
	// Headless checkout of an enterprise landing page: every step needs the
	// browser (seats.io chart with a server hold, Brick/Bold widget, a returnUrl
	// on the enterprise allowlist, buyer ID documents). An agent buys through
	// public_orders_create; the customer_order_* reads/release do exist.
	postCustomerPurchaseSessions:
		"seats.io hold for a landing page chart — needs the browser",
	getCustomerPurchaseSessionsId:
		"polling of the landing page's seats.io session — needs the browser",
	postCustomerPurchaseSessionsIdRelease:
		"releases the landing page's seats.io session — needs the browser",
	postCustomerOrders:
		"landing page checkout (returnUrl allowlist, ID documents) — agents use public_orders_create",
	postCustomerOrdersIdPayment:
		"signed config to mount the Brick/Bold widget — needs the browser",
	postCustomerOrdersIdPaymentCard:
		"charges a Brick card token — card data never passes through an agent",
	postCustomerOrdersIdPaymentPse:
		"PSE redirect of the landing page checkout, which the MCP does not open",
	// Headless merch store of an enterprise landing (contract 1.36): placing an
	// order takes the buyer's ID document and phone and holds stock, and paying
	// it charges a Brick card token. Same line as the ticket checkout above; the
	// catalog and the order lookup are tools (merch_catalog, merch_orders_lookup).
	postMerchOrders:
		"landing page merch checkout (buyer ID document, stock hold) — needs the browser",
	postMerchOrdersCodePaymentCard:
		"charges a Brick card token — card data never passes through an agent",
};

/**
 * The contract can mark an operation `x-ft-mcp: { expose: false, reason }`:
 * free-admin decides, next to the route, that agents must not get it (the CRM
 * writes send real email and WhatsApp to buyers). Those count as excluded with
 * the spec's own reason, and must NOT show up in the tools — the opposite of
 * the coverage rule, checked across every tool file at the end of this file.
 */
describe.each([
	[
		"B2B /api/v1",
		"openapi.json",
		["b2b.ts", "b2b-writes.ts", "customer.ts"],
		200,
	],
	["superadmin /api/admin", "admin-openapi.json", ["admin.ts"], 36],
	["public /api/public", "public-openapi.json", ["public.ts"], 6],
])("contract %s", (_label, file, files, minOps) => {
	const ops = operations(file as SpecFile);
	const source = sourceOf(files);

	it("exposes every operation as a tool (or excludes it with a reason)", () => {
		const uncovered = ops
			.filter((o) => !EXCLUDED[o.id] && !o.hidden)
			.filter((o) => !new RegExp(`\\b${o.id}\\b`).test(source))
			.map((o) => `${o.where} [${o.id}]`);
		expect(uncovered).toEqual([]);
	});

	it("every x-ft-mcp.expose=false carries its reason", () => {
		const bare = ops
			.filter((o) => o.hidden === "(no reason)")
			.map((o) => o.where);
		expect(bare).toEqual([]);
	});

	it("did not shrink abruptly (a truncated spec would break the clients silently)", () => {
		expect(ops.length).toBeGreaterThanOrEqual(minOps);
	});
});

it("does not duplicate in EXCLUDED what the contract already hides", () => {
	// Two sources for the same rule drift apart: the spec's reason wins.
	const hidden = SPECS.flatMap(operations)
		.filter((o) => o.hidden)
		.map((o) => o.id);
	expect(hidden.filter((id) => EXCLUDED[id])).toEqual([]);
});

it("carries no exclusions for operations the contract no longer has", () => {
	// An orphaned exclusion is a rule nobody has looked at again.
	const ids = new Set(SPECS.flatMap(operations).map((o) => o.id));
	expect(Object.keys(EXCLUDED).filter((id) => !ids.has(id))).toEqual([]);
});

it("no tool file calls an excluded or x-ft-mcp.expose=false operation", () => {
	// Checked against EVERY file under src/tools, not just the ones that use the
	// spec's own client: a CRM write wired into b2b-writes.ts, or an EXCLUDED
	// credential mint added to admin.ts, must fail here too. The coverage rule
	// above accepts a bare mention (a comment counts); this one looks for a
	// call, or an aliased import that would hide the call.
	const banned = SPECS.flatMap(operations)
		.filter((o) => o.hidden || EXCLUDED[o.id])
		.map((o) => ({ ...o, why: o.hidden ?? EXCLUDED[o.id] }));
	expect(banned.length).toBeGreaterThanOrEqual(Object.keys(EXCLUDED).length);
	const leaked: string[] = [];
	for (const { file, text } of toolFiles())
		for (const o of banned)
			if (new RegExp(`\\b${o.id}(\\s*\\(|\\s+as\\b)`).test(text))
				leaked.push(`${file}: ${o.where} [${o.id}] — ${o.why}`);
	expect(leaked).toEqual([]);
});
