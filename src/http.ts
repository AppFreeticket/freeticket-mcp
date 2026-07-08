#!/usr/bin/env node
/**
 * Entrypoint standalone del FreeTicket MCP remoto (Streamable HTTP).
 * Toda la lógica vive en src/handler.ts — compartida con la Vercel Function
 * (api/server.ts). Env: PORT (default 3333) + las de handler.ts.
 */
import { createServer } from "node:http";
import { handleHttp } from "./handler";

const PORT = Number(process.env.PORT ?? 3333);

createServer(handleHttp).listen(PORT, () => {
	process.stderr.write(
		`FreeTicket MCP HTTP en :${PORT} (POST /mcp · POST /mcp/public · OAuth: /authorize /token /register)\n`,
	);
});
