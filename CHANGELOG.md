# Changelog

All notable changes to `@freeticket/mcp` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: semver.

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
