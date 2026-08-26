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

export interface CanvasSize {
  width: number;
  height: number;
}

const marqueeAutoPanInset = 72;
const marqueeAutoPanMaximumSpeed = 420;

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

function edgeVelocity(
  position: number,
  extent: number,
  inset: number,
  maximumSpeed: number,
): number {
  if (extent <= 0) return 0;
  if (position < inset) {
    const pressure = Math.min(1, (inset - position) / inset);
    return -maximumSpeed * pressure * pressure;
  }
  if (position > extent - inset) {
    const pressure = Math.min(
      1,
      (position - (extent - inset)) / inset,
    );
    return maximumSpeed * pressure * pressure;
  }
  return 0;
}

/**
 * Returns screen-pixel velocity for marquee auto-pan. The quadratic ramp keeps
 * the edge easy to approach while a pointer beyond the canvas reaches a
 * bounded, predictable speed.
 */
export function marqueeAutoPanVelocity(
  pointer: CanvasPoint,
  canvas: CanvasSize,
  inset = marqueeAutoPanInset,
  maximumSpeed = marqueeAutoPanMaximumSpeed,
): CanvasPoint {
  return {
    x: edgeVelocity(pointer.x, canvas.width, inset, maximumSpeed),
    y: edgeVelocity(pointer.y, canvas.height, inset, maximumSpeed),
  };
}

export function contentPointToCanvas(
  point: CanvasPoint,
  viewport: Viewport,
): CanvasPoint {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function canvasPointToContent(
  point: CanvasPoint,
  viewport: Viewport,
): CanvasPoint {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
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
