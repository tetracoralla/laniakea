import { describe, expect, it } from "vitest";
import type { LayoutResult } from "../types/mindmap";
import {
  shareStableVisibleIds,
  viewportOverscan,
  viewportNeedsRenderWindowRefresh,
  visibleLayoutNodeIds,
  visibleLayoutPortalAnchorIds,
} from "./viewportCulling";

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
  it("sizes overscan from the short viewport dimension on wide canvases", () => {
    expect(viewportOverscan({ width: 1600, height: 1000 })).toBe(1000);
    expect(viewportOverscan({ width: 320, height: 460 })).toBe(480);
  });

  it("reuses an equivalent mounted-node list across transient interaction state", () => {
    const previous = ["a", "b", "c"];
    expect(shareStableVisibleIds(previous, ["a", "b", "c"])).toBe(previous);
    expect(shareStableVisibleIds(previous, ["a", "c"])).toEqual(["a", "c"]);
  });

  it("keeps a 5,000-node map to a bounded rendered window", () => {
    const ids = visibleLayoutNodeIds(
      largeLayout(5_000),
      { x: 0, y: 0, zoom: 1 },
      { width: 1200, height: 900 },
    );

    expect(ids.length).toBeGreaterThan(10);
    expect(ids.length).toBeLessThan(40);
    expect(ids).toContain("node-0");
    expect(ids).toContain("node-28");
    expect(ids).not.toContain("node-29");
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

  it("culls subspace previews independently and pins the selected preview", () => {
    const layout = largeLayout(2);
    layout.portals = {
      "node-0": {
        ...layout.nodes["node-0"],
        id: "subspace:node-0",
        x: 700,
      },
      "node-1": {
        ...layout.nodes["node-1"],
        id: "subspace:node-1",
        x: 9_000,
      },
    };

    expect(
      visibleLayoutPortalAnchorIds(
        layout,
        { x: 0, y: 0, zoom: 1 },
        { width: 1200, height: 900 },
      ),
    ).toEqual(["node-0"]);
    expect(
      visibleLayoutPortalAnchorIds(
        layout,
        { x: 0, y: 0, zoom: 1 },
        { width: 1200, height: 900 },
        "node-1",
      ),
    ).toEqual(["node-0", "node-1"]);
  });

  it("reuses the mounted window for small movements and refreshes before its buffer expires", () => {
    const size = { width: 1200, height: 900 };

    expect(
      viewportNeedsRenderWindowRefresh(
        { x: 0, y: 0, zoom: 1 },
        { x: -400, y: -300, zoom: 1 },
        size,
      ),
    ).toBe(false);
    expect(
      viewportNeedsRenderWindowRefresh(
        { x: 0, y: 0, zoom: 1 },
        { x: -700, y: 0, zoom: 1 },
        size,
      ),
    ).toBe(true);
  });

  it("refreshes when zooming would reveal content beyond the mounted window", () => {
    expect(
      viewportNeedsRenderWindowRefresh(
        { x: 0, y: 0, zoom: 1 },
        { x: 0, y: 0, zoom: 0.52 },
        { width: 1200, height: 900 },
      ),
    ).toBe(true);
  });

  it("refreshes after material zoom-in so an overview mount can contract", () => {
    const size = { width: 1200, height: 900 };

    expect(
      viewportNeedsRenderWindowRefresh(
        { x: 300, y: 180, zoom: 0.08 },
        { x: -250, y: -120, zoom: 0.24 },
        size,
      ),
    ).toBe(true);
    expect(
      viewportNeedsRenderWindowRefresh(
        { x: 0, y: 0, zoom: 1 },
        { x: 0, y: 0, zoom: 1.2 },
        size,
      ),
    ).toBe(false);
  });
});
