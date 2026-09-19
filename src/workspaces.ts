import type { Client } from "@hey-api/client-fetch";
import { type Creds, makeB2bClient, run } from "./api";
import { getMe } from "./client/sdk.gen";
import type { WorkspaceAccess } from "./client/types.gen";

/**
 * Global workspace mode (gap #3): a fan-out in the client, not aggregation in
 * the server. **Every workspace the credential reaches is the default**: a
 * session is not pinned to one tenant unless somebody pinned it on purpose
 * (`X-Workspace-Id`, `FT_WORKSPACE_ID`, or the workspace field of the manual
 * consent form). The read tools that list still accept `workspace` to narrow
 * it back down to a subset, or to one, which is what deep pagination needs.
 *
 * The set of workspaces ALWAYS comes from GET /me, never from ids the client
 * asks for without validating against that list. Writes do not take this
 * parameter: with no pin they land on the account's default workspace, which
 * is what the contract does when the header is absent.
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

/**
 * The common shape of the listing read tools: `{ data: T[], page }`. It gets
 * the limit already resolved for the call it is about to make — the caller
 * must not read it off its own closure, or the split below does nothing.
 */
type ListFn<T> = (
	client: Client,
	limit: string | undefined,
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
	limit?: string,
): Promise<WorkspaceFanOutResult<T>> {
	const rows: WorkspaceRow<T>[] = [];
	const errors: WorkspaceFanOutError[] = [];
	let cursor = 0;

	async function worker(): Promise<void> {
		while (cursor < targets.length) {
			const ws = targets[cursor++];
			try {
				const r = await fn(
					makeB2bClient({ ...creds, workspaceId: ws.id }),
					limit,
				);
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
 * Spreads the caller's `limit` across the workspaces about to be queried, so a
 * fan-out returns roughly what the agent asked for instead of `limit` rows per
 * tenant. It rounds up (nobody gets a limit of 0) and the surplus is trimmed
 * off the aggregate afterwards. A `limit` the contract would reject is passed
 * through untouched — that 422 belongs to the API, not to this function.
 */
export function splitLimit(
	limit: string | undefined,
	targets: number,
): string | undefined {
	if (limit === undefined || targets <= 1) return limit;
	const n = Number(limit);
	if (!Number.isFinite(n) || n <= 0) return limit;
	return String(Math.max(1, Math.ceil(n / targets)));
}

/**
 * The entry point the listing read tools use.
 *
 * `workspace` absent is **not** "one workspace" any more: an unpinned session
 * reads every workspace its credential reaches, because that is what somebody
 * who just logged in expects to see. It narrows back down in three ways, and
 * only then does the single-workspace path run (the one that still carries
 * `page`, so deep pagination needs one of them):
 *
 * - the tool is called with `workspace: [id]`;
 * - the session is pinned (`X-Workspace-Id`, `FT_WORKSPACE_ID`, consent form);
 * - the credential only reaches one workspace anyway.
 *
 * A fan-out answers `{ data, errors }` and no `page`: there is no single
 * cursor that means anything across tenants. That is a property of the
 * fan-out, not an oversight — see the tool descriptions.
 */
export async function runWorkspaceList<T>(
	ctx: WorkspaceListContext,
	workspace: string | string[] | undefined,
	limit: string | undefined,
	fn: ListFn<T>,
): Promise<{
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown };
	isError?: boolean;
}> {
	// An explicitly pinned session keeps meaning one workspace: whoever set the
	// header asked for that tenant and nothing else.
	const requested = workspace ?? (ctx.creds.workspaceId ? undefined : "all");
	const targets = await resolveWorkspaceTargets(
		ctx.resolveWorkspaces,
		requested,
	);
	// Pinned session, or a tool that takes no `workspace`: nothing to fan out.
	if (!targets) return run(fn(ctx.client, limit));
	// The implicit default is the only branch allowed to collapse back to the
	// single-workspace path. It does so when there is nothing to aggregate —
	// one reachable workspace, or none because /me could not answer (it
	// swallows its own errors, and an unreachable /me must not read as "you
	// have no data"). An *explicit* `workspace` keeps fan-out semantics even
	// for one id, so unresolved ids still travel back as errors (#13).
	if (workspace === undefined && targets.length <= 1) {
		const only = targets[0];
		return run(
			fn(
				only
					? makeB2bClient({ ...ctx.creds, workspaceId: only.id })
					: ctx.client,
				limit,
			),
		);
	}
	// The requested ids resolveWorkspaceTargets filtered out as unreachable.
	const found = new Set(targets.map((t) => t.id));
	const unresolved = Array.isArray(workspace)
		? workspace.filter((id) => !found.has(id))
		: [];
	const result = await runAcrossWorkspaces(
		ctx.creds,
		targets,
		fn,
		splitLimit(limit, targets.length),
	);
	// Rounding up gives each workspace at least one row, so the aggregate can
	// overshoot what was asked for. Trim it back.
	const max = Number(limit);
	if (Number.isFinite(max) && max > 0 && result.rows.length > max)
		result.rows = result.rows.slice(0, max);
	return fanOutContent(result, unresolved);
}
