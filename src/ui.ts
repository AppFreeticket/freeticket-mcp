/**
 * MCP Apps (the `io.modelcontextprotocol/ui` extension, spec 2026-01-26):
 * FreeTicket's UI inside the host — Claude, Claude Desktop, VS Code, Goose.
 *
 * The extension contract, in two halves tied together by the URI:
 *  1. a `ui://` resource with mimeType `text/html;profile=mcp-app` (the view's
 *     HTML, self-contained),
 *  2. tools that want a visual render declare `_meta.ui.resourceUri` pointing
 *     at that resource.
 *
 * The host downloads the HTML, mounts it in a sandboxed iframe and pushes the
 * tool result at it over postMessage. A host without the extension ignores
 * `_meta` and keeps the text — which is why the same tool serves both worlds
 * and we always register, with nothing to negotiate.
 *
 * The view speaks the extension's JSON-RPC dialect by hand (~40 lines) instead
 * of pulling in @modelcontextprotocol/ext-apps: that way the HTML is a string
 * in the bundle, with no extra build step and no disk reads — which is what
 * makes this behave identically over stdio and in the Vercel Function.
 * ponytail: if the view grows beyond table + KPIs, move it to its own entry
 * bundled with tsup.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRAND, FAVICON_SVG } from "./brand";

/** The mimeType the spec requires for an HTML view. */
export const UI_MIME = "text/html;profile=mcp-app";
/** One view for everything: the render is chosen by the shape of the payload. */
export const UI_URI = "ui://freeticket/view.html";
/** The extension protocol version we speak (LATEST_PROTOCOL_VERSION). */
export const UI_PROTOCOL = "2026-01-26";

/** The `_meta` that ties a tool to its view. Passed as-is to registerTool. */
export const UI_META = { ui: { resourceUri: UI_URI } } as const;

/**
 * Registers a read with an MCP Apps view: the same tool, plus a `_meta.ui`
 * pointing at the view. `server.tool()` does not accept `_meta`, which is why
 * these go through `registerTool`. Every list and report should use this — a
 * list without a view looks like a JSON dump and nobody notices it is missing.
 */
