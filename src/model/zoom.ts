export const minCanvasZoom = 0.52;
export const minOverviewCanvasZoom = 0.0001;
export const maxCanvasZoom = 1.8;

const wheelLineHeight = 16;
const maxWheelZoomDelta = 60;
const wheelPixelsPerZoomDoubling = 280;

export function clampCanvasZoom(
  value: number,
  minimum = minCanvasZoom,
): number {
  return Math.min(maxCanvasZoom, Math.max(minimum, value));
}

export function canvasZoomToFit(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  paddingX = 112,
  paddingY = 96,
): number {
  const availableWidth = Math.max(1, viewportWidth - paddingX * 2);
  const availableHeight = Math.max(1, viewportHeight - paddingY * 2);
  return clampCanvasZoom(
    Math.min(
      1,
      availableWidth / Math.max(1, contentWidth),
      availableHeight / Math.max(1, contentHeight),
    ),
    minOverviewCanvasZoom,
  );
}

/**
 * Trackpad pinch events arrive as small, high-frequency wheel deltas while a
 * mouse wheel can report much larger line or page deltas. Preserve the fine
 * trackpad input and cap only a single unusually large event so both devices
 * change zoom continuously without visible 8% steps.
 */
export function canvasZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  const pixelDelta =
    deltaMode === 1
      ? deltaY * wheelLineHeight
      : deltaMode === 2
        ? deltaY * viewportHeight
        : deltaY;
  const boundedDelta = Math.max(
    -maxWheelZoomDelta,
    Math.min(maxWheelZoomDelta, pixelDelta),
  );
  return clampCanvasZoom(
    currentZoom * 2 ** (-boundedDelta / wheelPixelsPerZoomDoubling),
    Math.min(currentZoom, minCanvasZoom),
  );
}

export function canvasZoomFeedbackLabel(zoom: number): string {
  const percentage =
    zoom < 0.1
      ? Number((zoom * 100).toFixed(1))
      : Math.round(zoom * 100);
  if (zoom < minCanvasZoom - 0.001) {
    return `${percentage}% · 全图`;
  }
  if (Math.abs(zoom - minCanvasZoom) < 0.001) {
    return `${percentage}% · 最小`;
  }
  if (Math.abs(zoom - maxCanvasZoom) < 0.001) {
    return `${percentage}% · 最大`;
  }
  return `${percentage}%`;
}
