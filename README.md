# @freeticket/mcp

FreeTicket's official **MCP** (Model Context Protocol) server. It exposes the
B2B domain — events, dates, sales, tickets, memberships, venues, staff, reports
— as _tools_ to any MCP client (Claude Code, Claude Desktop, claude.ai).

Same contract and same session as the `ft` CLI: if you have run `ft login`, the
MCP is already authenticated with nothing to configure (it reads
`~/.freeticket/config.json`).

## Use (Claude Code / Claude Desktop)

```jsonc
{
  "mcpServers": {
    "freeticket": {
      "command": "npx",
      "args": ["-y", "@freeticket/mcp"]
      // No env: uses the `ft login` session. For CI or headless:
      // "env": { "FT_API_KEY": "ft_live_...", "FT_WORKSPACE_ID": "ws_..." }
    }
  }
}
```

> ⚠️ `@freeticket/mcp` is **not published on npm yet**, so this stdio entry does
> not work today — `npx` cannot resolve the package. Use the remote server
> below until it ships.

Config precedence: env > `~/.freeticket/config.json` > default. Variables:
`FT_API_URL` (base, without `/api/v1`), `FT_API_KEY`, `FT_WORKSPACE_ID`,
`FT_ADMIN_SESSION` (enables the `admin_*` tools of the superadmin contract
`/api/admin`).

## Remote use over URL (HTTP)

Beyond stdio, the server runs over **Streamable HTTP** so it can be added as a
connector by URL (claude.ai, remote Claude Code, curl) with nothing installed
locally. It is live at `https://mcp.appfreeticket.com/mcp`.

```bash
freeticket-mcp-http          # listens on :3333 (PORT to change it)
```

It is **stateless**: every request carries its own credentials and the server
builds per-session isolated clients (it never reads disk), so one process serves
many workspaces without crossing sessions. Endpoints:

| Endpoint | Auth | Tools |
|---|---|---|
| `POST /mcp` | Bearer (OAuth token or raw API key) | `public_*` + B2B (+ `admin_*` when the credential carries it) |
| `POST /mcp/public` | none | `public_*` only (buyer-side agents) |

### Connecting from claude.ai (Add custom connector)

The server ships an **embedded OAuth 2.1 authorization server** — that is the
only thing claude.ai knows how to speak (it cannot send API keys or custom
headers). Steps:

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. Remote MCP server URL: `https://mcp.appfreeticket.com/mcp`. Client ID and
   Secret: leave empty (it uses dynamic client registration, RFC 7591).
3. Connecting opens the consent page: the **"Continue with FreeTicket"** button
   signs you into free-admin with your usual account and asks for approval
   (device flow, RFC 8628 — the same backend as `ft login`). No keys to paste,
   and no workspace to pick: the connection reaches **every workspace your
   account does**. Under "Advanced options" there is still the manual form (an
   API key for CI, the superadmin cookie for the `admin_*` tools, and a
   workspace field if you want this connection tied to a single tenant).
4. Credentials are sealed (AES-256-GCM, `MCP_TOKEN_SECRET`) inside the issued
   token — the server persists nothing: no database, multi-tenant safe.

The full standard flow: RFC 9728/8414 discovery → `/register` → `/authorize`
(PKCE S256) → `/token` (with refresh). `FT_OAUTH_ISSUER` delegates all of it to
an external AS (for instance, once `free-admin` publishes its own).

### Direct auth (curl, your own clients)

```bash
curl -X POST http://localhost:3333/mcp \
  -H 'authorization: Bearer ft_live_...' \      # raw API key
  -H 'x-workspace-id: ws_...' \                 # optional — pins it to one workspace
  -H 'x-admin-session: <cookie>' \              # optional — enables admin_*
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Deploying on Vercel

The repo already carries `vercel.json` + `api/server.ts` (the same logic as the
binary, as a Vercel Function):

```bash
vercel                                        # preview
vercel env add MCP_TOKEN_SECRET production    # openssl rand -hex 32
vercel --prod
```

Env on Vercel: `MCP_TOKEN_SECRET` (**required** — without it tokens die on every
cold start), `FT_API_URL` (optional, defaults to production), `MCP_PUBLIC_URL`
(optional — derived from the Host header). The resulting connector URL is
`https://<project>.vercel.app/mcp`.

## Tools

**B2B `/api/v1`** (one tool = one contract operation). Destructive writes
(`*_delete`, `*_refund`, `*_cancel`) carry `destructiveHint` and ask for
confirmation.

| Domain | Reads | Writes |
|---|---|---|
| Session | `whoami` | — |
| Events | `events_list` · `events_get` · `event_dates_list` | `events_create` · `events_update` · `events_publish` · `events_delete` · `event_dates_create` · `event_dates_update` · `event_dates_delete` |
| Tickets | `ticket_types_list` · `ticket_types_get` · `tickets_access` | `ticket_types_create` · `ticket_types_update` · `ticket_types_delete` · `tickets_checkin` · `tickets_resend` |
| Sales | `sales_list` · `sales_get` · `sales_tickets` | `sales_create` · `sales_cancel` · `sales_refund` |
| Memberships | `plans_list` · `plans_get` · `plans_subscribers` | `plans_create` · `plans_update` · `plans_delete` · `subscriptions_cancel` |
| Commercial | `discounts_list` · `webhooks_list` · `venues_list` · `venues_get` · `staff_list` | `discounts_create` · `discounts_update` · `discounts_delete` · `webhooks_create` · `webhooks_delete` · `venues_create` · `venues_update` · `venues_delete` · `staff_create` · `staff_update_role` |
| Reports | `reports_summary` · `reports_by_event` · `reports_timeseries` · `reports_inventory` · `reports_financials` · `reconciliation` | — |
| Settlements | `settlements_list` · `settlements_document` · `settlements_proof` | — |
| Credentials | `api_keys_list` | — |
| Exports | `reports_export_buyers` · `reports_export_attendees` · `reports_export_subscribers` · `reports_export_reconciliation` | — |
| Members area (headless SSO) | `customer_me` · `customer_tickets` · `customer_ticket_get` · `customer_membership` · `customer_profile` | `customer_ticket_cancel` · `customer_subscribe` · `customer_subscription_cancel` · `customer_profile_update` · `customer_logout` |
| Content | `content_videos` · `content_posts` · `content_lives` · `content_live_get` | `content_playback_token` |

