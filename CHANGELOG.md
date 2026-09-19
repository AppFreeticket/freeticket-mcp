# Changelog

All notable changes to `@freeticket/mcp` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: semver.

## [Unreleased]

### Added
- `GET /.well-known/openai-apps-challenge` serves the OpenAI plugin directory's
  domain-verification token as plain text, read from `OPENAI_APPS_CHALLENGE`
  and trimmed (a value pasted into a dashboard field usually arrives with a
  trailing newline, and the portal compares bytes). The token lives in the
  deployment, never in the repo: a committed challenge is one anybody can serve
  from a fork. With nothing configured the path answers 404 naming the variable
  to set, rather than inventing a value that would verify and prove nothing.

### Changed
- **Connecting your account connects all of your workspaces.** The consent page
  used to end on a picker when the account reached more than one workspace —
  "choose the one this connection is about" — and the chosen id was sealed into
  the token, so every read afterwards saw a single tenant. The picker is gone:
  the token seals no workspace, and the read tools that list widen to every
  workspace the credential reaches, each row tagged with `workspaceId` /
  `workspaceName`. `workspace` is still there, but it now *narrows* rather than
  widens, and `limit` is split across the workspaces queried so a fan-out
  returns what was asked for instead of `limit` rows per tenant.
- A session pinned on purpose keeps its old behaviour, and pinning is what deep
  pagination needs: a fan-out carries no `page`, because no single cursor means
  anything across tenants. Pin with the `X-Workspace-Id` header, the
  `FT_WORKSPACE_ID` env var, or the workspace field of the consent page's
  advanced form. Writes are unchanged: with nothing pinned they land on the
  account's default workspace, which is what `/api/v1` does when the header is
  absent.
- `staff_list` widens the same way, through the contract's own `workspaceIds`
  (one call, rows tagged by the backend) rather than a fan-out — so it is
  capped at the 25 workspaces the contract accepts.
- `reports_summary` still refuses to aggregate (KPIs are an object, not rows),
  but it now takes a single `workspace` id, so an agent can ask for a tenant
  that is not the account's default one.
- **Event lists render as cards, not as a table.** The view picked its render
  from the payload shape alone, so `public_events_list` came out as a grid of
  whatever keys the API serialised first — the cover URL as a text column and
  the event name scrolled off screen. Rows that look like an event (a name plus
  a slug, cover, city or date) now render as a card: cover, name, city · date,
  price from in the event currency. Everything else keeps the table. The price
  and date are read from a list of field names, because production has served
  `buyerTotalFrom` where the committed contract says `priceFrom`.
- The view resource declares `img-src: https:` — the only remote thing it loads
  is an event cover, and those live on each organizer's storage domain. A cover
  the host refuses drops out and the card stays.
- **The table now orders its columns by what a person reads first**, not by the
  order the API serialised the object. A ranked list of field names puts the
  event, the ticket type, the buyer and the reference ahead of the numbers, and
  ids, urls and long prose never take a column at all — they were what pushed
  the name of the thing off the right edge. A row made of nothing but ids still
  renders. Every list gains this at once: sales, staff, subscribers, discounts.
- **Capacity rows render as bars**: any row with a `capacity` and a `sold` —
  `reports_inventory`, ticket types — becomes one meter per event/ticket type
  with the percentage, instead of four number columns to compare by eye. The
  meter also reads `checkedIn`/`attendees` and draws it first, which is the
  number the door asks for; no endpoint serves it yet (ledger: attendance).

## [0.14.0] - 2026-09-02

