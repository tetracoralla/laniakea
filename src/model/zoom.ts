import { t } from "../i18n/locale";
export const minCanvasZoom = 0.4;
export const minOverviewCanvasZoom = 0.0001;
export const maxCanvasZoom = 2.5;

const wheelLineHeight = 16;
const maxWheelZoomDelta = 60;
// 30% more responsive than the previous 260 px calibration, with the same
// continuous curve and single-event cap (no discrete zoom jumps).
const wheelPixelsPerZoomDoubling = 200;

/** Normalizes a non-pinch wheel event to pixel deltas for panning. */
export function wheelPanPixelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): { x: number; y: number } {
  const scale =
    deltaMode === 1
      ? wheelLineHeight
      : deltaMode === 2
        ? Math.max(1, viewportHeight)
        : 1;
  return { x: deltaX * scale, y: deltaY * scale };
}

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
    return t("{0}% · 全图", percentage);
  }
  if (Math.abs(zoom - minCanvasZoom) < 0.001) {
    return t("{0}% · 最小", percentage);
  }
  if (Math.abs(zoom - maxCanvasZoom) < 0.001) {
    return t("{0}% · 最大", percentage);
  }
  return `${percentage}%`;
}

/**
 * Button zoom steps are multiplicative (consistent feel around readable
 * zooms) but keep a 0.1 additive floor so a deep overview escapes quickly:
 * ×1.2 from a 2% fit zoom would otherwise need ~24 clicks to become readable.
 */
export function steppedCanvasZoom(current: number, direction: 1 | -1): number {
  const multiplicative = direction > 0 ? current * 1.2 : current / 1.2;
  const additive = direction > 0 ? current + 0.1 : current - 0.1;
  const raw =
    direction > 0
      ? Math.max(multiplicative, additive)
      : Math.min(multiplicative, additive);
  return clampCanvasZoom(raw, Math.min(current, minCanvasZoom));
}
