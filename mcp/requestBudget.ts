export const MAX_MCP_REQUEST_BYTES = 512 * 1024;

export class McpRequestBudgetError extends Error {
  readonly code = "request_too_large" as const;

  constructor() {
    super(
      `The complete MCP tool request may not exceed ${MAX_MCP_REQUEST_BYTES} UTF-8 JSON bytes. Split the change into smaller coherent calls.`,
    );
    this.name = "McpRequestBudgetError";
  }
}

export function assertMcpRequestBudget(request: object): void {
  if (
    Buffer.byteLength(JSON.stringify(request), "utf8") >
    MAX_MCP_REQUEST_BYTES
  ) {
    throw new McpRequestBudgetError();
  }
}
