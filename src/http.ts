#!/usr/bin/env node
/**
 * Standalone entrypoint for the remote FreeTicket MCP (Streamable HTTP).
 * All the logic lives in src/handler.ts — shared with the Vercel Function
 * (api/server.ts). Env: PORT (default 3333) plus everything handler.ts reads.
 */
import { createServer } from "node:http";
import { handleHttp } from "./handler";

const PORT = Number(process.env.PORT ?? 3333);

createServer(handleHttp).listen(PORT, () => {
	process.stderr.write(
		`FreeTicket MCP HTTP en :${PORT} (POST /mcp · POST /mcp/public · OAuth: /authorize /token /register)\n`,
	);
});
