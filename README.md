# @freeticket/mcp

Servidor **MCP** (Model Context Protocol) oficial de FreeTicket. Expone el dominio
B2B —eventos, fechas, ventas, tickets, membresías, venues, staff, informes— como
_tools_ a cualquier cliente MCP (Claude Code, Claude Desktop, etc.).

Mismo contrato y misma sesión que el CLI `ft`: si ya hiciste `ft login`, el MCP
queda autenticado sin configurar nada (lee `~/.freeticket/config.json`).

## Uso (Claude Code / Claude Desktop)

```jsonc
{
  "mcpServers": {
    "freeticket": {
      "command": "npx",
      "args": ["-y", "@freeticket/mcp"]
      // Sin env: usa la sesión de `ft login`. Para CI/headless:
      // "env": { "FT_API_KEY": "ft_live_...", "FT_WORKSPACE_ID": "ws_..." }
    }
  }
}
```

Config: env > `~/.freeticket/config.json` > default. Variables: `FT_API_URL`
(base, sin `/api/v1`), `FT_API_KEY`, `FT_WORKSPACE_ID`, `FT_ADMIN_SESSION`
(habilita los tools `admin_*` del contrato superadmin `/api/admin`).

## Uso remoto por URL (HTTP)

Además del stdio, el server corre por **Streamable HTTP** para agregarlo como
connector por URL (claude.ai, Claude Code remoto, curl) sin instalar nada local:

```bash
freeticket-mcp-http          # escucha en :3333 (PORT para cambiarlo)
```

Es **stateless**: cada request trae sus credenciales y el server arma clientes
aislados por sesión (nunca lee el disco), así un mismo proceso sirve a varios
workspaces sin cruzar sesiones. Endpoints:

| Endpoint | Auth | Tools |
|---|---|---|
| `POST /mcp` | Bearer (token OAuth o API key cruda) | `public_*` + B2B (+ `admin_*` si la credencial lo trae) |
| `POST /mcp/public` | ninguna | solo `public_*` (agentes compradores) |

### Conectar en claude.ai (Add custom connector)

El server trae un **authorization server OAuth 2.1 embebido** — es lo único que
claude.ai sabe hablar (no puede mandar API keys ni headers custom). Pasos:

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. Remote MCP server URL: `https://<tu-deploy>/mcp`. Client ID/Secret: vacíos
   (usa dynamic client registration, RFC 7591).
3. Al conectar se abre el consentimiento: botón **"Continuar con FreeTicket"** →
   inicias sesión en free-admin con tu cuenta de siempre y apruebas (device flow
   RFC 8628, el mismo backend que `ft login`). Sin keys que pegar; si tienes
   varios workspaces, eliges cuál conectar. Bajo "Opciones avanzadas" queda el
   form manual (API key para CI, cookie superadmin para los `admin_*`).
4. Las credenciales se sellan (AES-256-GCM, `MCP_TOKEN_SECRET`) dentro del token
   emitido — el server no persiste nada: sin base de datos, multi-tenant seguro.

Flujo estándar completo: discovery RFC 9728/8414 → `/register` → `/authorize`
(PKCE S256) → `/token` (con refresh). `FT_OAUTH_ISSUER` delega todo a un AS
externo (p. ej. cuando `free-admin` publique el suyo).

### Auth directa (curl, clientes propios)

```bash
curl -X POST http://localhost:3333/mcp \
  -H 'authorization: Bearer ft_live_...' \      # API key cruda
  -H 'x-workspace-id: ws_...' \                 # opcional
  -H 'x-admin-session: <cookie>' \              # opcional — habilita admin_*
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Deploy en Vercel

El repo ya trae `vercel.json` + `api/server.ts` (misma lógica que el binario,
como Vercel Function):

```bash
vercel                                        # preview
vercel env add MCP_TOKEN_SECRET production    # openssl rand -hex 32
vercel --prod
```

Env en Vercel: `MCP_TOKEN_SECRET` (**requerido** — sin él los tokens mueren en
cada cold start), `FT_API_URL` (opcional, default producción), `MCP_PUBLIC_URL`
(opcional — se deriva del Host). Connector URL resultante:
`https://<proyecto>.vercel.app/mcp`.

## Tools

**B2B `/api/v1`** (un tool = una operación del contrato). Los writes destructivos
(`*_delete`, `*_refund`, `*_cancel`) llevan `destructiveHint` y piden confirmación.

