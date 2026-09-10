# Agents for the `mcp` repo

Claude Code subagents for building and maintaining FreeTicket's MCP server.

| Agent | When to use it |
|---|---|
| [`mcp-tool-author`](./mcp-tool-author.md) | Add a new tool from an operation the OpenAPI contract already exposes. |
| [`mcp-reviewer`](./mcp-reviewer.md) | Review a change under `src/` before merging: schemas, errors, security. |

To synchronize the clients with the backend's contracts, use the `contract-sync`
agent from the `ai-native` umbrella (one level up). To request an endpoint no
contract exposes yet, use its `endpoint-requester`.
