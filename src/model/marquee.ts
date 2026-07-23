import type {
  LayoutResult,
  Viewport,
} from "../types/mindmap";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectFromPoints(
  start: CanvasPoint,
  end: CanvasPoint,
): CanvasRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function passedDragThreshold(
  start: CanvasPoint,
  end: CanvasPoint,
  threshold = 4,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold;
}

export function nodesInsideMarquee(
  layout: LayoutResult,
  viewport: Viewport,
  rect: CanvasRect,
): string[] {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  return layout.visibleIds.filter((id) => {
    const node = layout.nodes[id];
    const centerX =
      (node.x + node.width / 2) * viewport.zoom + viewport.x;
    const centerY =
      (node.y + node.height / 2) * viewport.zoom + viewport.y;
    return (
      centerX >= rect.left &&
      centerX <= right &&
      centerY >= rect.top &&
      centerY <= bottom
    );
  });
}
