import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Client, createClient, createConfig } from "@hey-api/client-fetch";

/**
 * Credentials for one session. Over stdio they come from env and config; over
 * remote HTTP they come from the request (never from disk) — which is why the
 * clients are built per session and
 * no hay singleton global compartido entre tenants.
 */
export interface Creds {
	apiUrl: string;
	// Absent = anonymous session: the public B2C tools only (public_*). With a
	// key the B2B tools are added; with an adminSession, the admin_* ones.
	apiKey?: string;
	workspaceId?: string;
	adminSession?: string;
	adminApiUrl?: string;
}

/**
 * Config shared with the `ft` CLI: env > ~/.freeticket/config.json > default.
 * That way `ft login` (the browser device flow) also authenticates the MCP over
 * stdio.
 */
function cliConfig(): {
	apiUrl?: string;
	apiKey?: string;
	workspaceId?: string;
} {
	try {
		return JSON.parse(
			readFileSync(join(homedir(), ".freeticket", "config.json"), "utf8"),
		);
	} catch {
		return {};
	}
}

/** Normalizes the base: accepts FT_API_URL with or without /api/v1 (older versions). */
export function normalizeApiUrl(raw: string): string {
	return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

/**
 * Credentials for the stdio entrypoint (local). It always returns something:
 * without FT_API_KEY the server starts in anonymous mode (public B2C tools only).
 */
export function credsFromEnv(): Creds {
	const stored = cliConfig();
	return {
		apiUrl: normalizeApiUrl(
			process.env.FT_API_URL ??
				stored.apiUrl ??
				"https://admin.appfreeticket.com",
		),
		apiKey: process.env.FT_API_KEY ?? stored.apiKey,
		workspaceId: process.env.FT_WORKSPACE_ID ?? stored.workspaceId,
		adminSession: process.env.FT_ADMIN_SESSION,
		adminApiUrl: process.env.FT_ADMIN_API_URL,
	};
}

/** Isolated B2B client for one session (Bearer + workspace). */
export function makeB2bClient(c: Creds): Client {
	return createClient(
		createConfig({
			baseUrl: `${c.apiUrl}/api/v1`,
			headers: {
				Authorization: `Bearer ${c.apiKey}`,
				...(c.workspaceId ? { "X-Workspace-Id": c.workspaceId } : {}),
			},
		}),
	);
}

/** Isolated public B2C client (no auth). Catalogue plus anonymous checkout. */
export function makePublicClient(apiUrl: string): Client {
	return createClient(createConfig({ baseUrl: `${apiUrl}/api/public` }));
}

/** Isolated superadmin client (SUPER_ADMIN session cookie). It never shares auth. */
export function makeAdminClient(c: Creds): Client {
	return createClient(
		createConfig({
			baseUrl: c.adminApiUrl ?? `${c.apiUrl}/api/admin`,
			headers: { Cookie: `better-auth.session_token=${c.adminSession}` },
		}),
	);
}

type SdkResult = { data?: unknown; error?: unknown };

/**
 * An MCP result from a generated SDK call: the envelope's data, or its error.
 *
 * It always carries `structuredContent` alongside the text: that is what the
 * MCP Apps view (src/ui.ts) consumes to draw the table or the KPIs. It is
 * wrapped in `{ data }` because the spec requires structuredContent to be an
 * object, and a list returns an array. The text stays the same for hosts
 * without the UI extension.
 */
export async function run(p: Promise<SdkResult>): Promise<{
	content: { type: "text"; text: string }[];
	structuredContent?: { data: unknown };
	isError?: boolean;
}> {
	// @hey-api/client-fetch only populates `r.error` when there WAS an HTTP
	// response. A transport failure (DNS, timeout, TLS, abort) rejects the
	// promise, and without this catch the MCP SDK's generic catch took it: plain
	// text, no code, no structuredContent. The agent saw two different shapes
	// for the same thing and could not branch on a code (issue #12).
	let r: SdkResult;
	try {
		r = await p;
	} catch (e) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							error: {
								code: "network_error",
								message: e instanceof Error ? e.message : String(e),
								retryable: true,
							},
						},
						null,
						2,
					),
				},
			],
		};
	}
	if (r.error !== undefined) {
		return {
			isError: true,
			content: [{ type: "text", text: JSON.stringify(r.error, null, 2) }],
		};
	}
	return {
		content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }],
		structuredContent: { data: unwrapEnvelope(r.data) },
	};
}

/** `{ data, page }` → `data`. The view wants the rows, not the envelope. */
function unwrapEnvelope(d: unknown): unknown {
	if (d && typeof d === "object" && "data" in d)
		return (d as { data: unknown }).data;
	return d;
}
