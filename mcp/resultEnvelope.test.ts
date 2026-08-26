import { describe, expect, it } from "vitest";
import { MindMapToolError, type AgentNodeView } from "../src/agent/mindMapTools";
import { MindMapFileError } from "./mindMapFileStore";
import {
  assertMcpRequestBudget,
  MAX_MCP_REQUEST_BYTES,
} from "./requestBudget";
import {
  boundedErrorResult,
  boundedSnapshotResult,
  MAX_MCP_RESPONSE_BYTES,
  serializedToolResultBytes,
  type SnapshotContent,
} from "./resultEnvelope";

function node(index: number): AgentNodeView {
  return {
    ref: `/0/${index}`,
    parentRef: "/0",
    depth: 1,
    text: `Node ${index} ${"content ".repeat(20)}`,
    childCount: 0,
    breadcrumb: ["Root", `Node ${index}`],
  };
}

describe("MCP result envelopes", () => {
  it("bounds the complete success result and reports response truncation", () => {
    const result = boundedSnapshotResult({
      filePath: "/tmp/large.md",
      revision: `sha256:${"a".repeat(64)}`,
      title: "Large",
      sourceKind: "outline",
      canUpdate: true,
      nodeCount: 5_001,
      nodes: Array.from({ length: 5_000 }, (_, index) => node(index)),
      truncated: false,
      truncationReasons: [],
    });
    const structured = result.structuredContent as SnapshotContent;

    expect(serializedToolResultBytes(result)).toBeLessThanOrEqual(
      MAX_MCP_RESPONSE_BYTES,
    );
    expect(structured.returnedNodeCount).toBeLessThan(5_000);
    expect(structured.truncated).toBe(true);
    expect(structured.truncationReasons).toContain("response_bytes");
    expect(result.content[0].text).toContain(
      "additional nodes are available in structuredContent",
    );
  });

  it("keeps machine-readable codes for expected file and model errors", () => {
    const conflict = boundedErrorResult(
      new MindMapFileError("conflict", "Read the map again."),
    );
    const protectedSource = boundedErrorResult(
      new MindMapToolError("protected_source", "Create a new map instead."),
    );

    expect(conflict.structuredContent.error.code).toBe("conflict");
    expect(protectedSource.structuredContent.error.code).toBe(
      "protected_source",
    );
    expect(conflict.isError).toBe(true);
  });

  it("does not expose arbitrary internal error text", () => {
    const result = boundedErrorResult(
      new Error("private implementation detail that must not cross the boundary"),
    );

    expect(result.structuredContent.error.code).toBe("io_error");
    expect(result.content[0].text).not.toContain("private implementation");
    expect(serializedToolResultBytes(result)).toBeLessThanOrEqual(
      MAX_MCP_RESPONSE_BYTES,
    );
  });

  it("rejects a complete request that exceeds the cumulative byte budget", () => {
    const request = {
      root: {
        text: "Root",
        children: Array.from({ length: 700 }, () => ({
          text: "x".repeat(1_000),
        })),
      },
    };

    expect(Buffer.byteLength(JSON.stringify(request), "utf8")).toBeGreaterThan(
      MAX_MCP_REQUEST_BYTES,
    );
    expect(() => assertMcpRequestBudget(request)).toThrow(
      /complete MCP tool request/,
    );
  });
});
