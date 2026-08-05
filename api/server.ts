/**
 * Vercel Function: todo el tráfico (vercel.json lo reescribe acá) pasa por el
 * mismo handler que el server standalone. Importa el bundle de tsup (dist/) y
 * no src/ directamente: el runtime ESM de Vercel no bundlea ni resuelve
 * imports relativos sin extensión. `dist/handler.js` lo genera el
 * buildCommand antes de empaquetar la función.
 *
 * Env requerida en Vercel: MCP_TOKEN_SECRET. Opcionales: FT_API_URL,
 * MCP_PUBLIC_URL (se deriva del Host).
 */
// @ts-expect-error -- bundle JS generado en build, sin declaraciones de tipos
import { handleHttp } from "../dist/handler.js";

export default handleHttp;
