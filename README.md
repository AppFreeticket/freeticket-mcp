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

## Tools

**B2B `/api/v1`** (un tool = una operación del contrato; hoy todos los reads):

| Dominio | Tools |
|---|---|
| Sesión | `whoami` |
| Eventos | `events_list` · `events_get` · `event_dates_list` |
| Tickets | `ticket_types_list` · `ticket_types_get` · `tickets_access` |
| Ventas | `sales_list` · `sales_get` · `sales_tickets` |
| Membresías | `plans_list` · `plans_get` · `plans_subscribers` |
| Comercial | `discounts_list` · `webhooks_list` · `venues_list` · `venues_get` · `staff_list` |
| Reportes | `reports_summary` · `reports_by_event` · `reports_timeseries` · `reports_inventory` · `reconciliation` |
| Exports | `reports_export_buyers` · `reports_export_attendees` · `reports_export_subscribers` · `reports_export_reconciliation` |

**Superadmin `/api/admin`** (solo con `FT_ADMIN_SESSION`): `admin_whoami` ·
`admin_workspaces` · `admin_users` · `admin_audit_log`.

Writes B2B (crear/editar/publicar, checkin, refund) y writes admin llegan en las
próximas olas — ver el roadmap del paraguas.

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
