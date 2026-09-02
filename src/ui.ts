/**
 * MCP Apps (extensión `io.modelcontextprotocol/ui`, spec 2026-01-26): la UI de
 * FreeTicket dentro del host — Claude, Claude Desktop, VS Code, Goose.
 *
 * Contrato de la extensión, en dos partes atadas por el URI:
 *  1. un recurso `ui://` con mimeType `text/html;profile=mcp-app` (el HTML del
 *     view, autocontenido),
 *  2. los tools que quieren render visual declaran `_meta.ui.resourceUri`
 *     apuntando a ese recurso.
 *
 * El host baja el HTML, lo monta en un iframe sandboxeado y le empuja el
 * resultado del tool por postMessage. Un host que no soporte la extensión
 * ignora `_meta` y se queda con el texto — por eso el mismo tool sirve a los
 * dos mundos y registramos siempre, sin negociar.
 *
 * El view habla el dialecto JSON-RPC de la extensión a mano (~40 líneas) en vez
 * de traer @modelcontextprotocol/ext-apps: así el HTML es un string en el
 * bundle, sin paso de build extra ni lecturas de disco — que es lo que hace que
 * esto funcione igual en stdio y en la Vercel Function.
 * ponytail: si el view crece más allá de tabla + KPIs, mover a un entry propio
 * bundleado con tsup.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRAND, FAVICON_SVG } from "./brand";

/** mimeType que exige la spec para un view HTML. */
export const UI_MIME = "text/html;profile=mcp-app";
/** Un solo view para todo: el render se decide por la forma del payload. */
export const UI_URI = "ui://freeticket/view.html";
/** Versión del protocolo de la extensión que hablamos (LATEST_PROTOCOL_VERSION). */
export const UI_PROTOCOL = "2026-01-26";

/** `_meta` que ata un tool a su view. Se pasa tal cual a registerTool. */
export const UI_META = { ui: { resourceUri: UI_URI } } as const;

/**
 * Registra un read con vista de MCP Apps: mismo tool, más `_meta.ui` apuntando
 * al view. `server.tool()` no acepta `_meta`, por eso estos pasan por
 * `registerTool`. Todo listado o reporte debería usar esto — un listado sin
 * view se ve como un volcado de JSON y nadie nota que le falta.
 */
export function uiTool(
	server: McpServer,
	name: string,
	description: string,
	inputSchema: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: firma del SDK, varía por tool.
	cb: (args: any) => Promise<any>,
): void {
	server.registerTool(
		name,
		// biome-ignore lint/suspicious/noExplicitAny: idem — el shape lo fija zod.
		{ description, inputSchema: inputSchema as any, _meta: UI_META },
		cb,
	);
}

