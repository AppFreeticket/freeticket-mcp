import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Creds, run } from "../api";
import {
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
	getReportsInventory,
	getReportsReconciliation,
	getReportsSummary,
	getReportsTimeseries,
	getSales,
	getSalesId,
	getSalesIdTickets,
	getStaff,
	getTicketsTicketCodeAccess,
	getTicketTypes,
	getTicketTypesId,
	getVenues,
	getVenuesId,
	getWebhooks,
} from "../client/sdk.gen";
import { makeWorkspaceResolver, runWorkspaceList } from "../workspaces";

const paging = {
	limit: z.string().optional().describe("Resultados por página (1-100)"),
	cursor: z.string().optional().describe("Cursor de paginación"),
};
const id = z.string().describe("Id del recurso");

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
 * Ola A: todos los reads del contrato B2B /api/v1 (un tool = un operationId).
 * Writes (create/update/delete/publish/checkin/refund…) = Ola B, sin modo
 * global: siguen siendo de un solo workspace, explícito.
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

	server.tool(
		"events_list",
		"Lista los eventos del workspace (GET /events). `workspace` activa el modo global.",
		{ ...paging, workspace: workspaceParam },
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
	server.tool(
		"event_dates_list",
		"Fechas/funciones de un evento (GET /events/{id}/dates).",
		{ eventId: z.string().describe("Id del evento") },
		async ({ eventId }) =>
			run(getEventsIdDates({ path: { id: eventId }, client })),
	);

	server.tool(
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

	server.tool(
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

	server.tool(
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

	server.tool(
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
	server.tool(
		"webhooks_list",
		"Webhooks registrados (GET /webhooks). `workspace` activa el modo global.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getWebhooks({ query: q, client: c }),
			),
	);

	server.tool(
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
	server.tool(
		"staff_list",
		"Staff del workspace (GET /staff). `workspace` activa el modo global.",
		{ ...paging, workspace: workspaceParam },
		async ({ workspace, ...q }) =>
			runWorkspaceList(ctx, workspace, (c) =>
				getStaff({ query: q, client: c }),
			),
	);

	server.tool(
		"reports_summary",
		"KPIs del workspace (GET /reports/summary).",
		{ period: z.enum(["7d", "30d", "90d", "1y"]).optional() },
		async (q) => run(getReportsSummary({ query: q, client })),
	);
	server.tool(
		"reports_by_event",
		"Revenue / tickets vendidos / disponibilidad por evento (GET /reports/by-event).",
		{
			from: z.string().optional().describe("Desde (ISO 8601)"),
			to: z.string().optional().describe("Hasta (ISO 8601)"),
			status: z.string().optional().describe("Filtrar por estado de venta"),
		},
		async (q) => run(getReportsByEvent({ query: q, client })),
	);
	server.tool(
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
	server.tool(
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
	server.tool(
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
		status: z.string().optional(),
	};
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
			match_status: z.string().optional(),
			provider: z.string().optional(),
		},
		async (q) => run(getReportsExportsReconciliation({ query: q, client })),
	);
}