| Dominio | Reads | Writes |
|---|---|---|
| Sesión | `whoami` | — |
| Eventos | `events_list` · `events_get` · `event_dates_list` | `events_create` · `events_update` · `events_publish` · `events_delete` · `event_dates_create` · `event_dates_update` · `event_dates_delete` |
| Tickets | `ticket_types_list` · `ticket_types_get` · `tickets_access` | `ticket_types_create` · `ticket_types_update` · `ticket_types_delete` · `tickets_checkin` · `tickets_resend` |
| Ventas | `sales_list` · `sales_get` · `sales_tickets` | `sales_create` · `sales_cancel` · `sales_refund` |
| Membresías | `plans_list` · `plans_get` · `plans_subscribers` | `plans_create` · `plans_update` · `plans_delete` · `subscriptions_cancel` |
| Comercial | `discounts_list` · `webhooks_list` · `venues_list` · `venues_get` · `staff_list` | `discounts_create` · `discounts_update` · `discounts_delete` · `webhooks_create` · `webhooks_delete` · `venues_create` · `venues_update` · `venues_delete` · `staff_create` · `staff_update_role` |
| Reportes | `reports_summary` · `reports_by_event` · `reports_timeseries` · `reports_inventory` · `reports_financials` · `reconciliation` | — |
| Liquidaciones | `settlements_list` | — |
| Credenciales | `api_keys_list` | — |
| Exports | `reports_export_buyers` · `reports_export_attendees` · `reports_export_subscribers` · `reports_export_reconciliation` | — |

Acuñar y revocar credenciales (`ft api-keys`, `ft admin tokens`) queda fuera del
MCP a propósito: un agente lista credenciales para auditarlas, no las emite.
El PDF de comprobante de una liquidación se baja del panel — el contrato expone
`hasDocument` y los nombres de archivo, no una URL de descarga (ver
[CONTRACT-GAPS.md](https://github.com/AppFreeticket/ai-native/blob/main/CONTRACT-GAPS.md)).

**Público B2C `/api/public`** (sin credenciales — el agente de un comprador):

| Dominio | Tools |
|---|---|
| Descubrimiento | `public_events_list` · `public_events_get` · `public_events_availability` |
| Checkout | `public_orders_create` (→ `checkoutUrl` de Mercado Pago) · `public_orders_get` |
| Post-venta | `public_tickets_resend` |

Los `public_*` se registran **siempre** (anónimos). El agente nunca toca el
pago: `public_orders_create` devuelve el link de Mercado Pago para que el humano
pague. Alcance del checkout: admisión general (no numerado / no members-only).

**Superadmin `/api/admin`** (solo con `FT_ADMIN_SESSION`):

| Dominio | Tools |
|---|---|
| Sesión / auditoría | `admin_whoami` · `admin_audit_log` · `admin_tokens` |
| Workspaces | `admin_workspaces` · `admin_workspaces_get` · `admin_workspaces_create` · `admin_workspaces_update` · `admin_workspaces_suspend` · `admin_workspaces_restore` |
| Users | `admin_users` · `admin_users_get` · `admin_users_update` · `admin_impersonate` · `admin_impersonate_stop` |
| Platform plans | `admin_platform_plans_list` · `admin_platform_plans_get` · `admin_platform_plans_create` · `admin_platform_plans_update` |
| Feature flags | `admin_feature_flags_list` · `admin_feature_flags_set` |

## UI en el host (MCP Apps)

El server implementa la extensión **`io.modelcontextprotocol/ui`** ([MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps),
spec `2026-01-26`), así que los listados y reportes no llegan como un muro de
JSON: el host los dibuja.

- Recurso: `ui://freeticket/view.html`, mimeType `text/html;profile=mcp-app`.
- Los tools con vista lo apuntan por `_meta.ui.resourceUri`; el resultado viaja
  también en `structuredContent` para que el view lo lea.
- Un único view decide el render por la forma del payload: **array → tabla**
  (con formato de moneda, pills de estado y scroll horizontal),
  **objeto → tiles de KPI**.
- El HTML es autocontenido: sin scripts externos, sin fetch, sin fuentes
  remotas. Adopta las variables CSS del host (`hostContext.styles.variables`) y
  reporta su alto con `ui/notifications/size-changed`, así queda integrado al
  tema del chat en vez de imponer el suyo.
- Hosts sin la extensión (o clientes de terminal) ignoran `_meta` y ven el mismo
  texto de siempre: nada se rompe.

Con vista: `events_list` · `ticket_types_list` · `sales_list` · `plans_list` ·
`discounts_list` · `webhooks_list` · `venues_list` · `staff_list` ·
`reports_summary` · `reports_by_event` · `reports_timeseries` ·
`reports_inventory` · `reconciliation` · `settlements_list` ·
`reports_financials` · `api_keys_list` · `admin_tokens`.

## Desarrollo

```bash
pnpm install
pnpm generate     # regenera src/client/ y src/admin-client/ desde los specs
pnpm dev          # corre el server vía stdio
pnpm typecheck && pnpm test
```

Los contratos `openapi.json` (`/api/v1`) y `admin-openapi.json` (`/api/admin`) los
sirve `free-admin` y son la única fuente de verdad — linajes semver separados.
Para propagar un cambio del backend, usá el agente `contract-sync` del paraguas
[ai-native](https://github.com/AppFreeticket/ai-native).

MIT.
