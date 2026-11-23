import {
	McpServer,
	type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type Creds,
	makeAdminClient,
	makeB2bClient,
	makeCustomerClient,
	makePublicClient,
} from "./api";
import { registerAdminTools } from "./tools/admin";
import { registerB2bTools } from "./tools/b2b";
import { registerB2bWriteTools } from "./tools/b2b-writes";
import { registerCustomerTools } from "./tools/customer";
import { registerCustomerCommunityTools } from "./tools/customer-community";
import { registerPublicTools } from "./tools/public";
import { registerUi } from "./ui";

export const VERSION = "0.24.0";

/**
 * A view of the server that drops every tool not annotated `readOnlyHint:
 * true` as soon as it registers. Fail-closed: a tool without annotations is a
 * write. Used for read-only connections (OAuth scope `read`, FT_READ_ONLY=1).
 */
export function readOnlyView(server: McpServer): McpServer {
	const keepReads =
		<A extends unknown[]>(fn: (...a: A) => RegisteredTool) =>
		(...args: A) => {
			const t = fn(...args);
			if (t.annotations?.readOnlyHint !== true) t.remove();
			return t;
		};
	return new Proxy(server, {
		get(target, prop, receiver) {
			if (prop === "tool") return keepReads(target.tool.bind(target) as never);
			if (prop === "registerTool")
				return keepReads(target.registerTool.bind(target) as never);
			return Reflect.get(target, prop, receiver);
		},
	});
}

export interface BuildOptions {
	/**
	 * Lazy auth (anonymous /mcp): also LIST the B2B tools, built without a
	 * credential, so the model can pick one and the HTTP gate answers its call
	 * with 401 + WWW-Authenticate — the signal that makes the client sign in.
	 * Their calls never reach the SDK (src/handler.ts gates them first).
	 */
	listProtected?: boolean;
}

/**
 * Server-level guidance sent once in `initialize`. Static on purpose: no
 * dates, versions or per-session data, so every client (and its prompt
 * cache) sees the same text. Per-tool details stay in each description.
 */
export const INSTRUCTIONS = [
	"FreeTicket MCP server (event ticketing). Tools are grouped by credential:",
	"- public_*: public catalog and checkout, no credential. They identify events by slug.",
	"- No prefix (B2B): organizer operations with an API key: events, dates, ticket types, sales, tickets, memberships, reports, content. They identify resources by id.",
	"- customer_*: a buyer's own data (tickets, profile, membership, addresses). Listed only when the connection carries the buyer session (header X-Customer-Session or FT_CUSTOMER_SESSION); it is never passed as an argument.",
	"- admin_*: platform super-admin; only over stdio with FT_ADMIN_SESSION, not on the hosted server.",
	"",
	"Usual order:",
	"1. whoami to see the user, workspaces, active workspace and key scope (read or write).",
	"2. To talk about an event, find it with events_list and q (name) and take its id; do not pull the full list to search by hand.",
	"3. With that id: sales_list (event), reports_inventory (eventId) or reports_financials (event). reports_by_event compares all events at once.",
	"",
	"Rules:",
	"- Reads without a workspace cover every workspace in the session and tag each row with workspaceId. To paginate deep, name a single workspace.",
	"- Writes act on a single workspace, the session's active one. Never repeat a write across workspaces unless the user asks.",
	"- A read-only connection (scope read or a read key) does not list write tools: if one is missing, ask to reconnect with write permission.",
	"- Amounts are Colombian pesos (COP), integers with no decimals.",
	"- Cursor pagination: limit (1-100) and cursor; follow page.nextCursor while page.hasMore is true.",
	"- Responses are compact JSON with a size cap. A list that does not fit arrives cut with truncated: { shown, total, field, hint } and page.nextCursor null: repeat the same call with the same cursor and limit equal to shown to continue without skipping rows.",
	"- sales_list, sales_tickets, sales_attempts and the buyer/attendee exports return a trimmed view by default; verbose: true returns the full row.",
	"- Errors carry error.code, status, retryable and a hint with the next step; if retryAfterSeconds is present, wait that long before retrying.",
	"- Ids and slugs are not interchangeable: public_* takes a slug, everything else takes an id.",
	"- Destructive tools (delete, cancel, refund, ban) are confirmed with the user before running.",
].join("\n");

/**
 * Builds an isolated McpServer for one session. Every session carries its own
 * clients — there is no shared global state, so the same binary serves many
 * tenants over HTTP without crossing credentials.
 *
 * Layers by credential level:
 *  - public_* (B2C): ALWAYS — anonymous, needs no API key.
 *  - B2B: only when the session carries an `apiKey`.
 *  - customer_*: only when it carries a `customerSession` (a credential,
 *    never a tool argument).
 *  - admin_*: only when it carries an `adminSession`.
 * With `readOnly`, every layer keeps only its readOnly tools.
 */
export function buildServer(creds: Creds, opts: BuildOptions = {}): McpServer {
	const server = new McpServer(
		{ name: "freeticket", version: VERSION },
		{ instructions: INSTRUCTIONS },
	);
	const tools = creds.readOnly ? readOnlyView(server) : server;

	// The MCP Apps view. Always registered: the tools that use it point at it
	// through `_meta.ui.resourceUri`, and a host without the extension just
	// never asks for it.
	registerUi(server);

	// Public B2C: no credentials, always available.
	registerPublicTools(tools, makePublicClient(creds.apiUrl));

	if (creds.apiKey || opts.listProtected) {
		const client = makeB2bClient(creds);
		registerB2bTools(tools, client, creds);
		registerB2bWriteTools(tools, client, creds);
		// Buyer community + live chat: enterprise key AND buyer session.
		if (creds.customerSession)
			registerCustomerCommunityTools(tools, client, creds.customerSession);
	}
	if (creds.customerSession) {
		registerCustomerTools(tools, makeCustomerClient(creds));
	}
	if (creds.adminSession) {
		registerAdminTools(tools, makeAdminClient(creds));
	}
	return server;
}

/** Names of the tools a session would expose (for the HTTP lazy-auth gate). */
export function toolNames(server: McpServer): Set<string> {
	// ponytail: _registeredTools is SDK-internal; tests pin it.
	return new Set(
		Object.keys(
			(server as unknown as { _registeredTools: Record<string, unknown> })
				._registeredTools,
		),
	);
}
