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
  // MCP arguments are JSON values, with undefined optional object fields
  // added by the handler. Count their serialized size without recursing:
  // deeply nested input must reach the domain depth guard on every platform.
  const pending: unknown[] = [request];
  let bytes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      bytes += 2 + Math.max(0, value.length - 1);
      for (const item of value) pending.push(item ?? null);
    } else if (value !== null && typeof value === "object") {
      const entries = Object.entries(value).filter(([, item]) => item !== undefined);
      bytes += 2 + Math.max(0, entries.length - 1);
      for (const [key, item] of entries) {
        bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
        pending.push(item);
      }
    } else {
      bytes += Buffer.byteLength(JSON.stringify(value), "utf8");
    }
    if (bytes > MAX_MCP_REQUEST_BYTES) throw new McpRequestBudgetError();
  }
}
