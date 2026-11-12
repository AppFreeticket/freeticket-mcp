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
	"Servidor MCP de FreeTicket (venta de entradas). Las herramientas se agrupan por credencial:",
	"- public_*: catálogo y compra públicos, sin credencial. Identifican eventos por slug.",
	"- Sin prefijo (B2B): operación del organizador con API key: eventos, fechas, tipos de entrada, ventas, tickets, membresías, reportes, contenido. Identifican recursos por id.",
	"- customer_*: datos de un comprador (entradas, perfil, membresía, direcciones). Solo aparecen si la conexión trae la sesión del comprador (header X-Customer-Session o FT_CUSTOMER_SESSION); nunca se pasa como argumento.",
	"- admin_*: superadministración de la plataforma; solo por stdio con FT_ADMIN_SESSION, no en el servidor alojado.",
	"",
	"Orden habitual:",
	"1. whoami para ver usuario, workspaces, workspace activo y alcance de la key (read o write).",
	"2. Para hablar de un evento, búscalo con events_list y q (nombre) y toma su id; no traigas la lista completa para buscar a mano.",
	"3. Con ese id: sales_list (event), reports_inventory (eventId) o reports_financials (event). reports_by_event compara todos los eventos a la vez.",
	"",
	"Reglas:",
	"- Las lecturas sin workspace cubren todos los workspaces de la sesión y etiquetan cada fila con workspaceId. Para paginar a fondo, nombra un solo workspace.",
	"- Las escrituras actúan sobre un solo workspace, el activo de la sesión. Nunca repitas una escritura en varios workspaces sin que el usuario lo pida.",
	"- Una conexión de solo lectura (scope read o key read) no lista las herramientas de escritura: si falta una, pide reconectar con permiso de escritura.",
	"- Los montos están en pesos colombianos (COP), enteros y sin decimales.",
	"- Paginación por cursor: limit (1-100) y cursor; sigue page.nextCursor mientras page.hasMore sea true.",
	"- Las respuestas son JSON compacto con un tope de tamaño. Si una lista no cabe llega recortada con truncated: { shown, total, field, hint } y page.nextCursor en null: repite la misma llamada con el mismo cursor y limit igual a shown para seguir sin saltar filas.",
	"- sales_list, sales_tickets, sales_attempts y los exports de compradores/asistentes devuelven una vista recortada por defecto; verbose: true trae la fila completa.",
	"- Los errores traen error.code, status, retryable y un hint con el siguiente paso; si viene retryAfterSeconds, espera ese tiempo antes de reintentar.",
	"- Los ids y los slugs no son intercambiables: public_* usa slug, el resto usa id.",
	"- Las herramientas destructivas (borrar, cancelar, reembolsar, banear) se confirman con el usuario antes de ejecutarlas.",
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
