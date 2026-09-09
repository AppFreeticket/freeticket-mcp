import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Creds, run } from "../api";
import {
	getApiKeys,
	getContentLives,
	getContentLivesId,
	getContentPosts,
	getContentVideos,
	getCustomerMe,
	getCustomerMembership,
	getCustomerProfile,
	getCustomerTickets,
	getCustomerTicketsId,
	getDiscounts,
	getEvents,
	getEventsId,
	getEventsIdDates,
	getMe,
	getMembershipPlans,
	getMembershipPlansId,
	getMembershipPlansIdSubscribers,
	getReportsByEvent,
	getReportsExportsAttendees,
	getReportsExportsBuyers,
	getReportsExportsReconciliation,
	getReportsExportsSubscribers,
	getReportsFinancials,
	getReportsInventory,
	getReportsReconciliation,
	getReportsSummary,
	getReportsTimeseries,
	getSales,
	getSalesId,
	getSalesIdTickets,
	getSettlements,
	getStaff,
	getTicketsTicketCodeAccess,
	getTicketTypes,
	getTicketTypesId,
	getVenues,
	getVenuesId,
	getWebhooks,
} from "../client/sdk.gen";
import { uiTool } from "../ui";
import { makeWorkspaceResolver, runWorkspaceList } from "../workspaces";

const paging = {
	limit: z.string().optional().describe("Resultados por página (1-100)"),
	cursor: z.string().optional().describe("Cursor de paginación"),
};
const id = z.string().describe("Id del recurso");

/** Enums del contrato — el cliente generado ya no acepta un string suelto. */
const eventStatus = z
	.enum(["DRAFT", "PUBLISHED", "SOLD_OUT", "CANCELLED", "COMPLETED"])
	.describe("Estado del evento");
const saleStatus = z
	.enum(["PENDING", "CONFIRMED", "ABANDONED", "CANCELLED", "REFUNDED"])
	.describe("Estado de la venta");

/**
 * Modo global (brecha #3): opcional en los tools de lectura con listado.
 * Ausente = comportamiento actual (solo el workspace activo de la sesión).
 * "all" o una lista de ids agrega varios workspaces — cada fila queda
 * etiquetada con workspaceId/workspaceName. El conjunto de ids válidos sale
 * siempre de GET /me, nunca de lo que pida el cliente sin validar.
 */
const workspaceParam = z
	.union([z.literal("all"), z.array(z.string())])
	.optional()
	.describe(
		'Modo global: "all" agrega todos los workspaces accesibles de la sesión, ' +
			"o una lista de ids agrega solo esos. Ausente = solo el workspace activo " +
			"(comportamiento actual). Cada fila del resultado queda etiquetada con " +
			"workspaceId/workspaceName.",
	);

/**
 * Descargas de liquidación: la API responde **302** hacia una URL firmada con
 * TTL de 5 minutos. Seguir la redirección traería el PDF entero al contexto del
 * modelo, así que se corta en el 302 y se devuelve el link para que lo abra
 * quien corresponda. Por eso va con fetch crudo y no con el cliente generado.
 */
async function signedDownload(
	creds: Creds,
	path: string,
): Promise<{
	content: { type: "text"; text: string }[];
	isError?: boolean;
}> {
	const res = await fetch(`${creds.apiUrl}/api/v1${path}`, {
		redirect: "manual",
		headers: {
			Authorization: `Bearer ${creds.apiKey}`,
			...(creds.workspaceId ? { "X-Workspace-Id": creds.workspaceId } : {}),
		},
	});
	const url = res.headers.get("location");
	if (!url)
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `La API no devolvió la URL firmada (HTTP ${res.status}): ${await res.text()}`,
				},
			],
		};
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({ url, expiresInMinutes: 5 }, null, 2),
			},
		],
	};
}

/**
 * Ola A: todos los reads del contrato B2B /api/v1 (un tool = un operationId).
 * Writes (create/update/delete/publish/checkin/refund…) = Ola B, sin modo
 * global: siguen siendo de un solo workspace, explícito.
 *
 * Los listados y reportes se registran con `uiTool`: además del JSON traen el
 * view de MCP Apps (src/ui.ts), que el host renderiza como tabla o KPIs. Un
 * host sin la extensión ignora `_meta` y ve el mismo texto de siempre.
 */
