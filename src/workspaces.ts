import type { Client } from "@hey-api/client-fetch";
import { type Creds, makeB2bClient, run } from "./api";
import { getMe } from "./client/sdk.gen";
import type { WorkspaceAccess } from "./client/types.gen";

/**
 * Global workspace mode (gap #3): a fan-out in the client, not aggregation in
 * the server. The read tools that return lists accept an optional `workspace`
 * parameter — absent = current behaviour (one workspace, the session's). The
 * set of workspaces ALWAYS comes from GET /me, never from ids the client asks
 * for without validating against that list. Writes do not take this parameter:
 * they stay scoped to one explicit workspace.
 */

/** Cap on parallel requests per fan-out — it does not flood the API. */
const FAN_OUT_CONCURRENCY = 5;

/** An aggregated row: the datum as-is, plus which workspace it came from. */
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

/** The common shape of the listing read tools: `{ data: T[], page }`. */
type ListFn<T> = (
	client: Client,
) => Promise<{ data?: { data: T[] }; error?: unknown }>;

/**
 * Resolves the workspaces the session can reach (GET /me) and caches them in
 * memory: a fan-out across several tools must not hit /me once per tool. The
 * cache lives in the returned closure — one per session (see registerB2bTools),
 * never shared between tenants.
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
 * Validates the tool's `workspace` parameter against the workspaces the
 * session can reach. `undefined` → null (no fan-out, the session client is used
 * as it is today). `"all"` → every reachable one. A list of ids → only those in
 * that list AND reachable; the rest are dropped silently.
 */
export async function resolveWorkspaceTargets(
	resolveWorkspaces: () => Promise<WorkspaceAccess[]>,
	workspace: string | string[] | undefined,
): Promise<WorkspaceAccess[] | null> {
	if (workspace === undefined) return null;
	// `sections: []` = access expired or revoked in that workspace (contract
	// 1.7.0). It used to be discovered by collecting 403s inside the fan-out;
	// now the target never fires. `null` = unrestricted, so it is included.
	const accessible = (await resolveWorkspaces()).filter(
		(w) => w.sections === null || w.sections.length > 0,
	);
	if (workspace === "all") return accessible;
	const ids = new Set(workspace);
	return accessible.filter((w) => ids.has(w.id));
}

/**
 * Fires `fn` against every workspace in `targets` with its own client (same
 * apiKey, different X-Workspace-Id) and aggregates the returned rows, tagged
 * with the workspace they came from. A workspace that fails (403, 500, whatever)
 * does not take the others down: its error lands in `errors` and the rest is
 * returned regardless.
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

/** The same response shape as `run()` (api.ts), but for an already-resolved fan-out. */
function fanOutContent<T>(
	result: WorkspaceFanOutResult<T>,
	unresolved: string[] = [],
): {
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown };
	isError?: boolean;
} {
	// A requested id that is not among the reachable ones used to be dropped
	// silently: the agent got fewer rows with no way to tell "does not exist"
	// from "lost access" from "has no data" (issue #13). Now it travels as an error.
	const errors = [
		...result.errors,
		...unresolved.map((workspaceId) => ({
			workspaceId,
			workspaceName: "",
			error: {
				code: "workspace_not_accessible",
				message:
					"This id is not among the workspaces this credential reaches (or it does not exist). Check it with `whoami`.",
			},
		})),
	];
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({ data: result.rows, errors }, null, 2),
			},
		],
		// The aggregated rows feed the MCP Apps view exactly like a single-workspace
		// list; partial errors live only in the text.
		structuredContent: { data: result.rows },
		isError: result.rows.length === 0 && errors.length > 0,
	};
}

/** The session context a read tool needs in order to support global mode. */
export interface WorkspaceListContext {
	client: Client;
	creds: Creds;
	resolveWorkspaces: () => Promise<WorkspaceAccess[]>;
}

/**
 * The entry point the listing read tools use. Without `workspace`, it calls
 * once with the session client (current behaviour, no extra request to /me).
 * With `workspace`, it resolves targets against /me and fans out, aggregating
 * and tagging the rows.
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
	// The requested ids resolveWorkspaceTargets filtered out as unreachable.
	const found = new Set(targets.map((t) => t.id));
	const unresolved = Array.isArray(workspace)
		? workspace.filter((id) => !found.has(id))
		: [];
	return fanOutContent(
		await runAcrossWorkspaces(ctx.creds, targets, fn),
		unresolved,
	);
}
