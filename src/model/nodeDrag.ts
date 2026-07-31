import type {
  LayoutResult,
  Viewport,
} from "../types/mindmap";
import type { CanvasPoint } from "./marquee";

export interface CanvasBounds {
  left: number;
  top: number;
}

export function clientPointToCanvas(
  clientX: number,
  clientY: number,
  bounds: CanvasBounds,
  viewport: Viewport,
): CanvasPoint {
  return {
    x: (clientX - bounds.left - viewport.x) / viewport.zoom,
    y: (clientY - bounds.top - viewport.y) / viewport.zoom,
  };
}

export function layoutNodeAtPoint(
  layout: LayoutResult,
  point: CanvasPoint,
  excludedIds: ReadonlySet<string> = new Set(),
): string | null {
  for (let index = layout.visibleIds.length - 1; index >= 0; index -= 1) {
    const id = layout.visibleIds[index];
    if (excludedIds.has(id)) continue;
    const node = layout.nodes[id];
    if (
      node &&
      point.x >= node.x &&
      point.x <= node.x + node.width &&
      point.y >= node.y &&
      point.y <= node.y + node.height
    ) {
      return id;
    }
  }
  return null;
}

export function pointTouchesAnyNode(
  layout: LayoutResult,
  point: CanvasPoint,
  ids: ReadonlySet<string>,
): boolean {
  return [...ids].some((id) => {
    const node = layout.nodes[id];
    return (
      node &&
      point.x >= node.x &&
      point.x <= node.x + node.width &&
      point.y >= node.y &&
      point.y <= node.y + node.height
    );
  });
}

export function floatingPositionFromPointer(
  point: CanvasPoint,
  grabOffset: CanvasPoint,
): CanvasPoint {
  return {
    x: Math.max(32, Math.round(point.x - grabOffset.x)),
    y: Math.max(32, Math.round(point.y - grabOffset.y)),
  };
}