export function uiTool(
	server: McpServer,
	name: string,
	description: string,
	inputSchema: Record<string, unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: SDK signature, varies per tool.
	cb: (args: any) => Promise<any>,
): void {
	server.registerTool(
		name,
		// biome-ignore lint/suspicious/noExplicitAny: same — zod pins the shape.
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
  /* The brand is ours and not negotiable: the FreeTicket logo comes from
     brand.ts, at a fixed size so no host theme can scale it. */
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
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
  .card {
    border: 1px solid var(--color-border-primary); border-radius: 10px; overflow: hidden;
    background: var(--color-background-secondary); display: flex; flex-direction: column;
  }
  .cover { aspect-ratio: 16 / 9; background: var(--color-background-primary); }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cbody { padding: 9px 11px; display: grid; gap: 4px; }
  .cbody h3 { margin: 0; font-size: 13px; line-height: 1.3; letter-spacing: -0.01em; }
  .meta { margin: 0; font-size: 11px; color: var(--color-text-secondary); }
  .desc {
    margin: 0; font-size: 11px; color: var(--color-text-secondary);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .foot { margin: 2px 0 0; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
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
<header>${FAVICON_SVG}<b>FreeTicket</b><span id="sub">loading…</span></header>
<div id="root"><p class="muted">Waiting for data…</p></div>
<footer id="foot"></footer>
<script>
(() => {
  const PROTOCOL = "${UI_PROTOCOL}";
  const host = window.parent;
  let id = 0;
  const send = (method, params) =>
    host.postMessage({ jsonrpc: "2.0", method, params }, "*");
  // We listen only to the frame that mounted us: any other one could inject a
  // fake tool-result and the user would see data that did not come from FreeTicket.
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

  // The host sends its CSS variables: adopting them keeps the view integrated
  // with the chat theme instead of imposing ours. Only the ones in the
  // extension contract are accepted (--color-* / --font-*): the brand ones
  // (--ft) are out of the host's reach by design, not by oversight.
  const HOST_VAR = /^--(color|font)-/;
  const applyTheme = (ctx) => {
    const vars = ctx && ctx.styles && ctx.styles.variables;
    if (vars) for (const [k, v] of Object.entries(vars)) {
      if (v && HOST_VAR.test(k)) document.documentElement.style.setProperty(k, v);
    }
    if (ctx && ctx.theme) {
      // data-theme + color-scheme: without the second, light-dark() follows the
      // OS theme and the view renders light inside a dark chat.
      document.documentElement.dataset.theme = ctx.theme;
      document.documentElement.style.colorScheme = ctx.theme;
    }
    if (ctx && ctx.locale) setLocale(ctx.locale);
  };

  const MONEY = /amount|gross|net|total|price|fee|facial|gmf|revenue|subtotal/i;
  let locale = "es-CO";
  let money = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const setLocale = (loc) => {
    try {
      money = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
      locale = loc;
    } catch { /* invalid locale from the host: we keep es-CO */ }
  };
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const label = (k) =>
    k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");

  function cell(key, v) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    if (isNum(v)) return MONEY.test(key) ? money.format(v) : String(v);
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "object") {
      // { id, name } and friends: show the readable part, not the whole JSON.
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
        ? '<footer class="muted">' + (rows.length - shown.length) + " more rows</footer>"
        : "")
    );
  }

  // An event is a poster, not a row: a name, a cover, a date, a price from.
  // Through the generic table the name ends up off screen behind a cover URL
  // while the first columns are whatever the API happened to serialise first.
  const EVENT_KEYS = ["coverImageUrl", "nextDate", "slug", "city"];
  const isEvent = (r) =>
    typeof (r.name ?? r.title) === "string" && EVENT_KEYS.some((k) => k in r);
  const first = (r, keys) => {
    for (const k of keys)
      if (r[k] !== null && r[k] !== undefined && r[k] !== "") return r[k];
  };
  // The contract says priceFrom/nextDate; production has served other names for
  // the same thing, so the card reads a list instead of one key.
  const PRICE_KEYS = ["priceFrom", "buyerTotalFrom", "minPrice", "price"];
  const DATE_KEYS = ["nextDate", "startsAt", "startDate", "date"];
  const COVER_KEYS = ["coverImageUrl", "imageUrl", "cover"];

  const when = (v) => {
    const d = new Date(v);
    if (!v || Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: "short", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit",
      }).format(d);
    } catch { return String(v); }
  };
  const priceFrom = (r) => {
    const v = first(r, PRICE_KEYS);
    if (!isNum(v)) return "";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency", currency: r.currency || "COP", maximumFractionDigits: 0,
      }).format(v);
    } catch { return money.format(v) + (r.currency ? " " + r.currency : ""); }
  };

  function cards(rows) {
    const shown = rows.slice(0, 24);
    const html = shown.map((r) => {
      const url = String(first(r, COVER_KEYS) || "");
      // Only http(s): a javascript: or data: src from the API is not a cover.
      const cover = url.startsWith("https://") || url.startsWith("http://")
        ? '<div class="cover"><img alt="" loading="lazy" src="' + esc(url) + '"></div>'
        : "";
      const meta = [r.city, when(first(r, DATE_KEYS))].filter(Boolean).map(String);
      const money_ = priceFrom(r);
      const status = typeof r.status === "string" ? r.status : "";
      return (
        '<article class="card">' + cover + '<div class="cbody">' +
        "<h3>" + esc(String(r.name ?? r.title)) + "</h3>" +
        (meta.length ? '<p class="meta">' + esc(meta.join(" \u00b7 ")) + "</p>" : "") +
        (r.description ? '<p class="desc">' + esc(String(r.description)) + "</p>" : "") +
        '<p class="foot">' +
        (money_ ? '<span class="pill ok">From ' + esc(money_) + "</span>" : "") +
        (status ? '<span class="pill">' + esc(status) + "</span>" : "") +
        (r.slug ? '<span class="muted">' + esc(String(r.slug)) + "</span>" : "") +
        "</p></div></article>"
      );
    }).join("");
    return (
      '<div class="cards">' + html + "</div>" +
      (rows.length > shown.length
        ? '<footer class="muted">' + (rows.length - shown.length) + " more</footer>"
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
      sub.textContent = data.length + (data.length === 1 ? " result" : " results");
      root.innerHTML = rows.length
        ? (rows.every(isEvent) ? cards(rows) : table(rows))
        : data.length
          ? "<pre>" + esc(JSON.stringify(data, null, 2)) + "</pre>"
          : '<p class="muted">No results.</p>';
    } else if (data && typeof data === "object") {
      sub.textContent = "";
      root.innerHTML = tiles(data);
    } else {
      sub.textContent = "";
      root.innerHTML = "<pre>" + esc(String(data ?? "")) + "</pre>";
    }
    foot.textContent = "";
    // A cover the host cannot load (CSP, dead link) drops out; the card stays.
    for (const img of root.querySelectorAll("img"))
      img.onerror = () => { const c = img.closest(".cover"); if (c) c.remove(); size(); };
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
      document.getElementById("sub").textContent = "querying…";
    // Orderly shutdown: the host waits for a reply before unmounting the iframe.
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
 * Registers the view. One resource for every tool with UI: the HTML picks the
 * render from the shape of the payload (array → table, object → tiles), so
 * there is no per-report template to maintain.
 */
export function registerUi(server: McpServer): void {
	server.registerResource(
		"freeticket_view",
		UI_URI,
		{
			description:
				"Interactive FreeTicket view: a table for lists, tiles for KPIs.",
			mimeType: UI_MIME,
			// The HTML asks for no network; the event covers do. They live on each
			// organizer's storage domain, hence the scheme instead of an origin.
			// ponytail: pin the bucket origin if a host rejects the wildcard.
			_meta: { ui: { csp: { "img-src": ["https:"] }, prefersBorder: true } },
		},
		async () => ({
			contents: [{ uri: UI_URI, mimeType: UI_MIME, text: VIEW_HTML }],
		}),
	);
}
