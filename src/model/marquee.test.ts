import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../types/mindmap";
import {
  canvasPointToContent,
  contentPointToCanvas,
  marqueeAutoPanVelocity,
  nodesInsideMarquee,
  passedDragThreshold,
  rectFromPoints,
} from "./marquee";

const layout: LayoutResult = {
  nodes: {
    a: {
      id: "a",
      x: 100,
      y: 50,
      width: 120,
      height: 40,
      depth: 1,
      tone: "violet",
      rootKind: null,
    },
    b: {
      id: "b",
      x: 320,
      y: 160,
      width: 120,
      height: 40,
      depth: 1,
      tone: "blue",
      rootKind: null,
    },
  },
  visibleIds: ["a", "b"],
  width: 500,
  height: 300,
};

describe("marquee geometry", () => {
  it("normalizes reverse-direction drags", () => {
    expect(rectFromPoints({ x: 90, y: 70 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      width: 80,
      height: 50,
    });
  });

  it("uses a four pixel threshold for click versus drag", () => {
    expect(passedDragThreshold({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(passedDragThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
  });

  it("selects nodes whose center is inside after pan and zoom", () => {
    const selected = nodesInsideMarquee(
      layout,
      { x: 40, y: -10, zoom: 0.5 },
      { left: 115, top: 20, width: 20, height: 12 },
    );
    expect(selected).toEqual(["a"]);
  });

  it("does not select a node when the marquee only grazes its edge", () => {
    // Rect ends at x=115 while node a spans 90-150 on screen; its center
    // (120) is outside the rect, so the edge overlap must not select it.
    const selected = nodesInsideMarquee(
      layout,
      { x: 40, y: -10, zoom: 0.5 },
      { left: 60, top: 20, width: 55, height: 12 },
    );
    expect(selected).toEqual([]);
  });

  it("ramps marquee auto-pan near an edge and caps it outside the canvas", () => {
    const canvas = { width: 1200, height: 900 };

    expect(marqueeAutoPanVelocity({ x: 600, y: 450 }, canvas)).toEqual({
      x: 0,
      y: 0,
    });
    expect(
      marqueeAutoPanVelocity({ x: 1164, y: 450 }, canvas).x,
    ).toBeCloseTo(105, 6);
    expect(
      marqueeAutoPanVelocity({ x: 1300, y: -100 }, canvas),
    ).toEqual({ x: 420, y: -420 });
  });

  it("keeps a marquee anchor attached to its content while the viewport pans", () => {
    const viewport = { x: -120, y: 80, zoom: 0.75 };
    const contentPoint = canvasPointToContent(
      { x: 180, y: 230 },
      viewport,
    );

    expect(contentPointToCanvas(contentPoint, viewport)).toEqual({
      x: 180,
      y: 230,
    });
    expect(
      contentPointToCanvas(contentPoint, {
        ...viewport,
        x: viewport.x - 40,
      }),
    ).toEqual({ x: 140, y: 230 });
  });
});
