import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
	type Creds,
	makeAdminClient,
	makeB2bClient,
	makePublicClient,
} from "./api";
import { registerAdminTools } from "./tools/admin";
import { registerB2bTools } from "./tools/b2b";
import { registerB2bWriteTools } from "./tools/b2b-writes";
import { registerPublicTools } from "./tools/public";
import { registerUi } from "./ui";

export const VERSION = "0.15.1";

/**
 * Builds an isolated McpServer for one session. Every session carries its own
 * clients — there is no shared global state, so the same binary serves many
 * tenants over HTTP without crossing credentials.
 *
 * Layers by credential level:
 *  - public_* (B2C): ALWAYS — anonymous, needs no API key.
 *  - B2B: only when the session carries an `apiKey`.
 *  - admin_*: only when it carries an `adminSession`.
 */
export function buildServer(creds: Creds): McpServer {
	const server = new McpServer({ name: "freeticket", version: VERSION });

	// The MCP Apps view. Always registered: the tools that use it point at it
	// through `_meta.ui.resourceUri`, and a host without the extension just
	// never asks for it.
	registerUi(server);

	// Public B2C: no credentials, always available.
	registerPublicTools(server, makePublicClient(creds.apiUrl));

	if (creds.apiKey) {
		const client = makeB2bClient(creds);
		registerB2bTools(server, client, creds);
		registerB2bWriteTools(server, client);
	}
	if (creds.adminSession) {
		registerAdminTools(server, makeAdminClient(creds));
	}
	annotate(server);
	return server;
}

/**
 * Writes that leave FreeTicket. Everything else stays inside the caller's
 * workspace or the published catalogue, so `openWorldHint` is false.
 * ChatGPT rejects a tool that omits the key (#37).
 */
const OPEN_WORLD_WRITES = new Set([
	"public_orders_create",
	"public_tickets_resend",
	"sales_refund",
	"tickets_resend",
]);

/**
 * Per the MCP spec a tool without `readOnlyHint` is assumed to write, and
 * `destructiveHint` then defaults to true: every bare read looked like a
 * destructive write to hosts (claude.ai asks to approve each one, and the
 * Anthropic connector directory rejects tools without hints or a title). Reads
 * register with no annotations, writes always carry `destructiveHint`, so the
 * rule is: no destructiveHint → read. Every tool also gets a `title` and an
 * explicit `openWorldHint`.
 */
function annotate(server: McpServer): void {
	// ponytail: SDK-private map (stable through 1.x); swap for a per-call
	// registration helper if the SDK ever hides it.
	const tools = (
		server as unknown as {
			_registeredTools: Record<
				string,
				{ title?: string; annotations?: ToolAnnotations }
			>;
		}
	)._registeredTools;
	for (const [name, tool] of Object.entries(tools)) {
		const a = tool.annotations ?? {};
		const write = a.destructiveHint !== undefined;
		tool.annotations = {
			...a,
			title: a.title ?? tool.title ?? titleOf(name),
			readOnlyHint: !write,
			destructiveHint: write ? a.destructiveHint === true : false,
			idempotentHint:
				typeof a.idempotentHint === "boolean" ? a.idempotentHint : !write,
			openWorldHint: write && OPEN_WORLD_WRITES.has(name),
		};
	}
}

/** `admin_workspaces_get` → "Admin workspaces get". */
const titleOf = (name: string) =>
	name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");
