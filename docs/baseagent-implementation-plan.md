# Superseded: TypeScript BaseAgent Implementation Plan

This plan has been superseded by the approved Python-first MCP architecture. The prior TypeScript `packages/agent-sdk` prototype was uncommitted and has been removed. The active design is documented in the [Python-first MCP rewrite plan](./python-mcp-baseagent-rewrite-plan.md), while the implemented result and validation evidence are documented in the [Python MCP BaseAgent implementation record](./python-mcp-baseagent-implementation.md).

The rewrite keeps the framework’s BaseAgent contract but makes Python authoritative for the reasoning-agent runtime. TypeScript now routes requests to the Python service through standard MCP Streamable HTTP.[1] [2]

## References

[1]: /home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf "Agent-Assisted Design Framework Systems Design, updated, p. 50, lines 4–14"
[2]: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports "Model Context Protocol specification: transports"
