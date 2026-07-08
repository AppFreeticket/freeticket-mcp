# Changelog

All notable changes to `@freeticket/mcp` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: semver.

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
