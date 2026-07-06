# Agentes del repo `mcp`

Subagentes de Claude Code para construir y mantener el servidor MCP de FreeTicket.

| Agente | Cuándo usarlo |
|---|---|
| [`mcp-tool-author`](./mcp-tool-author.md) | Agregar un tool nuevo a partir de una operación del contrato OpenAPI. |
| [`mcp-reviewer`](./mcp-reviewer.md) | Revisar un cambio en `src/` antes de mergear: schemas, errores, seguridad. |

Para sincronizar el cliente con el contrato del backend, usá el agente
`contract-sync` del paraguas `ai-native` (un nivel arriba).
