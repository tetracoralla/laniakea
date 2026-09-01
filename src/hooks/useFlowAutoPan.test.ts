import { describe, expect, it } from "vitest";
import { flowAutoPanDelta } from "./useFlowAutoPan";

describe("flow edge auto-pan", () => {
  const bounds = { left: 100, top: 80, right: 900, bottom: 680 };

  it("stays still in the safe center of the canvas", () => {
    expect(flowAutoPanDelta(bounds, 500, 380)).toEqual({ x: 0, y: 0 });
  });

  it("pans continuously toward every approached edge", () => {
    expect(flowAutoPanDelta(bounds, 100, 380).x).toBeGreaterThan(0);
    expect(flowAutoPanDelta(bounds, 900, 380).x).toBeLessThan(0);
    expect(flowAutoPanDelta(bounds, 500, 80).y).toBeGreaterThan(0);
    expect(flowAutoPanDelta(bounds, 500, 680).y).toBeLessThan(0);
  });

  it("ramps speed instead of jumping at the activation boundary", () => {
    const nearBoundary = flowAutoPanDelta(bounds, 150, 380).x;
    const atEdge = flowAutoPanDelta(bounds, 100, 380).x;
    expect(nearBoundary).toBeGreaterThan(0);
    expect(nearBoundary).toBeLessThan(atEdge);
  });
});
