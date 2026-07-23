import { describe, expect, it } from "vitest";
import type { MindMapDocument, MindNode } from "../types/mindmap";
import { computeLayout } from "./layout";

function largeDocument(count: number): MindMapDocument {
  const now = "2026-07-23T00:00:00.000Z";
  const nodes: Record<string, MindNode> = {
    root: {
      id: "root",
      text: "性能测试",
      parentId: null,
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
  };

  for (let index = 1; index < count; index += 1) {
    const id = `node-${index}`;
    nodes[id] = {
      id,
      text: `节点 ${index}`,
      parentId: "root",
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    nodes.root.children.push(id);
  }

  return {
    formatVersion: 1,
    title: "性能测试",
    rootId: "root",
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: now,
  };
}

describe("automatic layout", () => {
  it("lays out all visible nodes with increasing depth coordinates", () => {
    const layout = computeLayout(largeDocument(20));
    expect(layout.visibleIds).toHaveLength(20);
    expect(layout.nodes["node-1"].x).toBeGreaterThan(layout.nodes.root.x);
  });

  it("handles a 1,000-node file within the interaction budget", () => {
    const startedAt = performance.now();
    const layout = computeLayout(largeDocument(1_000));
    const elapsed = performance.now() - startedAt;

    expect(layout.visibleIds).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(50);
  });
});
