import { describe, expect, it } from "vitest";
import type { LayoutResult, MindMapDocument } from "../types/mindmap";
import {
  childInsertionPosition,
  buildNodeDropSpatialIndex,
  clientPointToCanvas,
  dragConnectorPath,
  floatingPositionFromPointer,
  layoutNodeAtPoint,
  nodeDropHitTest,
  nodeDropHitTestForRect,
  nodeDropCandidateIds,
  nodeDropParentHitTest,
} from "./nodeDrag";

const layout: LayoutResult = {
  nodes: {
    source: {
      id: "source",
      x: 100,
      y: 80,
      width: 180,
      height: 48,
      depth: 1,
      tone: "blue",
      rootKind: null,
    },
    target: {
      id: "target",
      x: 420,
      y: 180,
      width: 180,
      height: 48,
      depth: 1,
      tone: "emerald",
      rootKind: null,
    },
  },
  visibleIds: ["source", "target"],
  width: 800,
  height: 600,
};

describe("node drag geometry", () => {
  it("converts pointer coordinates through the current viewport", () => {
    expect(
      clientPointToCanvas(
        310,
        230,
        { left: 10, top: 30 },
        { x: 100, y: 20, zoom: 2 },
      ),
    ).toEqual({ x: 100, y: 90 });
  });

  it("finds a valid drop target while excluding the dragged subtree", () => {
    expect(
      layoutNodeAtPoint(
        layout,
        { x: 480, y: 200 },
        new Set(["source"]),
      ),
    ).toBe("target");
    expect(
      nodeDropHitTest(
        layout,
        { x: 150, y: 100 },
        new Set(["source"]),
      ),
    ).toEqual({ blockedByDraggedSubtree: true, targetId: null });
  });

  it("magnetizes to the nearest valid parent outside its exact bounds", () => {
    expect(
      nodeDropHitTest(
        layout,
        { x: 628, y: 204 },
        new Set(["source"]),
        32,
      ),
    ).toEqual({ blockedByDraggedSubtree: false, targetId: "target" });

    expect(
      nodeDropHitTest(
        layout,
        { x: 640, y: 204 },
        new Set(["source"]),
        32,
      ),
    ).toEqual({ blockedByDraggedSubtree: false, targetId: null });
  });

  it("uses a larger forward capture zone for shallow parent nodes", () => {
    expect(
      nodeDropParentHitTest(
        layout,
        { x: 708, y: 180, width: 180, height: 48 },
        new Set(["source"]),
      ),
    ).toEqual({ blockedByDraggedSubtree: false, targetId: "target" });

    expect(
      nodeDropParentHitTest(
        {
          ...layout,
          nodes: {
            ...layout.nodes,
            target: { ...layout.nodes.target, depth: 2 },
          },
        },
        { x: 708, y: 180, width: 180, height: 48 },
        new Set(["source"]),
      ),
    ).toEqual({ blockedByDraggedSubtree: false, targetId: null });
  });

  it("limits a 10,000-node drop probe to nearby indexed candidates", () => {
    const visibleIds = Array.from({ length: 10_000 }, (_, index) => `node-${index}`);
    const largeLayout: LayoutResult = {
      nodes: Object.fromEntries(
        visibleIds.map((id, index) => [
          id,
          {
            id,
            x: 420,
            y: index * 80,
            width: 180,
            height: 48,
            depth: 2,
            tone: "blue" as const,
            rootKind: null,
          },
        ]),
      ),
      visibleIds,
      width: 800,
      height: 800_000,
    };
    const probe = { x: 700, y: 400_000, width: 180, height: 48 };
    const candidates = nodeDropCandidateIds(
      buildNodeDropSpatialIndex(largeLayout),
      probe,
    );

    expect(candidates.length).toBeLessThan(10);
    expect(
      nodeDropParentHitTest(
        largeLayout,
        probe,
        new Set(),
        1,
        candidates,
      ),
    ).toEqual(
      nodeDropParentHitTest(largeLayout, probe),
    );
  });

  it("skips ambiguous magnetic attachment in a dense whole-map overview", () => {
    const index = buildNodeDropSpatialIndex(layout);
    expect(nodeDropCandidateIds(
      index,
      { x: 700, y: 180, width: 180, height: 48 },
      8,
    )).toEqual([]);
  });

  it("does not attach when the dragged node is behind or covering a candidate", () => {
    expect(
      nodeDropParentHitTest(
        layout,
        { x: 500, y: 180, width: 180, height: 48 },
        new Set(["source"]),
      ),
    ).toEqual({ blockedByDraggedSubtree: false, targetId: null });
  });

  it("keeps a blank-canvas drop inside the usable content area", () => {
    expect(
      floatingPositionFromPointer(
        { x: 20, y: 12 },
        { x: 70, y: 18 },
      ),
    ).toEqual({ x: 32, y: 32 });
  });

  it("draws the attachment preview from the candidate parent to the dragged node", () => {
    expect(
      dragConnectorPath(layout.nodes.target, {
        x: 660,
        y: 260,
        width: 180,
        height: 48,
      }),
    ).toBe("M 600 204 C 631.2 204, 628.8 284, 660 284");
  });

  it("resolves an ordered child slot from the preview's vertical position", () => {
    const document: MindMapDocument = {
      formatVersion: 1,
      title: "排序",
      rootId: "target",
      nodes: {
        target: {
          id: "target",
          text: "父节点",
          parentId: null,
          children: ["first", "source", "last"],
          collapsed: false,
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
        first: {
          id: "first",
          text: "第一项",
          parentId: "target",
          children: [],
          collapsed: false,
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
        source: {
          id: "source",
          text: "拖动项",
          parentId: "target",
          children: [],
          collapsed: false,
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
        last: {
          id: "last",
          text: "最后项",
          parentId: "target",
          children: [],
          collapsed: false,
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      },
      floatingRoots: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const orderedLayout: LayoutResult = {
      ...layout,
      nodes: {
        ...layout.nodes,
        first: {
          ...layout.nodes.source,
          id: "first",
          x: 660,
          y: 120,
        },
        last: {
          ...layout.nodes.source,
          id: "last",
          x: 660,
          y: 260,
        },
      },
      visibleIds: ["target", "first", "last"],
    };

    expect(
      childInsertionPosition(document, orderedLayout, "target", "source", {
        x: 660,
        y: 70,
        width: 180,
        height: 48,
      }),
    ).toBe(0);
    expect(
      childInsertionPosition(document, orderedLayout, "target", "source", {
        x: 660,
        y: 180,
        width: 180,
        height: 48,
      }),
    ).toBe(1);
    expect(
      childInsertionPosition(document, orderedLayout, "target", "source", {
        x: 660,
        y: 320,
        width: 180,
        height: 48,
      }),
    ).toBe(2);
  });
});
