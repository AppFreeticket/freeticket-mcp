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
import { registerPublicTools } from "./tools/public";
import { registerUi } from "./ui";

export const VERSION = "0.23.0";

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
	const server = new McpServer({ name: "freeticket", version: VERSION });
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
