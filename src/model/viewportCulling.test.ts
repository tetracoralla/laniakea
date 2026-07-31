import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../types/mindmap";
import { visibleLayoutNodeIds } from "./viewportCulling";

function largeLayout(count: number): LayoutResult {
  const visibleIds = Array.from(
    { length: count },
    (_, index) => `node-${index}`,
  );
  return {
    visibleIds,
    nodes: Object.fromEntries(
      visibleIds.map((id, index) => [
        id,
        {
          id,
          x: 400,
          y: index * 64,
          width: 180,
          height: 48,
          depth: 1,
          tone: "violet",
          rootKind: null,
        },
      ]),
    ),
    width: 1200,
    height: count * 64,
  };
}

describe("viewport node culling", () => {
  it("keeps a 5,000-node map to a bounded rendered window", () => {
    const ids = visibleLayoutNodeIds(
      largeLayout(5_000),
      { x: 0, y: 0, zoom: 1 },
      { width: 1200, height: 900 },
    );

    expect(ids.length).toBeGreaterThan(10);
    expect(ids.length).toBeLessThan(30);
    expect(ids).toContain("node-0");
    expect(ids).not.toContain("node-100");
  });

  it("retains an offscreen node while it is selected or edited", () => {
    const ids = visibleLayoutNodeIds(
      largeLayout(5_000),
      { x: 0, y: 0, zoom: 1 },
      { width: 1200, height: 900 },
      new Set(["node-3200"]),
    );

    expect(ids).toContain("node-3200");
  });
});
