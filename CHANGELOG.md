# Changelog

All notable changes to `@freeticket/mcp` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: semver.

## [Unreleased]

## [0.24.0] - 2026-11-12

Auth hardening against Block's MCP playbook (OAuth, minimum scopes,
short-lived tokens, no secrets in plaintext, no tokens in the model context).

### ⚠️ Breaking
- **Raw API keys are no longer accepted as Bearer on `/mcp`** (nor the
  `X-Workspace-Id` / `X-Admin-Session` headers that rode with them). They get
  401 `invalid_token`. Use OAuth, or stdio with `FT_API_KEY`. No consumer was
  found in the repos (README curl example only).
- **The superadmin cookie field is gone from the consent page**, and admin
  cookies sealed by earlier tokens are ignored: `admin_*` is no longer
  reachable over the hosted server. Use stdio with `FT_ADMIN_SESSION` until
  free-admin issues admin credentials through a device flow.
- **`customer_*` no longer take `customerSession` as an argument.** The buyer
  session is a connection credential: `X-Customer-Session` header (HTTP) or
  `FT_CUSTOMER_SESSION` (stdio). The tools are registered only when it is
  present and send only that header (never the B2B key). Same for
  `merch_orders_lookup`, `content_playback_token` and `waitlist_join`.
  `customer_membership` and `customer_subscription_cancel` now require
  `workspaceId` (it was implied by the enterprise key).
- `/mcp` without a token no longer answers 401 upfront (lazy auth, below).
  `MCP_REQUIRE_AUTH=1` restores the old behaviour.

### Changed
- Access tokens live **1 h** (were 30 days); refresh tokens 30 days (were 90),
  rotated on every use, bound to their `client_id`, and never past a 90-day
  absolute session cap. Every refresh re-validates the API key with
  free-admin (`GET /api/v1/me`): a revoked key stops refreshing
  (`invalid_grant`); free-admin down answers 503 `temporarily_unavailable`
  instead of forcing a sign-in. Stateless trade-off: a used refresh token
  cannot be invalidated, so replay is not detected (needs a store).
- An expired or unknown Bearer is a 401 `invalid_token` (it used to be served
  as if it were a raw API key, so the client never refreshed).
- stdio reads the ft CLI's multi-account config (`accounts` +
  `activeAccount`), not only the legacy top-level `apiKey`.

