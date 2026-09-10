/**
 * Vercel Function: all traffic (vercel.json rewrites it here) goes through the
 * same handler as the standalone server. It imports the tsup bundle (dist/)
 * rather than src/ directly: Vercel's ESM runtime neither bundles nor resolves
 * extensionless relative imports. `dist/handler.js` is produced by the
 * buildCommand before the function is packaged.
 *
 * Required env on Vercel: MCP_TOKEN_SECRET. Optional: FT_API_URL,
 * MCP_PUBLIC_URL (derived from the Host header).
 */
// @ts-expect-error -- JS bundle generated at build time, with no type declarations
import { handleHttp } from "../dist/handler.js";

export default handleHttp;