const VIEW_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>FreeTicket</title>
<style>
  :root {
    color-scheme: light dark;
    --ft: ${BRAND.accent};
    --color-text-primary: light-dark(#18181b, #fafafa);
    --color-text-secondary: light-dark(#52525b, #a1a1aa);
    --color-background-primary: light-dark(#ffffff, #18181b);
    --color-background-secondary: light-dark(#fafafa, #27272a);
    --color-border-primary: light-dark(#e4e4e7, #3f3f46);
    --font-sans: ui-sans-serif, system-ui, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12px;
    font-family: var(--font-sans);
    font-size: 13px; line-height: 1.45;
    color: var(--color-text-primary);
    background: transparent;
  }
  header { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
  /* La marca es nuestra y no negociable: el logo de FreeTicket sale de
     brand.ts, con tamaño fijo para que ningún tema del host lo escale. */
  header svg { width: 16px; height: 16px; border-radius: 4px; flex: none; }
  header b { font-size: 13px; letter-spacing: -0.01em; }
  header span { color: var(--color-text-secondary); font-size: 12px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
  .tile {
    border: 1px solid var(--color-border-primary); border-radius: 8px;
    padding: 10px 12px; background: var(--color-background-secondary);
  }
  .tile dt { margin: 0 0 2px; font-size: 11px; color: var(--color-text-secondary); }
  .tile dd { margin: 0; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .scroll { overflow-x: auto; border: 1px solid var(--color-border-primary); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td {
    text-align: left; padding: 6px 10px; white-space: nowrap;
    border-bottom: 1px solid var(--color-border-primary);
  }
  th { color: var(--color-text-secondary); font-weight: 600; background: var(--color-background-secondary); }
  tr:last-child td { border-bottom: 0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill {
    display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px;
    border: 1px solid var(--color-border-primary);
  }
  .pill.ok { border-color: var(--ft); color: var(--ft); }
  .muted { color: var(--color-text-secondary); }
  footer { margin-top: 8px; font-size: 11px; color: var(--color-text-secondary); }
  pre { margin: 0; font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<header>${FAVICON_SVG}<b>FreeTicket</b><span id="sub">cargando…</span></header>
<div id="root"><p class="muted">Esperando datos…</p></div>
<footer id="foot"></footer>
<script>
(() => {
  const PROTOCOL = "${UI_PROTOCOL}";
  const host = window.parent;
  let id = 0;
  const send = (method, params) =>
    host.postMessage({ jsonrpc: "2.0", method, params }, "*");
  // Solo escuchamos al frame que nos montó: cualquier otro puede inyectar un
  // tool-result falso y el usuario vería datos que no vinieron de FreeTicket.
  const fromHost = (e) => e.source === host || e.source == null;
  const request = (method, params) =>
    new Promise((resolve) => {
      const rid = ++id;
      const onMsg = (e) => {
        if (fromHost(e) && e.data && e.data.id === rid) {
          window.removeEventListener("message", onMsg);
          resolve(e.data.result);
        }
      };
      window.addEventListener("message", onMsg);
      host.postMessage({ jsonrpc: "2.0", id: rid, method, params }, "*");
    });

  // El host manda sus variables CSS: adoptarlas mantiene el view integrado al
  // tema del chat en vez de imponerle el nuestro. Solo se aceptan las del
  // contrato de la extensión (--color-* / --font-*): lo de marca (--ft) queda
  // fuera del alcance del host por diseño, no por olvido.
  const HOST_VAR = /^--(color|font)-/;
  const applyTheme = (ctx) => {
    const vars = ctx && ctx.styles && ctx.styles.variables;
    if (vars) for (const [k, v] of Object.entries(vars)) {
      if (v && HOST_VAR.test(k)) document.documentElement.style.setProperty(k, v);
    }
    if (ctx && ctx.theme) {
      // data-theme + color-scheme: sin lo segundo, light-dark() sigue el tema
      // del SO y el view queda claro dentro de un chat oscuro.
      document.documentElement.dataset.theme = ctx.theme;
      document.documentElement.style.colorScheme = ctx.theme;
    }
    if (ctx && ctx.locale) setLocale(ctx.locale);
  };

  const MONEY = /amount|gross|net|total|price|fee|facial|gmf|revenue|subtotal/i;
  let money = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
  const setLocale = (loc) => {
    try { money = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }); }
    catch { /* locale inválido del host: nos quedamos con es-CO */ }
  };
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const label = (k) =>
    k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");

  function cell(key, v) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    if (isNum(v)) return MONEY.test(key) ? money.format(v) : String(v);
    if (typeof v === "boolean") return v ? "sí" : "no";
    if (typeof v === "object") {
      // { id, name } y compañía: mostrar lo legible, no el JSON entero.
      const s = v.name || v.label || v.reference || v.startsAt;
      return s ? esc(String(s)) : esc(JSON.stringify(v));
    }
    const s = String(v);
    if (/^(PAID|CONFIRMED|ACTIVE|PUBLISHED|OK)$/.test(s))
      return '<span class="pill ok">' + esc(s) + "</span>";
    if (/^[A-Z][A-Z_]{2,}$/.test(s)) return '<span class="pill">' + esc(s) + "</span>";
    return esc(s.length > 60 ? s.slice(0, 57) + "…" : s);
  }
  const esc = (s) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function table(rows) {
    const shown = rows.slice(0, 50);
    const cols = [...new Set(shown.flatMap((r) => Object.keys(r)))].slice(0, 9);
    const head = cols.map((c) => "<th>" + esc(label(c)) + "</th>").join("");
    const body = shown
      .map((r) =>
        "<tr>" +
        cols.map((c) =>
          '<td class="' + (isNum(r[c]) ? "num" : "") + '">' + cell(c, r[c]) + "</td>",
        ).join("") +
        "</tr>",
      ).join("");
    return (
      '<div class="scroll"><table><thead><tr>' + head + "</tr></thead><tbody>" +
      body + "</tbody></table></div>" +
      (rows.length > shown.length
        ? '<footer class="muted">' + (rows.length - shown.length) + " filas más</footer>"
        : "")
    );
  }

  function tiles(obj) {
    const entries = Object.entries(obj).filter(
      ([, v]) => v === null || typeof v !== "object",
    );
    if (!entries.length) return "<pre>" + esc(JSON.stringify(obj, null, 2)) + "</pre>";
    return (
      '<dl class="tiles">' +
      entries.map(([k, v]) =>
        '<div class="tile"><dt>' + esc(label(k)) + "</dt><dd>" + cell(k, v) + "</dd></div>",
      ).join("") +
      "</dl>"
    );
  }

  function render(result) {
    const root = document.getElementById("root");
    const sub = document.getElementById("sub");
    const foot = document.getElementById("foot");
    if (result && result.isError) {
      sub.textContent = "error";
      root.innerHTML = '<pre class="muted">' + esc(text(result)) + "</pre>";
      return size();
    }
    let data = result && result.structuredContent && result.structuredContent.data;
    if (data === undefined) {
      try { data = JSON.parse(text(result)); } catch { data = text(result); }
    }
    if (data && !Array.isArray(data) && typeof data === "object" && Array.isArray(data.data))
      data = data.data;

    if (Array.isArray(data)) {
      const rows = data.filter((r) => r && typeof r === "object");
      sub.textContent = data.length + (data.length === 1 ? " resultado" : " resultados");
      root.innerHTML = rows.length
        ? table(rows)
        : data.length
          ? "<pre>" + esc(JSON.stringify(data, null, 2)) + "</pre>"
          : '<p class="muted">Sin resultados.</p>';
    } else if (data && typeof data === "object") {
      sub.textContent = "";
      root.innerHTML = tiles(data);
    } else {
      sub.textContent = "";
      root.innerHTML = "<pre>" + esc(String(data ?? "")) + "</pre>";
    }
    foot.textContent = "";
    size();
  }

  const text = (r) =>
    ((r && r.content) || [])
      .filter((c) => c.type === "text").map((c) => c.text).join("\\n");

  let last = 0;
  function size() {
    const h = Math.ceil(document.body.scrollHeight);
    if (h === last) return;
    last = h;
    send("ui/notifications/size-changed", { width: window.innerWidth, height: h });
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!fromHost(e) || !m || !m.method) return;
    if (m.method === "ui/notifications/tool-result") render(m.params);
    if (m.method === "ui/notifications/host-context-changed") applyTheme(m.params);
    if (m.method === "ui/notifications/tool-input")
      document.getElementById("sub").textContent = "consultando…";
    // Shutdown ordenado: el host espera respuesta antes de desmontar el iframe.
    if (m.method === "ui/resource-teardown")
      host.postMessage({ jsonrpc: "2.0", id: m.id, result: {} }, "*");
  });

  request("ui/initialize", {
    protocolVersion: PROTOCOL,
    appInfo: { name: "freeticket-view", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
  }).then((res) => {
    applyTheme(res && res.hostContext);
    send("ui/notifications/initialized", {});
    size();
  });

  new ResizeObserver(size).observe(document.body);
})();
</script>
</body>
</html>`;

/**
 * Registra el view. Un solo recurso para todos los tools con UI: el HTML decide
 * el render por la forma del payload (array → tabla, objeto → tiles), así no
 * hay una plantilla por reporte que mantener.
 */
export function registerUi(server: McpServer): void {
	server.registerResource(
		"freeticket_view",
		UI_URI,
		{
			description:
				"Vista interactiva de FreeTicket: tabla para listados, tiles para KPIs.",
			mimeType: UI_MIME,
			// Sin dominios externos: el HTML es autocontenido, no pide red.
			_meta: { ui: { csp: {}, prefersBorder: true } },
		},
		async () => ({
			contents: [{ uri: UI_URI, mimeType: UI_MIME, text: VIEW_HTML }],
		}),
	);
}