export function registerB2bTools(
	server: McpServer,
	client: Client,
	creds: Creds,
): void {
	const ctx = {
		client,
		creds,
		resolveWorkspaces: makeWorkspaceResolver(client),
	};

	server.tool(
		"whoami",
		"Usuario y workspaces de la sesión configurada (GET /me).",
		async () => run(getMe({ client })),
	);

	uiTool(
		server,
		"events_list",
		"Lista los eventos del workspace (GET /events). `status` filtra en la " +
			"consulta (así `limit` cuenta solo filas devueltas) y `withTotal` agrega " +
			"`page.total`. `workspace` activa el modo global.",
		{
			...paging,
			q: z.string().optional().describe("Búsqueda por nombre/descripción"),
			status: eventStatus.optional(),
			withTotal: z
				.boolean()
				.optional()
				.describe("Incluir page.total (cuenta extra, opt-in)"),
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getEvents({ query: q, client: c }),
			),
	);
	server.tool(
		"events_get",
		"Detalle de un evento (GET /events/{id}).",
		{ id },
		async ({ id }) => run(getEventsId({ path: { id }, client })),
	);
	uiTool(
		server,
		"event_dates_list",
		"Fechas/funciones de un evento (GET /events/{id}/dates).",
		{ eventId: z.string().describe("Id del evento") },
		async ({ eventId }) =>
			run(getEventsIdDates({ path: { id: eventId }, client })),
	);

	uiTool(
		server,
		"ticket_types_list",
		"Tipos de ticket (GET /ticket-types). `workspace` activa el modo global.",
		{
			eventDateId: z
				.string()
				.optional()
				.describe("Filtrar por fecha de evento"),
			...paging,
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getTicketTypes({ query: q, client: c }),
			),
	);
	server.tool(
		"ticket_types_get",
		"Detalle de un tipo de ticket (GET /ticket-types/{id}).",
		{ id },
		async ({ id }) => run(getTicketTypesId({ path: { id }, client })),
	);

	uiTool(
		server,
		"sales_list",
		"Lista ventas con filtros (GET /sales). `workspace` activa el modo global.",
		{
			status: z.string().optional().describe("Filtrar por estado"),
			channel: z.string().optional().describe("Canal de venta"),
			event: z.string().optional().describe("Filtrar por evento"),
			eventDate: z.string().optional().describe("Filtrar por fecha de evento"),
			reference: z.string().optional().describe("Buscar por referencia"),
			buyer: z
				.string()
				.optional()
				.describe("Buscar por comprador (nombre/email)"),
			from: z.string().optional().describe("Creadas desde (ISO 8601)"),
			to: z.string().optional().describe("Creadas hasta (ISO 8601)"),
			...paging,
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getSales({ query: q, client: c }),
			),
	);
	server.tool(
		"sales_get",
		"Detalle de una venta (GET /sales/{id}).",
		{ id },
		async ({ id }) => run(getSalesId({ path: { id }, client })),
	);
	server.tool(
		"sales_tickets",
		"Tickets/asistentes individuales de una venta (GET /sales/{id}/tickets).",
		{ id: z.string().describe("Id de la venta") },
		async ({ id }) => run(getSalesIdTickets({ path: { id }, client })),
	);
	server.tool(
		"tickets_access",
		"Estado de acceso de un ticket por su código QR — no admite, solo consulta (GET /tickets/{code}/access).",
		{ code: z.string().describe("Código QR del ticket") },
		async ({ code }) =>
			run(getTicketsTicketCodeAccess({ path: { ticketCode: code }, client })),
	);

	uiTool(
		server,
		"plans_list",
		"Planes de membresía (GET /membership-plans). `workspace` activa el modo global.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getMembershipPlans({ query: q, client: c }),
			),
	);
	server.tool(
		"plans_get",
		"Detalle de un plan de membresía (GET /membership-plans/{id}).",
		{ id },
		async ({ id }) => run(getMembershipPlansId({ path: { id }, client })),
	);
	server.tool(
		"plans_subscribers",
		"Suscriptores/miembros de un plan (GET /membership-plans/{id}/subscribers).",
		{ id: z.string().describe("Id del plan") },
		async ({ id }) =>
			run(getMembershipPlansIdSubscribers({ path: { id }, client })),
	);

	uiTool(
		server,
		"discounts_list",
		"Cupones/descuentos del workspace (GET /discounts). `workspace` activa el modo global.",
		{
			event: z.string().optional().describe("Filtrar por evento"),
			active: z.string().optional().describe("true | false"),
			...paging,
			workspace: workspaceParam,
		},
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getDiscounts({ query: q, client: c }),
			),
	);
	uiTool(
		server,
		"webhooks_list",
		"Webhooks registrados (GET /webhooks). `workspace` activa el modo global.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getWebhooks({ query: q, client: c }),
			),
	);

	uiTool(
		server,
		"venues_list",
		"Venues del workspace (GET /venues). `workspace` activa el modo global.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getVenues({ query: q, client: c }),
			),
	);
	server.tool(
		"venues_get",
		"Detalle de un venue (GET /venues/{id}).",
		{ id },
		async ({ id }) => run(getVenuesId({ path: { id }, client })),
	);
	uiTool(
		server,
		"staff_list",
		"Staff del workspace (GET /staff). `workspace` activa el modo global: a " +
			"diferencia del resto, acá lo resuelve el contrato con `workspaceIds` " +
			"(una sola llamada, filas etiquetadas por el backend), no un fan-out.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) => {
			if (!workspace) return run(getStaff({ query: q, client }));
			const ids =
				workspace === "all"
					? (await ctx.resolveWorkspaces()).map((w) => w.id)
					: workspace;
			return run(
				getStaff({
					query: { ...q, workspaceIds: ids.slice(0, 25).join(",") },
					client,
				}),
			);
		},
	);

	uiTool(
		server,
		"reports_summary",
		"KPIs del workspace (GET /reports/summary).",
		{ period: z.enum(["7d", "30d", "90d", "1y"]).optional() },
		async (q) => run(getReportsSummary({ query: q, client })),
	);
	uiTool(
		server,
		"reports_by_event",
		"Revenue / tickets vendidos / disponibilidad por evento (GET /reports/by-event).",
		{
			from: z.string().optional().describe("Desde (ISO 8601)"),
			to: z.string().optional().describe("Hasta (ISO 8601)"),
			status: z.string().optional().describe("Filtrar por estado de venta"),
		},
		async (q) => run(getReportsByEvent({ query: q, client })),
	);
	uiTool(
		server,
		"reports_timeseries",
		"Serie temporal de revenue/tickets (GET /reports/timeseries).",
		{
			interval: z.enum(["day", "week", "month"]),
			from: z.string().optional(),
			to: z.string().optional(),
			event: z.string().optional().describe("Filtrar por evento"),
		},
		async (q) => run(getReportsTimeseries({ query: q, client })),
	);
	uiTool(
		server,
		"reports_inventory",
		"Capacidad / vendido / reservado / disponible por evento·fecha·tipo (GET /reports/inventory).",
		{
			eventId: z.string().optional(),
			eventDateId: z.string().optional(),
			from: z.string().optional(),
			to: z.string().optional(),
			includeDrafts: z
				.string()
				.optional()
				.describe("true | false — incluir borradores"),
			groupBy: z.enum(["ticketType", "date", "event"]).optional(),
		},
		async (q) => run(getReportsInventory({ query: q, client })),
	);
	uiTool(
		server,
		"reconciliation",
		"Conciliación financiera para el CFO: cruza cada venta con su transacción de " +
			"Mercado Pago y su factura de Siigo, marcando descuadres (GET /reports/reconciliation). " +
			"match_status: OK | MISSING_INVOICE | MISSING_CUFE | AMOUNT_MISMATCH | MISSING_PAYMENT.",
		{
			date_from: z.string().describe("Inicio del rango (ISO 8601)"),
			date_to: z.string().describe("Fin del rango (ISO 8601)"),
			match_status: z
				.enum([
					"OK",
					"MISSING_INVOICE",
					"MISSING_CUFE",
					"AMOUNT_MISMATCH",
					"MISSING_PAYMENT",
				])
				.optional(),
			provider: z.string().optional().describe("Proveedor de pago"),
			page: z.string().optional(),
			page_size: z.string().optional(),
		},
		async (q) => run(getReportsReconciliation({ query: q, client })),
	);

	const exportFilters = {
		event: z.string().optional(),
		eventDate: z.string().optional(),
		from: z.string().optional(),
		to: z.string().optional(),
		status: saleStatus.optional(),
	};
	uiTool(
		server,
		"settlements_list",
		"Liquidaciones del workspace — lo que FreeTicket le paga al organizador, " +
			"con monto, estado y evento/función (GET /settlements). Trae hasDocument " +
			"y el nombre de los archivos; el PDF se baja con `settlements_document`.",
		{
			event: z.string().optional().describe("Filtrar por evento"),
			status: z
				.enum(["SENT", "AWAITING_PAYMENT", "PAID"])
				.optional()
				.describe("Estado de la liquidación"),
			...paging,
		},
		async (q) => run(getSettlements({ query: q, client })),
	);
	// getSettlementsIdDocument / getSettlementsIdProofsFileName: no usan el
	// cliente generado (son 302 a URL firmada), pero acá quedan nombrados para
	// que el barrido de coverage.test.ts los cuente como cubiertos.
	server.tool(
		"settlements_document",
		"Link de descarga del PDF de una liquidación (GET /settlements/{id}/document). " +
			"Devuelve una URL firmada que vence en 5 minutos — no el archivo.",
		{ id },
		async ({ id }) => signedDownload(creds, `/settlements/${id}/document`),
	);
	server.tool(
		"settlements_proof",
		"Link de descarga de un comprobante de pago de la liquidación " +
			"(GET /settlements/{id}/proofs/{fileName}). El nombre del archivo sale " +
			"de `settlements_list`. URL firmada, vence en 5 minutos.",
		{
			id,
			fileName: z
				.string()
				.describe("Nombre del archivo, tal cual lo lista la liquidación"),
		},
		async ({ id, fileName }) =>
			signedDownload(
				creds,
				`/settlements/${id}/proofs/${encodeURIComponent(fileName)}`,
			),
	);
	uiTool(
		server,
		"reports_financials",
		"Estado financiero por función: bruto, cargo de plataforma, valor facial, " +
			"comisión de pasarela, 4x1000 y neto a liquidar, más el estado de la " +
			"liquidación asociada (GET /reports/financials). Son los números " +
			"autoritativos del panel de Liquidaciones — no hay que recalcularlos " +
			"cruzando /sales con Mercado Pago.",
		{
			event: z.string().optional().describe("Filtrar por evento"),
			past: z
				.enum(["true", "false"])
				.optional()
				.describe("true = solo funciones ya ocurridas (liquidables)"),
		},
		async (q) => run(getReportsFinancials({ query: q, client })),
	);
	uiTool(
		server,
		"api_keys_list",
		"API keys de servicio del usuario — para auditar qué credenciales existen " +
			"y cuándo se usaron (GET /api-keys). Nunca devuelve el secreto. " +
			"Acuñar y revocar keys se hace con el CLI (`ft api-keys`), no desde acá: " +
			"un agente no debería poder mintear credenciales.",
		{ ...paging },
		async (q) => run(getApiKeys({ query: q, client })),
	);

	// ── SSO headless (integraciones enterprise) ──────────────────────────────
	// Estos dos hablan en nombre de un comprador, no del workspace: exigen una
	// API key de servicio enterprise Y el session token que devolvió el canje
	// (POST /api/customer-auth/enterprise-exchange). El canje NO se expone como
	// tool: mintea sesiones de terceros — misma política que api_keys/admin
	// tokens. Con una key normal, la API responde 403 y el agente lo ve.
	const customerSession = z
		.string()
		.describe(
			"Session token del comprador (header X-Customer-Session), obtenido en el " +
				"canje del SSO headless. Sin él la API responde 401.",
		);
	server.tool(
		"customer_me",
		"Identidad del comprador autenticado por SSO headless (GET /customer/me). " +
			"Requiere API key de servicio enterprise + session token del comprador.",
		{ customerSession },
		async ({ customerSession }) =>
			run(
				getCustomerMe({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	uiTool(
		server,
		"customer_tickets",
		"Entradas del comprador dentro del alcance de la key (GET /customer/tickets). " +
			"Solo ventas CONFIRMED de eventos que el workspace pineado puede leer. " +
			"Requiere API key de servicio enterprise + session token del comprador.",
		{ customerSession, ...paging },
		async ({ customerSession, ...q }) =>
			run(
				getCustomerTickets({
					query: q,
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);

	server.tool(
		"reports_export_buyers",
		"Export de compradores — una fila por venta (GET /reports/exports/buyers).",
		exportFilters,
		async (q) => run(getReportsExportsBuyers({ query: q, client })),
	);
	server.tool(
		"reports_export_attendees",
		"Export de asistentes — una fila por ticket (GET /reports/exports/attendees).",
		exportFilters,
		async (q) => run(getReportsExportsAttendees({ query: q, client })),
	);
	server.tool(
		"reports_export_subscribers",
		"Export de suscriptores (GET /reports/exports/subscribers).",
		async () => run(getReportsExportsSubscribers({ client })),
	);
	server.tool(
		"reports_export_reconciliation",
		"Export de conciliación para contabilidad (GET /reports/exports/reconciliation).",
		{
			date_from: z.string(),
			date_to: z.string(),
			match_status: z
				.enum([
					"OK",
					"MISSING_INVOICE",
					"MISSING_CUFE",
					"AMOUNT_MISMATCH",
					"MISSING_PAYMENT",
				])
				.optional(),
			provider: z.string().optional(),
		},
		async (q) => run(getReportsExportsReconciliation({ query: q, client })),
	);

	// ── Área de socios (contrato 1.7.0) ──────────────────────────────────────
	// Misma credencial doble que customer_me: API key enterprise + sesión del
	// comprador. Con estos el agente ya cubre el área de socios del sitio:
	// entradas, membresía y perfil.
	server.tool(
		"customer_ticket_get",
		"Detalle de una entrada del comprador — deep link desde el listado " +
			"(GET /customer/tickets/{id}).",
		{ id, customerSession },
		async ({ id, customerSession }) =>
			run(
				getCustomerTicketsId({
					path: { id },
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	uiTool(
		server,
		"customer_membership",
		"Estado de membresía del comprador en el workspace de la key: plan, " +
			"vigencia y si puede ver contenido de socios (GET /customer/membership).",
		{ customerSession },
		async ({ customerSession }) =>
			run(
				getCustomerMembership({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);
	server.tool(
		"customer_profile",
		"Perfil del comprador — nombre y teléfono (GET /customer/profile).",
		{ customerSession },
		async ({ customerSession }) =>
			run(
				getCustomerProfile({
					headers: { "X-Customer-Session": customerSession },
					client,
				}),
			),
	);

	// ── Contenido de la organización (contrato 1.7.0) ────────────────────────
	// Videos, feed y transmisiones publicados. Los listados NO traen el playback
	// id: para reproducir hay que pedir un token con `content_playback_token`.
	uiTool(
		server,
		"content_videos",
		"Videos publicados y listos (READY) de la organización (GET /content/videos). " +
			"Para reproducir uno, pedir token con `content_playback_token`.",
		{ ...paging },
		async (q) => run(getContentVideos({ query: q, client })),
	);
	uiTool(
		server,
		"content_posts",
		"Feed de comunidad de la organización (GET /content/posts).",
		{ ...paging },
		async (q) => run(getContentPosts({ query: q, client })),
	);
	uiTool(
		server,
		"content_lives",
		"Transmisiones en vivo de la organización, con su estado (GET /content/lives).",
		{ ...paging },
		async (q) => run(getContentLives({ query: q, client })),
	);
	server.tool(
		"content_live_get",
		"Estado de una transmisión puntual (GET /content/lives/{id}).",
		{ id },
		async ({ id }) => run(getContentLivesId({ path: { id }, client })),
	);
}
