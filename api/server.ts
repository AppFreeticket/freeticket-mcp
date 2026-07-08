/**
 * Vercel Function: todo el tráfico (vercel.json lo reescribe acá) pasa por el
 * mismo handler que el server standalone. Requiere env MCP_TOKEN_SECRET en el
 * proyecto de Vercel; MCP_PUBLIC_URL es opcional (se deriva del Host).
 */
import { handleHttp } from "../src/handler";

export default handleHttp;
