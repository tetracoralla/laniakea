import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../types/mindmap";
import {
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
    },
    b: {
      id: "b",
      x: 320,
      y: 160,
      width: 120,
      height: 40,
      depth: 1,
      tone: "blue",
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

  it("selects by node center after viewport pan and zoom", () => {
    const selected = nodesInsideMarquee(
      layout,
      { x: 40, y: -10, zoom: 0.5 },
      { left: 115, top: 20, width: 20, height: 12 },
    );
    expect(selected).toEqual(["a"]);
  });
});