Brings all three contracts in line with what free-admin already serves: B2B
1.5.0 → **1.7.0**, superadmin 1.1.0 → **1.3.0**, public 0.3.0 → **0.4.0**.
Closes six gaps from the umbrella ledger in one pass (#355, #356, #381, #382,
#383, #403). **103 tools** (B2B 76 · superadmin 21 · public 6).

### Added
- **The full members area** (contract 1.7.0, issue #355): `customer_ticket_get`,
  `customer_membership`, `customer_profile`, `customer_ticket_cancel`,
  `customer_subscribe` (returns the payment URL — the agent never charges),
  `customer_subscription_cancel`, `customer_profile_update`, `customer_logout`.
  Same double credential as `customer_me`: an enterprise API key plus
  `X-Customer-Session`.
- **Organization content** (#356): `content_videos`, `content_posts`,
  `content_lives`, `content_live_get` and `content_playback_token` (a signed
  token, 30 min live / 1 h video; `memberOnly` requires a buyer with a membership).
- **Settlement receipts** (#381): `settlements_document` and `settlements_proof`.
  The API answers 302 to a 5-minute signed URL, so they use a raw fetch
  (`redirect: "manual"`) and return the link — following the redirect would drop
  the whole PDF into the model's context.
- `admin_workspaces_assign_plan` (#383): an assisted sale, activating a tier
  without going through Stripe self-service. `admin_workspaces_update` gains
  `webTemplate`, `customDomain` and `customDomainVerifiedAt`.
- `events_list` accepts `q`, `status` (filtered in the query, so `limit` counts
  returned rows) and `withTotal` (adds `page.total`, opt-in).
- `sales_cancel` and `sales_refund` expose the flags the contract now demands:
  `acknowledge_open_payment` and `acknowledge_manual`.
- An MCP Apps view on the 4 new lists: **29 tools with a view**.

### Changed
- `staff_list` in global mode uses the contract's `workspaceIds` (#382): **one
  single call** with rows tagged by the backend, instead of a fan-out of N
  requests. The other lists still fan out — the contract exposes no aggregation
  for them.
- `GET /me` now carries the **effective role and sections per workspace**
  (`WorkspaceAccess`, #403); `Me.role` is deprecated in the contract.
  Enforcement belongs to the backend: the MCP can no longer operate a workspace
  with a role the panel restricts. The global fan-out additionally **discards
  before firing** the workspaces with `sections: []` (expired or revoked
  access), instead of discovering them by collecting 403s in `errors[]`.

## [0.13.0] - 2026-08-05

### Added
- `customer_me` and `customer_tickets` (GET /customer/me, GET /customer/tickets):
  the enterprise headless SSO, the last hole left in the B2B contract. They need
  an enterprise service API key plus the buyer's session token
  (`X-Customer-Session`). The exchange that issues that token stays out of the
  MCP: it mints third-party sessions.
- An MCP Apps view on 8 lists that were coming out as plain text:
  `public_events_list`, `event_dates_list`, `customer_tickets`,
  `admin_workspaces`, `admin_users`, `admin_audit_log`,
  `admin_platform_plans_list`, `admin_feature_flags_list`. That makes 25 tools
  with a view — every list and every report.
- `src/coverage.test.ts`: a contract sweep. Every operation of the three specs
  either has a tool or is excluded with its reasoning; if `sync-openapi` pulls a
  new endpoint and nobody writes it a tool, the test fails with its method and
  path. The deliberate exclusions (device flow, minting credentials, session
  exchange) are documented next to the test.
- Real jsdom tests of the view: the HTML is mounted and host messages are pushed
  at it. They cover the table, the tiles, the `{ data }` envelope, the error
  state, escaping of API payloads, the handshake, teardown and the brand
  invariants. Before, the only check was that the string contained certain
  substrings.

### Fixed
- **The host's theme can no longer override the branding.** `applyTheme` accepts
  only the extension contract's variables (`--color-*`, `--font-*`); the
  FreeTicket accent is out of its reach. The header shows the real logo from
  `brand.ts` instead of a little CSS square.
- On a theme change the view sets `color-scheme` as well as `data-theme`.
  Without that, `light-dark()` followed the operating system and the view
  rendered light inside a dark chat.
- The view validates `event.source`: it only processes messages from the frame
  that mounted it. Any other frame could inject a fake `tool-result`, and the
  user would have seen data that did not come from FreeTicket.
- The view answers `ui/resource-teardown` so the host unmounts the iframe
  cleanly, and shows a state when it receives `ui/notifications/tool-input`.
- Currency is formatted with the host's locale when it declares one (previously
  always `es-CO`).

## [0.12.0] - 2026-08-03

### Added
- **MCP Apps (`io.modelcontextprotocol/ui`, spec 2026-01-26)**: the server
  publishes the `ui://freeticket/view.html` resource (mimeType
  `text/html;profile=mcp-app`) and 17 read tools declare it in
  `_meta.ui.resourceUri`. A single self-contained view renders a **table** for
  lists and **KPI tiles** for objects, with currency formatting, status pills
  and adoption of the host's theme. Results now also travel in
  `structuredContent` (`{ data }`), which is what the view consumes. Hosts
  without the extension ignore `_meta` and keep seeing the text.
- `settlements_list` (GET /settlements) and `reports_financials`
  (GET /reports/financials): organizer settlements and the per-date financial
  breakdown — the authoritative numbers from the Settlements panel.
- `api_keys_list` (GET /api-keys) and `admin_tokens` (GET /api/admin/tokens):
  credential auditing. Minting and revoking stay with the CLI on purpose.
- Wave B completed: `event_dates_create`, `event_dates_update`,
  `ticket_types_update`, `plans_update`, `venues_update`. Contract 1.5.0 now
  declares their `requestBody`, so the schemas come from the spec.

### Changed
- Contracts synchronized: B2B `1.5.0`, admin `1.1.0`, public `0.3.0`.
- `plans_create` includes `sortOrder` (it became required in the contract).

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
- **Public B2C (`/api/public`)**: 6 anonymous `public_*` tools (no credentials)
  for a buyer's agent — `public_events_list|get|availability` (discovery),
  `public_orders_create` (creates the order and returns the Mercado Pago
  `checkoutUrl`; the agent never touches the payment) + `public_orders_get`
  (status + tickets once paid), and `public_tickets_resend`. Client generated
  from the third contract (`public-openapi.json` 0.3.0 → `src/public-client/`,
  `sync-openapi:public`, `openapi-ts.public.config.ts`).
- Credential-based layers in `buildServer`: `public_*` tools are registered
  **always**; B2B only with an `apiKey`; `admin_*` only with an `adminSession`.
  The HTTP server serves the public set **anonymously** (no Bearer, 200) and
  adds the authenticated layers once a token arrives.

### Changed
- `Creds.apiKey` is now optional: with no credential the server starts in
  anonymous mode (B2C only) instead of failing. The stdio entrypoint no longer
  aborts without a key.

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
