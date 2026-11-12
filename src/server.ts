import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export const VERSION = "0.22.0";

/**
 * Server-level guidance sent once in `initialize`. Static on purpose: no
 * dates, versions or per-session data, so every client (and its prompt
 * cache) sees the same text. Per-tool details stay in each description.
 */
export const INSTRUCTIONS = [
	"Servidor MCP de FreeTicket (venta de entradas). Las herramientas se agrupan por credencial:",
	"- public_*: catálogo y compra públicos, sin credencial. Identifican eventos por slug.",
	"- Sin prefijo (B2B): operación del organizador con API key: eventos, fechas, tipos de entrada, ventas, tickets, membresías, reportes, contenido. Identifican recursos por id.",
	"- customer_*: datos de un comprador (entradas, perfil, membresía, direcciones); requieren la sesión de ese comprador.",
	"- admin_*: superadministración de la plataforma; solo con sesión de superadmin.",
	"",
	"Orden habitual:",
	"1. whoami para ver usuario, workspaces, workspace activo y alcance de la key (read o write).",
	"2. Para hablar de un evento, búscalo con events_list y q (nombre) y toma su id; no traigas la lista completa para buscar a mano.",
	"3. Con ese id: sales_list (event), reports_inventory (eventId) o reports_financials (event). reports_by_event compara todos los eventos a la vez.",
	"",
	"Reglas:",
	"- Las lecturas sin workspace cubren todos los workspaces de la sesión y etiquetan cada fila con workspaceId. Para paginar a fondo, nombra un solo workspace.",
	"- Las escrituras actúan sobre un solo workspace, el activo de la sesión. Nunca repitas una escritura en varios workspaces sin que el usuario lo pida.",
	"- Una key read solo puede leer: las escrituras responden 403.",
	"- Los montos están en pesos colombianos (COP), enteros y sin decimales.",
	"- Paginación por cursor: limit (1-100) y cursor; sigue page.nextCursor mientras page.hasMore sea true.",
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
 *  - admin_*: only when it carries an `adminSession`.
 */
export function buildServer(creds: Creds): McpServer {
	const server = new McpServer(
		{ name: "freeticket", version: VERSION },
		{ instructions: INSTRUCTIONS },
	);

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
	return server;
}
