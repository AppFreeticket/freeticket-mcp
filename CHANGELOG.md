# Changelog

All notable changes to `@freeticket/mcp` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: semver.

## [0.14.0] - 2026-09-02

Sincroniza los tres contratos con lo que free-admin ya sirve: B2B 1.5.0 → **1.7.0**,
superadmin 1.1.0 → **1.3.0**, público 0.3.0 → **0.4.0**. Cierra seis brechas del
ledger del paraguas de una sola vez (#355, #356, #381, #382, #383, #403).
**103 tools** (B2B 76 · superadmin 21 · público 6).

### Added
- **Área de socios completa** (contrato 1.7.0, issue #355): `customer_ticket_get`,
  `customer_membership`, `customer_profile`, `customer_ticket_cancel`,
  `customer_subscribe` (devuelve la URL de pago — el agente nunca cobra),
  `customer_subscription_cancel`, `customer_profile_update`, `customer_logout`.
  Misma credencial doble que `customer_me`: API key enterprise + `X-Customer-Session`.
- **Contenido de la organización** (#356): `content_videos`, `content_posts`,
  `content_lives`, `content_live_get` y `content_playback_token` (token firmado,
  30 min en vivo / 1 h en video; `memberOnly` exige comprador con membresía).
- **Comprobantes de liquidación** (#381): `settlements_document` y
  `settlements_proof`. La API responde 302 a una URL firmada de 5 minutos, así que
  van con fetch crudo (`redirect: "manual"`) y devuelven el link — seguir la
  redirección metería el PDF entero en el contexto del modelo.
- `admin_workspaces_assign_plan` (#383): venta asistida, activa un tier sin pasar
  por el autoservicio de Stripe. `admin_workspaces_update` suma `webTemplate`,
  `customDomain` y `customDomainVerifiedAt`.
- `events_list` acepta `q`, `status` (filtra en la consulta, así `limit` cuenta
  filas devueltas) y `withTotal` (agrega `page.total`, opt-in).
- `sales_cancel` y `sales_refund` exponen los flags que el contrato ahora pide:
  `acknowledge_open_payment` y `acknowledge_manual`.
- Vista de MCP Apps en los 4 listados nuevos: van **29 tools con vista**.

### Changed
- `staff_list` en modo global usa `workspaceIds` del contrato (#382): **una sola
  llamada** con las filas etiquetadas por el backend, en vez del fan-out de N
  requests. El resto de los listados sigue con fan-out — el contrato no expone
  agregación para ellos.
- `GET /me` ahora trae el **rol efectivo y las secciones por workspace**
  (`WorkspaceAccess`, #403); `Me.role` queda deprecado en el contrato. El
  enforcement es del backend: el MCP ya no puede operar un workspace con un rol
  que el panel acota. El fan-out global además **descarta antes de disparar** los
  workspaces con `sections: []` (acceso vencido o revocado), en vez de
  descubrirlos a fuerza de 403 en `errors[]`.

## [0.13.0] - 2026-08-05

### Added
- `customer_me` y `customer_tickets` (GET /customer/me, GET /customer/tickets):
  el SSO headless enterprise, único hueco que quedaba en el contrato B2B. Piden
  API key de servicio enterprise + el session token del comprador
  (`X-Customer-Session`). El canje que emite ese token sigue fuera del MCP:
  mintea sesiones de terceros.
- Vista de MCP Apps en 8 listados que salían en texto plano:
  `public_events_list`, `event_dates_list`, `customer_tickets`,
  `admin_workspaces`, `admin_users`, `admin_audit_log`,
  `admin_platform_plans_list`, `admin_feature_flags_list`. Van 25 tools con vista
  — todos los listados y reportes.
- `src/coverage.test.ts`: barrido del contrato. Cada operación de los tres specs
  tiene tool o está excluida con su motivo; si `sync-openapi` trae un endpoint
  nuevo y nadie le hace tool, el test falla con su método y path. Las
  exclusiones deliberadas (device flow, acuñar credenciales, canje de sesiones)
  quedan documentadas junto al test.
- Tests reales del view en jsdom: se monta el HTML y se le empujan mensajes del
  host. Cubren tabla, tiles, sobre `{ data }`, error, escape de payloads de la
  API, handshake, teardown y las invariantes de marca. Antes solo se verificaba
  que el string contuviera ciertas subcadenas.

### Fixed
- **El tema del host ya no puede pisar la marca.** `applyTheme` acepta solo las
  variables del contrato de la extensión (`--color-*`, `--font-*`); el acento de
  FreeTicket queda fuera de su alcance. El header muestra el logo real de
  `brand.ts` en vez de un cuadradito de CSS.
- Al cambiar de tema el view fija `color-scheme` además de `data-theme`. Sin eso
  `light-dark()` seguía al sistema operativo y el view salía claro dentro de un
  chat oscuro.
- El view valida `event.source`: solo procesa mensajes del frame que lo montó.
  Cualquier otro podía inyectar un `tool-result` falso y el usuario habría visto
  datos que no vinieron de FreeTicket.
- El view responde `ui/resource-teardown` para que el host desmonte el iframe de
  forma ordenada, y muestra estado al recibir `ui/notifications/tool-input`.
- La moneda se formatea con el `locale` del host cuando lo declara (antes,
  siempre `es-CO`).

## [0.12.0] - 2026-08-03

### Added
- **MCP Apps (`io.modelcontextprotocol/ui`, spec 2026-01-26)**: el server publica
  el recurso `ui://freeticket/view.html` (mimeType `text/html;profile=mcp-app`) y
  17 tools de lectura lo declaran en `_meta.ui.resourceUri`. Un único view
  autocontenido renderiza **tabla** para listados y **tiles de KPI** para
  objetos, con formato de moneda, pills de estado y adopción del tema del host.
  Los resultados ahora viajan también en `structuredContent` (`{ data }`), que
  es lo que consume el view. Hosts sin la extensión ignoran `_meta` y siguen
  viendo el texto.
- `settlements_list` (GET /settlements) y `reports_financials`
  (GET /reports/financials): las liquidaciones al organizador y el desglose
  financiero por función — los números autoritativos del panel de Liquidaciones.
- `api_keys_list` (GET /api-keys) y `admin_tokens` (GET /api/admin/tokens):
  auditoría de credenciales. Acuñar y revocar sigue siendo del CLI a propósito.
- Ola B completa: `event_dates_create`, `event_dates_update`,
  `ticket_types_update`, `plans_update`, `venues_update`. El contrato 1.5.0 ya
  declara su `requestBody`, así que los schemas salen del spec.

### Changed
- Contratos sincronizados: B2B `1.5.0`, admin `1.1.0`, público `0.3.0`.
- `plans_create` incluye `sortOrder` (pasó a requerido en el contrato).

## [0.11.0] - 2026-07-08

### Added
- **Login with the free-admin session** as the primary consent path: `/authorize`
  now starts the RFC 8628 device flow against free-admin (same backend as
  `ft login`). The user clicks "Continuar con FreeTicket", approves with their
  normal session at `/device`, and the consent page polls `/device-token` and
  redirects back to the MCP client automatically — no API keys to paste.
  Multi-workspace accounts get a picker (the minted key travels sealed,
  `ftp_` prefix, never exposed to the browser flow unencrypted).
- `POST /device-token`: stateless polling endpoint that redeems the device code
  against free-admin and mints the sealed authorization code.

### Changed
- The manual credentials form (API key / workspace / superadmin session) moved
  under "Opciones avanzadas"; it is also the automatic fallback when the device
  flow cannot start.

## [0.10.0] - 2026-07-08

### Added
- **Embedded OAuth 2.1 authorization server** (`src/oauth.ts`) so the remote
  server works as a claude.ai **custom connector**: discovery (RFC 8414 +
  RFC 9728), dynamic client registration (RFC 7591), `/authorize` with a consent
  page (paste API key / workspace / superadmin session) + PKCE S256, and
  `/token` with refresh grant. Tokens are **stateless**: credentials sealed with
  AES-256-GCM under `MCP_TOKEN_SECRET` — no database, nothing persisted.
  Credentials are validated against free-admin (`/api/v1/me`, `/api/admin/me`)
  before minting a code. `FT_OAUTH_ISSUER` delegates to an external AS (e.g. a
  future free-admin one) and turns the embedded AS off.
- `POST /mcp/public`: anonymous endpoint serving only the B2C `public_*` tools
  (buyer agents have no account).
- **Vercel deploy config**: `api/server.ts` + `vercel.json` reuse the same
  handler (`src/handler.ts`) as the standalone binary. Set `MCP_TOKEN_SECRET`
  in the project env; connector URL is `https://<project>.vercel.app/mcp`.

### Changed
- `POST /mcp` now **requires** a Bearer (OAuth access token or raw API key) and
  answers 401 + `WWW-Authenticate` otherwise — that challenge is what triggers
  the OAuth flow in claude.ai. Anonymous B2C access moved to `/mcp/public`.
- HTTP logic extracted from `src/http.ts` into `src/handler.ts` (shared with the
  Vercel Function); `src/http.ts` is now just the `createServer` entrypoint.

## [0.9.0] - 2026-07-07

### Added
- **B2C público (`/api/public`)**: 6 tools `public_*` anónimos (sin credenciales)
  para el agente de un comprador — `public_events_list|get|availability`
  (descubrimiento), `public_orders_create` (crea la orden y devuelve la
  `checkoutUrl` de Mercado Pago; el agente nunca toca el pago) + `public_orders_get`
  (estado + tickets al pagar), y `public_tickets_resend`. Cliente generado del
  tercer contrato (`public-openapi.json` 0.3.0 → `src/public-client/`,
  `sync-openapi:public`, `openapi-ts.public.config.ts`).
- Capas por credencial en `buildServer`: los `public_*` se registran **siempre**;
  B2B solo con `apiKey`; `admin_*` solo con `adminSession`. El server HTTP sirve
  el set público de forma **anónima** (sin Bearer, 200) y suma las capas
  autenticadas cuando llega el token.

### Changed
- `Creds.apiKey` ahora es opcional: sin credencial el server arranca en modo
  anónimo (solo B2C) en vez de fallar. El entrypoint stdio ya no aborta sin key.

## [0.6.0] - 2026-07-07

### Added
- **Remote Streamable HTTP transport** (`src/http.ts`, bin `freeticket-mcp-http`):
  the server can now be added as a **connector by URL** (claude.ai, remote Claude
  Code, curl). Stateless — a fresh server + isolated clients per request, built
  from the request's own credentials; it never reads `~/.freeticket/config.json`,
  so one process serves many tenants without crossing sessions.
- Bearer auth over HTTP: `Authorization: Bearer <FT_API_KEY>` plus optional
  `X-Workspace-Id` and `X-Admin-Session` headers (admin tools gate per request).
- OAuth 2.1 Protected Resource Metadata (RFC 9728) at
  `/.well-known/oauth-protected-resource` + `WWW-Authenticate` challenge on 401,
  pointing at the free-admin authorization server (the AS itself is the pending
  backend piece — see the roadmap).
- Shared server factory `buildServer(creds)` (`src/server.ts`) used by both the
  stdio and HTTP entrypoints.

### Changed
- Tool modules now receive an isolated `Client` instance instead of using a
  global singleton — required for safe multi-tenant HTTP (no shared mutable auth).

## [0.5.0] - 2026-07-07

### Added
- Wave C: 15 superadmin write/read tools over `/api/admin` (gated by
  `FT_ADMIN_SESSION`). Workspaces (`admin_workspaces_get|create|update|suspend|
  restore`), users + impersonation (`admin_users_get|update`, `admin_impersonate`,
  `admin_impersonate_stop`), platform plans (`admin_platform_plans_list|get|
  create|update`) and feature flags (`admin_feature_flags_list|set`).
- Destructive/sensitive admin tools carry MCP `destructiveHint` annotations and
  a confirm reminder in the description (`suspend`, `impersonate`).

## [0.4.0] - 2026-07-07

### Added
- Wave B: 24 B2B write tools over `/api/v1` — everything `ft` can do is now a
  tool. Events (`events_create|update|publish|delete`, `event_dates_delete`),
  ticket types (`ticket_types_create|delete`), sales & tickets (`sales_create|
  cancel|refund`, `tickets_checkin|resend`), memberships (`plans_create|delete`,
  `subscriptions_cancel`), venues & staff (`venues_create|delete`, `staff_create`,
  `staff_update_role`) and commerce (`discounts_create|update|delete`,
  `webhooks_create|delete`).
- MCP annotations on writes: `destructiveHint` on deletes/refunds/cancels plus a
  confirm reminder in the description.

### Deferred (contract gap — golden rule: the client never invents the contract)
- `event_dates_create/update`, `ticket_types_update`, `plans_update`,
  `venues_update`: the OpenAPI spec declares the operations but no `requestBody`.
  Logged in [CONTRACT-GAPS.md] pending a free-admin fix; not faked in the client.

## [0.3.0] - 2026-07-02

### Added
- Generated B2B client (`src/client/`) from `openapi.json` 1.4.0 — the hand-rolled
  fetch helper is gone; every tool forwards to a generated SDK function.
- Generated superadmin client (`src/admin-client/`) from `admin-openapi.json` 1.0.0
  (`openapi-ts.admin.config.ts`, `sync-openapi:admin` script).
- Wave A coverage: 27 B2B read tools (events, event dates, ticket types, sales,
  tickets access, membership plans, subscribers, discounts, webhooks, venues,
  staff, reports, exports) mirroring the `ft` CLI domains.
- Auth fallback to `~/.freeticket/config.json`: an `ft login` session now
  authenticates the MCP server — no manual `FT_API_KEY` needed.
- `FT_API_URL` accepts the base URL with or without a trailing `/api/v1`.
- Vitest suite for tool registration.

### Changed
- `admin_*` tools now use the generated admin client (behavior unchanged).

## [0.2.0] - 2026-06

### Added
- Initial scaffold: stdio server with `whoami`, `reconciliation` and read-only
  `admin_*` tools over a hand-rolled fetch helper.
