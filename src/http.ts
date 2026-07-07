#!/usr/bin/env node
/**
 * FreeTicket MCP server (Streamable HTTP remoto).
 *
 * El mismo dominio que el entrypoint stdio, pero servido por HTTP para que se
 * agregue como **connector por URL** (claude.ai → Settings → Connectors, Claude
 * Code remoto, curl). Stateless: un server + clients nuevos por request, con las
 * credenciales del propio request — nunca lee `~/.freeticket/config.json`, así el
 * mismo binario sirve a varios tenants sin cruzar sesiones.
 *
 * Auth (interim, funciona hoy): `Authorization: Bearer <FT_API_KEY>`, más los
 * headers opcionales `X-Workspace-Id` y `X-Admin-Session`.
 *
 * OAuth 2.1 (lo exige claude.ai para connectors con credenciales): exponemos la
 * Protected Resource Metadata (RFC 9728) apuntando al authorization server de
 * free-admin. Ese AS es la pieza backend pendiente (roadmap hito 4, 0.7.0).
 *
 * Env:
 *   PORT              puerto (default 3333)
 *   FT_API_URL        base de la API B2B/admin (default https://admin.appfreeticket.com)
 *   MCP_PUBLIC_URL    URL pública del endpoint /mcp (para el campo `resource`)
 *   FT_OAUTH_ISSUER   authorization server OAuth (default = FT_API_URL)
 */
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type Creds, normalizeApiUrl } from "./api";
import { buildServer } from "./server";

const PORT = Number(process.env.PORT ?? 3333);
const API_URL = normalizeApiUrl(
	process.env.FT_API_URL ?? "https://admin.appfreeticket.com",
);
const OAUTH_ISSUER = (process.env.FT_OAUTH_ISSUER ?? API_URL).replace(
	/\/$/,
	"",
);

/** Credenciales del request. Devuelve null si falta el Bearer (→ 401 + OAuth). */
function credsFromRequest(
	headers: Record<string, string | undefined>,
): Creds | null {
	const auth = headers.authorization ?? "";
	const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!apiKey) return null;
	return {
		apiUrl: API_URL,
		apiKey,
		workspaceId: headers["x-workspace-id"] || undefined,
		adminSession: headers["x-admin-session"] || undefined,
	};
}

/** RFC 9728: le dice al cliente OAuth dónde autorizar para este recurso. */
function protectedResourceMetadata(publicUrl: string) {
	return {
		resource: publicUrl,
		authorization_servers: [OAUTH_ISSUER],
		bearer_methods_supported: ["header"],
		scopes_supported: ["b2b", "admin"],
	};
}

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c as Buffer));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			if (!raw) return resolve(undefined);
			try {
				resolve(JSON.parse(raw));
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	const publicUrl =
		process.env.MCP_PUBLIC_URL ?? `${url.protocol}//${req.headers.host}/mcp`;
	const metadataPath = "/.well-known/oauth-protected-resource";

	// Discovery OAuth (RFC 9728) — sin auth, cache-friendly.
	if (req.method === "GET" && url.pathname === metadataPath) {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(protectedResourceMetadata(publicUrl)));
		return;
	}

	// Health check.
	if (req.method === "GET" && url.pathname === "/") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ name: "freeticket-mcp", status: "ok" }));
		return;
	}

	if (url.pathname !== "/mcp") {
		res.writeHead(404).end();
		return;
	}

	const creds = credsFromRequest(
		req.headers as Record<string, string | undefined>,
	);
	if (!creds) {
		// RFC 9728 §5.1: apuntá al metadata para que el cliente arranque OAuth.
		res.writeHead(401, {
			"content-type": "application/json",
			"www-authenticate": `Bearer resource_metadata="${url.protocol}//${req.headers.host}${metadataPath}"`,
		});
		res.end(
			JSON.stringify({ error: "unauthorized", message: "Falta Bearer token." }),
		);
		return;
	}

	// Stateless: server + transport nuevos por request, cerrados al terminar.
	const mcp = buildServer(creds);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	res.on("close", () => {
		transport.close();
		mcp.close();
	});
	try {
		await mcp.connect(transport);
		const body = req.method === "POST" ? await readBody(req) : undefined;
		await transport.handleRequest(req, res, body);
	} catch (err) {
		process.stderr.write(`MCP HTTP error: ${String(err)}\n`);
		if (!res.headersSent) res.writeHead(500).end();
	}
});

server.listen(PORT, () => {
	process.stderr.write(
		`FreeTicket MCP HTTP en :${PORT} (POST /mcp · GET ${"/.well-known/oauth-protected-resource"})\n`,
	);
});