### Added
- OAuth scope **`read`**: a read-only connection registers only the tools
  annotated `readOnlyHint` (fail-closed: no annotation = write). Requested
  with `scope=read` (pre-ticks "Solo lectura" on free-admin's `/device`), the
  manual form's checkbox, or implied by a read-scoped API key. Advertised
  scopes: `b2b`, `read` (`admin` removed). stdio: `FT_READ_ONLY=1`.
- Lazy auth on `/mcp`: without a token it serves `public_*` and lists the B2B
  tools; calling one answers 401 + `WWW-Authenticate` (`scope="b2b"`) before
  the SDK runs, which is what makes Claude show its Connect card.
- Per-IP rate limit for anonymous traffic (`MCP_ANON_RPM`, default 120/min,
  in memory per instance) with 429 + `Retry-After`. Anonymous `GET /mcp`
  answers 405 (no SSE stream, see #29).

### Security (review of #45)
- The consent page warns about any destination that is not **exactly** a known
  callback URL (it compared hosts: `https://claude.ai/<other path>`, which
  `/register` accepts, showed no warning). For those, the registered
  `client_name` is quoted as unverified and the full URL is shown.
- The device flow starts on the user's click (`POST /device-start`), not on
  every `GET /authorize`: free-admin caps pending device flows per IP and sees
  this server's single egress IP, so ~10 anonymous page loads locked everyone
  out. Per-IP limits on `/authorize`, `/device-start` (5 per 10 min),
  `/device-token` and `/token`, plus 6 refreshes/min per refresh token.
- 429 and 408 from free-admin's `/me` on refresh are 503
  `temporarily_unavailable`, not `invalid_grant` (no forced sign-in).
- Rate limiter: IPv6 keyed by /64, at most 10k counters (oldest evicted),
  `X-Forwarded-For` trusted only on Vercel.
- A grant bound to `client_id` `""` only redeems for `""`; a token's client is
  never rebound.
- Legacy refresh tokens (no absolute end) get at most 30 more days (or 90 d
  from their `iat`), not a fresh 90 days. A refresh past its absolute end is
  `invalid_grant`.
- A request body that is not JSON answers 400 (JSON-RPC `-32700` on `/mcp`),
  not 500.

## [0.20.0] - 2026-11-03

Brings the B2B contract to **1.36.0** (superadmin 1.8.0 and public 0.10.1
unchanged in shape), emitted from free-admin `main` (80e6ce9) with
`pnpm openapi:emit*` (production was not reachable to compare). Every
operation the 0.17–0.19 tools call is in that `main` spec, so they no longer
depend on an unmerged free-admin branch. Merges `main` (0.15.3, #28): the seven
superadmin CRM reads keep #28's implementation (`admin_crm_campaigns`,
`eventIds` as an array) and the coverage sweep keeps #28's rule — operations
the contract marks `x-ft-mcp: { expose: false }` are excluded by the spec's own
reason, not duplicated in `EXCLUDED`. Replaces the open PRs #34 and #35.
One rename (see Changed). **221 tools** (B2B 185 · superadmin 30 · public 6), 49 with a
view.

### Added
- Transfers and courtesies (from #35): `sales_transfer` (destructive, not
  idempotent, open-world: voids the QR and emails the new holder),
  `sales_recipient_update` (destructive, open-world: corrects a courtesy's
  recipient, voids the QRs if the email changes and resends) and
  `event_dates_courtesy_seats` (read: blocked seats that can be issued as
  courtesies).
- Door: `tickets_checkin_undo` (destructive, idempotent, ADMIN only),
  `events_validators_list` (view) and `events_validators_add` (open-world: may
  create a STAFF account and email the invitation).
- Event viewers, read-only stats access: `events_viewers_list` (view),
  `events_viewers_add` (open-world: emails the link) and
  `events_viewers_delete` (destructive).
- Staff: `staff_access_set` (PUT, full replace of the access: destructive,
  idempotent) and `staff_resend_invite` (open-world).
- Enterprise landing merch store: `merch_catalog` and `merch_orders_lookup`
  (a POST that only reads, needs the buyer session).
- Claude plugin directory metadata: `icon` (`assets/icon.png`, 512×512 PNG)
  and `privacyPolicyUrl` (`https://appfreeticket.com/legal/privacidad`) in
  `.claude-plugin/plugin.json`; a Support and privacy section in the README.

### Changed
- **BREAKING**: `admin_crm_campaigns_list` is now `admin_crm_campaigns`
  (#28's name wins the merge). Agents or skills that call the old name get
  "tool not found".
- `openWorldHint` corrected to `true` on writes that leave FreeTicket through
  free-admin: `staff_create` (emails the invitation), `subscriptions_cancel`
  and `customer_subscription_cancel` (cancel the recurring charge in Stripe /
  Mercado Pago) and `admin_workspaces_assign_plan` (cancels the tenant's Stripe
  subscription first). "Leaves FreeTicket" now explicitly covers payment
  gateways and outbound email (`write()` in `src/tool-meta.ts`).
- Tests: `readOnlyHint` is checked against the HTTP methods each tool calls in
  the spec (POST reads allowlisted with a reason), the destructive set is exact
  across B2B and superadmin, excluded or `expose: false` operations are banned
  from every tool file, and the request of five multi-id/header tools is
  asserted end to end against a fake `fetch`.

### Not exposed (excluded with a reason in `src/coverage.test.ts`)
- `POST /merch/orders` (landing checkout with the buyer's ID document and a
  stock hold) and `POST /merch/orders/{code}/payment/card` (charges a Brick
  card token), on the same grounds as the ticket landing checkout.

## [0.19.0] - 2026-11-03

Brings the B2B contract to **1.32.0** (superadmin 1.8.0 and public 0.10.1
unchanged): lots 4 (1.31.0) and 5 (1.32.0) of the dashboard parity. The spec
comes from free-admin commit `1ceb2ea` on branch
`claude/funny-albattani-iz4k0r` (PR AppFreeticket/free-admin#1169), **not yet
merged to `main` nor deployed**: these tools answer 404 against production
until that PR ships. Additions only. **208 tools** (B2B 172 · superadmin 30 ·
public 6), 48 with a view.

### Added
- On-demand videos (Mux): `content_videos_update`,
  `content_videos_set_published` (open-world: publishing notifies members),
  `content_videos_set_series` and `content_videos_delete` (destructive,
  open-world: deletes the Mux asset). Uploading stays in the dashboard.
- Video series: `content_series_list` (view), `content_series_create`,
  `content_series_update`, `content_series_set_published` and
  `content_series_delete` (destructive; its videos are left loose).
- Live streams (Mux): `content_lives_create`, `content_lives_update`,
  `content_lives_reset_key` (destructive: the old key dies at once),
  `content_lives_delete` (destructive) and `content_lives_chat` (personal
  data). The three Mux calls are open-world.
- Website and profile: `website_get`, `website_put`, `website_set_published`,
  `organization_profile_get`, `organization_profile_update`,
  `organization_update` and `organization_analytics_update` (GA4).
  `website_put` is a **full replacement** (every `null` wipes a field, and
  five of its columns are shared with the profile), so it is annotated
  destructive and asks for confirmation although the contract does not flag
  it `x-ft-destructive`.
- Ticket templates: `ticket_templates_list` (view), `ticket_templates_create`,
  `ticket_templates_update`, `ticket_templates_delete` (destructive) and
  `ticket_templates_instantiate` (creates a ticket type on a date from a
  template).
- Box-office QR codes: `master_qrs_list` (view), `master_qrs_create`,
  `master_qrs_update`, `master_qrs_set_active` and `master_qrs_delete`
  (destructive).

### Security
- Secrets in results: `content_lives_create` / `content_lives_reset_key`
  return the live's `streamKey`, and `master_qrs_list` / `_create` /
  `_update` return the QR `code` and `url`. Their descriptions mark the value
  as SECRET: the agent must not echo it into the chat or docs unless the
  human explicitly asks, nor paste it in shared places. The server keeps no
  log or store of tool results (stateless HTTP transport; stderr only gets
  transport errors), so the value lives only in the client's transcript.

## [0.18.0] - 2026-11-03

Brings the B2B contract to **1.30.0** (superadmin 1.8.0 and public 0.10.1
unchanged). The spec comes from free-admin commit `e97f2e5` on branch
`claude/funny-albattani-iz4k0r` (PR AppFreeticket/free-admin#1169), **not yet
merged to `main` nor deployed**: these tools answer 404 against production
until that PR ships. Additions only. **177 tools** (B2B 141 · superadmin 30 ·
public 6), 45 with a view.

### Added
- Digital products and courses: `products_list` (view), `products_get`,
  `products_create`, `products_update`, `products_set_status` (idempotent)
  and `products_delete` (destructive, soft delete with no restore). The
  POST/PATCH input models the contract's nested course tree as is
  (modules → lessons → resources / quiz). `products_update` with `modules`
  **replaces the whole tree** (whatever the list leaves out is deleted with
  buyers' progress), so it carries `destructiveHint`, and `openWorldHint`
  because new lessons on a published course notify buyers. Files and lesson
  videos cannot be uploaded through the API: they must be uploaded in the
  dashboard first and referenced by path/id.
- Skill `course-builder`.

## [0.17.0] - 2026-11-03

Brings the B2B contract to **1.29.0** (superadmin 1.8.0 and public 0.10.1
unchanged). The spec comes from free-admin commit `318278a` on branch
`claude/funny-albattani-iz4k0r` (PR AppFreeticket/free-admin#1169), **not yet
merged to `main` nor deployed**: these tools answer 404 against production
until that PR ships. Additions only. **171 tools** (B2B 135 · superadmin 30 ·
public 6), 44 with a view.

### Added
- Show day: `reports_live_attendance` (dates happening now with check-in
  progress), `event_dates_access_close_status` and
  `event_dates_access_close_sign` (freezes the check-in count as the official
  record and emails it; destructive, open-world, sends `confirm: true`).
- Payments: `sales_payment_intents` (checkout funnel and abandoned journeys of
  one event) and `sales_abandon` (PENDING sale with no payment started →
  ABANDONED, releases stock; destructive).
- Community posts and comments: `content_posts_update`, `content_posts_pin`,
  `content_posts_delete` and `content_comments_delete` (destructive).
- Community channels: `content_channels_list`, `content_channels_create`,
  `content_channels_update`, `content_channels_reorder`,
  `content_channels_archive` (destructive: no unarchive).
- Community moderation: `content_moderation_queue`, `content_moderation_bans`,
  `content_member_posts_list`, `content_comments_hide`,
  `content_comments_unhide`, `content_comments_ignore_reports`,
  `content_member_posts_approve`, `content_member_posts_reject` and
  `content_member_posts_remove` (destructive), `content_members_ban`
  (destructive) and `content_members_unban`.
- Community meetups: `content_meetups_list`, `content_meetups_get`,
  `content_meetups_create`, `content_meetups_update`,
  `content_meetups_publish` (open-world: queues an email to the whole
  community), `content_meetups_cancel` (destructive, open-world),
  `content_meetups_rsvp_review` (open-world) and `content_meetups_attendance`.
- Skill `community-moderation`.

### Changed
- Skill `show-day-close` uses `reports_live_attendance`, the access-close
  status (signing only on explicit human request) and `sales_payment_intents`
  for stuck payments.
- `src/tools/b2b-writes.test.ts` checks every operation flagged
  `x-ft-destructive`, including the previously missing
  `presale_windows_delete`.

## [0.16.0] - 2026-11-03

Brings all three contracts in line with free-admin `main`: B2B 1.20.0 →
**1.27.0**, superadmin 1.5.1 → **1.8.0**, public 0.9.1 → **0.10.1**. The specs
were taken from free-admin's committed `openapi.json`, `admin-openapi.json`
and `public-openapi.json` at `main` (cb33afb), not from production, which may
lag. Additions only. **138 tools** (B2B 102 · superadmin 30 · public 6), 37
with a view.

### Added
- Scheduling: `events_schedule` (`publishAt` auto-publishes a draft;
  `saleStartsAt` publishes now and opens sales later) and `events_unschedule`.
- Lineup: `artists_search`, `events_artists_set` (replaces the whole ordered
  lineup and emails new artists; destructive, open-world),
  `events_artists_delete`, `event_artist_invitations_list`,
  `event_artist_invitations_resend` (open-world) and
  `event_artist_invitations_cancel`.
- Member presales: `presale_windows_list`, `presale_windows_create`,
  `presale_windows_update`, `presale_windows_delete` (destructive, as the
  contract's `x-ft-destructive` says).
- Landing waitlist: `waitlist_join` (enterprise key, optional buyer session)
  and `waitlist_list`.
- **Claude plugin and marketplace.** `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` (plugin at the repo root) and `.mcp.json`
  pointing at the remote server over OAuth. Install with
  `/plugin marketplace add AppFreeticket/freeticket-mcp` and
  `/plugin install freeticket@freeticket`. Two skills: `publish-event` and
  `show-day-close`. `src/plugin.test.ts` keeps the manifest version equal to
  `package.json`, the names in step, and every tool a skill names registered.

### Changed
- `events_update` reaches every field of the contract's `EventUpdate`:
  `slug`, `squareImageUrl`, `storyImageUrl`, `pulepCode`, `listedOnPortal`,
  `genre`, `subgenre`, `genreOther`, `audience`.
- `event_dates_create` / `event_dates_update` take `streamType` and
  `maxPerCustomer`; the update also takes `status`.
- `ticket_types_create` / `ticket_types_update` take `saleStartsAt`,
  `saleEndsAt` and `seatsioCategoryKey`.
- `staff_update_role` accepts the new `MERCH_MANAGER` role.
- The seven superadmin CRM master reads came with 0.15.3 (#28); this
  release keeps that implementation and does not add a second one.

## [0.15.3] - 2026-11-01

Superadmin contract 1.5.1 → **1.7.0** (CRM master). Additions only.
**124 tools** (B2B 88 · superadmin 30 · public 6).

### Added
- Superadmin, CRM master reads: `admin_crm_campaigns`,
  `admin_crm_campaigns_get`, `admin_crm_audience_preview` (counts the audience
  of a filter and returns a server-masked sample; creates and sends nothing),
  `admin_crm_quota`, `admin_crm_options`, `admin_crm_events` and
  `admin_crm_event_dates`. Each one is registered with `read()`.
- The coverage sweep reads `x-ft-mcp: { expose: false, reason }` from the
  spec: those operations count as excluded with the contract's own reason,
  and the test fails if any tool calls them.

### Not exposed
- CRM master writes: `POST /crm/campaigns`,
  `/crm/campaigns/{id}/batches/next`, `/crm/campaigns/{id}/batches/stop` and
  `/crm/campaigns/{id}/cancel`. They send real messages to buyers; they stay
  in the CLI (`ft admin crm`) and the panel.

## [0.15.2] - 2026-11-01

### Changed
- Directory annotations are declared where the tool is registered, through `read()` and `write()` in `src/tool-meta.ts`. The post-registration pass that inferred a write from a missing `destructiveHint` and filled `openWorldHint` from a name list is gone. The wire result is the same: every tool still publishes the three booleans, and only refunds, ticket emails and the public checkout preference are open-world.

## [0.15.1] - 2026-11-01

### Fixed
- Every tool publishes `readOnlyHint`, `destructiveHint` and `openWorldHint` as booleans. Reads stay inside FreeTicket (`openWorldHint: false`). The only open-world writes are `sales_refund` (Mercado Pago), `tickets_resend`, `public_tickets_resend` (email) and `public_orders_create` (a Mercado Pago preference). Omitting `openWorldHint` on the other writes made the ChatGPT tool scan reject them.

## [0.15.0] - 2026-10-20

Brings all three contracts in line with production: B2B 1.7.0 → **1.20.0**,
superadmin 1.3.0 → **1.5.1**, public 0.4.0 → **0.9.1**. Additions only.
**117 tools** (B2B 88 · superadmin 23 · public 6).

### Added
- B2B: `events_cancel` (keeps the record and its sales; destructive),
  `sales_attempts` (payment attempt history), `tickets_reassign` (move a sold
  ticket to another date or type), `staff_get`, `staff_delete` (revokes access
  to the workspace; destructive), `webhooks_update` (edits without rotating
  the secret), `settlements_get`, `content_posts_create`, `workspaces_create`.
- Members area: `customer_order_pending`, `customer_order_get` and
  `customer_order_release` (destructive), on the same `X-Customer-Session`
  credential as the rest of `customer_*`.
- Superadmin: `admin_workspaces_plan_get` and `admin_workspaces_delete`
  (soft delete; destructive).
- `customer_subscription_cancel` takes an optional `workspaceId`, which the
  contract requires when no enterprise key is present.

### Changed
- `ticket_types_create`: `currency` is the contract enum (`COP`), defaulting
  to it, instead of a free string.
- The coverage sweep matches each spec only against the tools of its own
  client. A merged source let the admin `postWorkspaces` mask v1's
  `POST /workspaces`, which had no tool.

### Not exposed (excluded with a reason in `src/coverage.test.ts`)
- `POST /auth/signup` and the buyer device grant
  (`/customer/auth/request`, `/customer/auth/verify`): credential bootstrap,
  not tools.
- The landing-page headless checkout: `/customer/purchase-sessions*`,
  `POST /customer/orders`, `/customer/orders/{id}/payment{,/card,/pse}`. Each
  step needs a browser (seats.io chart, Brick/Bold widget, returnUrl
  allowlist); agents buy through `public_orders_create`.

### Also in this release (merged since 0.14.0)

#### Added
- `GET /.well-known/openai-apps-challenge` serves the OpenAI plugin directory's
  domain-verification token as plain text, read from `OPENAI_APPS_CHALLENGE`
  and trimmed (a value pasted into a dashboard field usually arrives with a
  trailing newline, and the portal compares bytes). The token lives in the
  deployment, never in the repo: a committed challenge is one anybody can serve
  from a fork. With nothing configured the path answers 404 naming the variable
  to set, rather than inventing a value that would verify and prove nothing.

#### Changed
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
