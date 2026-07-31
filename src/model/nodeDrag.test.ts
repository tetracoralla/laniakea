import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../types/mindmap";
import {
  clientPointToCanvas,
  floatingPositionFromPointer,
  layoutNodeAtPoint,
  pointTouchesAnyNode,
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
      pointTouchesAnyNode(
        layout,
        { x: 150, y: 100 },
        new Set(["source"]),
      ),
    ).toBe(true);
  });

  it("keeps a blank-canvas drop inside the usable content area", () => {
    expect(
      floatingPositionFromPointer(
        { x: 20, y: 12 },
        { x: 70, y: 18 },
      ),
    ).toEqual({ x: 32, y: 32 });
  });
});
