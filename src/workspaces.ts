import type { Client } from "@hey-api/client-fetch";
import { type Creds, makeB2bClient, run } from "./api";
import { getMe } from "./client/sdk.gen";
import type { WorkspaceAccess } from "./client/types.gen";

/**
 * Modo global de workspaces (brecha #3): fan-out en el cliente, no agregación
 * en el servidor. Los tools de lectura que devuelven listas aceptan un
 * parámetro opcional `workspace` — ausente = comportamiento actual (un solo
 * workspace, el de la sesión). El conjunto de workspaces sale SIEMPRE de
 * GET /me, nunca de ids que pida el cliente sin validar contra esa lista.
 * Las escrituras no tienen este parámetro: siguen siendo de un workspace
 * explícito.
 */

/** Límite de requests en paralelo por fan-out — no satura la API. */
const FAN_OUT_CONCURRENCY = 5;

/** Fila agregada: el dato tal cual + de qué workspace salió. */
export type WorkspaceRow<T> = T & {
	workspaceId: string;
	workspaceName: string;
};

/** Error de un workspace puntual dentro de un fan-out — no tumba al resto. */
export interface WorkspaceFanOutError {
	workspaceId: string;
	workspaceName: string;
	error: unknown;
}

export interface WorkspaceFanOutResult<T> {
	rows: WorkspaceRow<T>[];
	errors: WorkspaceFanOutError[];
}

/** Forma común de los tools de lectura con listado: `{ data: T[], page }`. */
type ListFn<T> = (
	client: Client,
) => Promise<{ data?: { data: T[] }; error?: unknown }>;

/**
 * Resuelve los workspaces accesibles de la sesión (GET /me) y los cachea en
 * memoria: un fan-out de varios tools no debe pegarle a /me una vez por tool.
 * La cache vive en el closure devuelto — una por sesión (ver registerB2bTools),
 * nunca compartida entre tenants.
 */
export function makeWorkspaceResolver(
	client: Client,
): () => Promise<WorkspaceAccess[]> {
	let cached: Promise<WorkspaceAccess[]> | null = null;
	return () => {
		if (!cached) {
			cached = getMe({ client })
				.then((r) =>
					r.error !== undefined || !r.data ? [] : r.data.data.workspaces,
				)
				.catch(() => []);
		}
		return cached;
	};
}

/**
 * Valida el parámetro `workspace` del tool contra los workspaces accesibles
 * de la sesión. `undefined` → null (sin fan-out, se usa el client de sesión
 * tal cual hoy). `"all"` → todos los accesibles. Lista de ids → solo los que
 * están en esa lista Y son accesibles; los que no, se descartan en silencio.
 */
export async function resolveWorkspaceTargets(
	resolveWorkspaces: () => Promise<WorkspaceAccess[]>,
	workspace: string | string[] | undefined,
): Promise<WorkspaceAccess[] | null> {
	if (workspace === undefined) return null;
	// `sections: []` = acceso vencido o revocado en ese workspace (contrato
	// 1.7.0). Antes se descubría a fuerza de 403 dentro del fan-out; ahora el
	// target ni se dispara. `null` = sin acotar, se incluye.
	const accessible = (await resolveWorkspaces()).filter(
		(w) => w.sections === null || w.sections.length > 0,
	);
	if (workspace === "all") return accessible;
	const ids = new Set(workspace);
	return accessible.filter((w) => ids.has(w.id));
}

/**
 * Dispara `fn` contra cada workspace en `targets` con su propio client (misma
 * apiKey, distinto X-Workspace-Id) y agrega las filas devueltas etiquetadas
 * con el workspace de origen. Un workspace que falla (403/500/lo que sea) no
 * tumba a los demás: su error queda en `errors` y el resto se devuelve igual.
 */
export async function runAcrossWorkspaces<T>(
	creds: Creds,
	targets: WorkspaceAccess[],
	fn: ListFn<T>,
): Promise<WorkspaceFanOutResult<T>> {
	const rows: WorkspaceRow<T>[] = [];
	const errors: WorkspaceFanOutError[] = [];
	let cursor = 0;

	async function worker(): Promise<void> {
		while (cursor < targets.length) {
			const ws = targets[cursor++];
			try {
				const r = await fn(makeB2bClient({ ...creds, workspaceId: ws.id }));
				if (r.error !== undefined) {
					errors.push({
						workspaceId: ws.id,
						workspaceName: ws.name,
						error: r.error,
					});
					continue;
				}
				for (const item of r.data?.data ?? []) {
					rows.push({ ...item, workspaceId: ws.id, workspaceName: ws.name });
				}
			} catch (error) {
				errors.push({
					workspaceId: ws.id,
					workspaceName: ws.name,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(FAN_OUT_CONCURRENCY, targets.length) },
			worker,
		),
	);
	return { rows, errors };
}

/** Mismo shape de respuesta que `run()` (api.ts), pero para un fan-out ya resuelto. */
function fanOutContent<T>(result: WorkspaceFanOutResult<T>): {
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown };
	isError?: boolean;
} {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{ data: result.rows, errors: result.errors },
					null,
					2,
				),
			},
		],
		// Las filas agregadas alimentan el view de MCP Apps igual que un listado
		// de un solo workspace; los errores parciales viven solo en el texto.
		structuredContent: { data: result.rows },
		isError: result.rows.length === 0 && result.errors.length > 0,
	};
}

/** Contexto de sesión que necesita un tool de lectura para soportar modo global. */
export interface WorkspaceListContext {
	client: Client;
	creds: Creds;
	resolveWorkspaces: () => Promise<WorkspaceAccess[]>;
}

/**
 * Entry point que usan los tools de lectura con listado. Sin `workspace`,
 * llama una sola vez con el client de sesión (comportamiento actual, sin
 * request extra a /me). Con `workspace`, resuelve targets contra /me y hace
 * fan-out agregando y etiquetando las filas.
 */
export async function runWorkspaceList<T>(
	ctx: WorkspaceListContext,
	workspace: string | string[] | undefined,
	fn: ListFn<T>,
): Promise<{
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown };
	isError?: boolean;
}> {
	const targets = await resolveWorkspaceTargets(
		ctx.resolveWorkspaces,
		workspace,
	);
	if (!targets) return run(fn(ctx.client));
	return fanOutContent(await runAcrossWorkspaces(ctx.creds, targets, fn));
}
