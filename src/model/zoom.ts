export const minCanvasZoom = 0.52;
export const maxCanvasZoom = 1.8;

const wheelLineHeight = 16;
const maxWheelZoomDelta = 60;
const wheelPixelsPerZoomDoubling = 300;

export function clampCanvasZoom(value: number): number {
  return Math.min(maxCanvasZoom, Math.max(minCanvasZoom, value));
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
  );
}

export function canvasZoomFeedbackLabel(zoom: number): string {
  const percentage = Math.round(zoom * 100);
  if (Math.abs(zoom - minCanvasZoom) < 0.001) {
    return `${percentage}% · 最小`;
  }
  if (Math.abs(zoom - maxCanvasZoom) < 0.001) {
    return `${percentage}% · 最大`;
  }
  return `${percentage}%`;
}