Minting and revoking credentials (`ft api-keys`, `ft admin tokens`) is left out
of the MCP on purpose: an agent lists credentials to audit them, it does not
issue them. The `customer_*` tools are for enterprise integrations: they need an
enterprise service API key **and** the buyer's session token
(`X-Customer-Session`). The exchange that issues that token is not a tool
either — it mints third-party sessions.

`settlements_document` and `settlements_proof` return a **signed URL with a
5-minute TTL**, not the file: the API answers 302, and following the redirect
would drop the whole PDF into the model's context.

The content tools list what is published without the playback id; to play
anything you need `content_playback_token` (30 min live, 1 h video), and
`memberOnly` content additionally requires a buyer session with a membership.

**Public B2C `/api/public`** (no credentials — a buyer's agent):

| Domain | Tools |
|---|---|
| Discovery | `public_events_list` · `public_events_get` · `public_events_availability` |
| Checkout | `public_orders_create` (→ a Mercado Pago `checkoutUrl`) · `public_orders_get` |
| Post-sale | `public_tickets_resend` |

The `public_*` tools are **always** registered (anonymous). The agent never
touches the payment: `public_orders_create` returns the Mercado Pago link for
the human to pay. Checkout scope: general admission (not seated, not
members-only).

**Superadmin `/api/admin`** (only with `FT_ADMIN_SESSION`):

| Domain | Tools |
|---|---|
| Session / audit | `admin_whoami` · `admin_audit_log` · `admin_tokens` |
| Workspaces | `admin_workspaces` · `admin_workspaces_get` · `admin_workspaces_create` · `admin_workspaces_update` (includes `webTemplate` / `customDomain`) · `admin_workspaces_assign_plan` · `admin_workspaces_suspend` · `admin_workspaces_restore` |
| Users | `admin_users` · `admin_users_get` · `admin_users_update` · `admin_impersonate` · `admin_impersonate_stop` |
| Platform plans | `admin_platform_plans_list` · `admin_platform_plans_get` · `admin_platform_plans_create` · `admin_platform_plans_update` |
| Feature flags | `admin_feature_flags_list` · `admin_feature_flags_set` |

## UI in the host (MCP Apps)

The server implements the **`io.modelcontextprotocol/ui`** extension
([MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps), spec
`2026-01-26`), so lists and reports do not arrive as a wall of JSON: the host
draws them.

- Resource: `ui://freeticket/view.html`, mimeType `text/html;profile=mcp-app`.
- Tools with a view point at it through `_meta.ui.resourceUri`; the result also
  travels in `structuredContent` so the view can read it.
- A single view picks the render from the shape of the payload: **array → table**
  (currency formatting, status pills, horizontal scroll), **object → KPI tiles**.
- The HTML is self-contained: no external scripts, no fetch, no remote fonts. It
  declares `csp: {}` — it asks for no network, so the host's deny-by-default
  sandbox has nothing to block.
- **The brand is ours, the theme is the host's.** The view adopts the host's CSS
  variables (`hostContext.styles.variables`) to blend into the chat, but only
  those in the extension's contract (`--color-*`, `--font-*`): the FreeTicket
  logo and brand accent are not overridable. On a theme change it sets
  `data-theme` **and** `color-scheme`, otherwise `light-dark()` would follow the
  OS and the view would render light inside a dark chat.
- It listens only to the frame that mounted it (`event.source`), reports its
  height with `ui/notifications/size-changed`, formats currency in the host's
  locale, and answers `ui/resource-teardown` so unmounting is clean.
- Hosts without the extension (or terminal clients) ignore `_meta` and see the
  same text as always: nothing breaks.

**29 tools with a view** (v0.14.0) — every list and every report. Details
(`*_get`) and writes deliberately have none: a lone object or a `delete`
acknowledgement gains nothing from a table, and drawing one suggests there is
data where there is not. `src/ui.test.ts` mounts the real view in jsdom and
fails if a new list registers without `_meta.ui`, if the host manages to
override the branding, or if an API payload renders unescaped.

## Development

```bash
pnpm install
pnpm generate     # regenerates src/client/, src/admin-client/ and src/public-client/ from the specs
pnpm dev          # runs the server over stdio
pnpm typecheck && pnpm test
```

Contracts this build targets: B2B **1.7.0**, superadmin **1.3.0**, public
**0.4.0**. All three are served by `free-admin` and are the only source of
truth, on separate semver lineages. To propagate a backend change, use the
`contract-sync` agent from the
[ai-native](https://github.com/AppFreeticket/ai-native) umbrella — and check for
drift first: what free-admin serves today may already be ahead of the numbers
above.

MIT.
