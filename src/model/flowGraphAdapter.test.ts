import { describe, expect, it } from "vitest";
import type { FlowSpace } from "../types/mindmap";
import { flowSpaceToSemanticGraph } from "./flowGraphAdapter";

describe("Laniakea Graph Projection adapter", () => {
  it("maps Flow semantics and declared sides without leaking viewport or positions", () => {
    const now = "2026-09-02T00:00:00.000Z";
    const space: FlowSpace = {
      id: "flow",
      type: "flow",
      anchorNodeId: "anchor",
      nodes: {
        from: { id: "from", text: "Draft", kind: "step", createdAt: now, updatedAt: now },
        to: { id: "to", text: "Review", kind: "decision", createdAt: now, updatedAt: now },
      },
      edges: [{ id: "review", from: "from", to: "to", label: "send", fromPort: "right", toPort: "left" }],
      positions: { from: { x: 100, y: 200 }, to: { x: 500, y: 200 } },
      viewport: { x: 96, y: 72, zoom: 1 },
      updatedAt: now,
    };
    const graph = flowSpaceToSemanticGraph(space);
    expect(graph.relations).toEqual([expect.objectContaining({
      source: "from",
      target: "to",
      direction: "directed",
      sourcePort: "right",
      targetPort: "left",
    })]);
    expect(graph).not.toHaveProperty("viewport");
    expect(JSON.stringify(graph)).not.toContain('"x":100');
  });
});
