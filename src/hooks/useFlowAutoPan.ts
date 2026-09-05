import { useCallback, useEffect, useRef } from "react";
import { useDragInterruption } from "./useDragInterruption";

interface AutoPanBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export function flowAutoPanDelta(
  bounds: AutoPanBounds,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const edgeZone = 58;
  // Pixels per second; the caller integrates over real elapsed time so the
  // pan speed stays identical on 60 Hz and 120 Hz displays.
  const maximumSpeed = 720;
  const axis = (point: number, low: number, high: number) => {
    if (point < low + edgeZone) {
      return maximumSpeed * Math.min(1, (low + edgeZone - point) / edgeZone);
    }
    if (point > high - edgeZone) {
      return -maximumSpeed * Math.min(1, (point - (high - edgeZone)) / edgeZone);
    }
    return 0;
  };
  return {
    x: axis(clientX, bounds.left, bounds.right),
    y: axis(clientY, bounds.top, bounds.bottom),
  };
}

export function useFlowAutoPan(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const frameRef = useRef(0);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<((x: number, y: number) => void) | null>(null);
  const interactionActiveRef = useRef<(() => boolean) | null>(null);
  const timestampRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    pointerRef.current = null;
    panRef.current = null;
    interactionActiveRef.current = null;
    timestampRef.current = null;
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  const tickRef = useRef<(timestamp: number) => void>(() => undefined);
  tickRef.current = (timestamp: number) => {
    frameRef.current = 0;
    const pointer = pointerRef.current;
    const container = containerRef.current;
    const pan = panRef.current;
    const interactionActive = interactionActiveRef.current;
    if (
      !pointer ||
      !container ||
      !pan ||
      !interactionActive?.()
    ) {
      stop();
      return;
    }
    const velocity = flowAutoPanDelta(
      container.getBoundingClientRect(),
      pointer.x,
      pointer.y,
    );
    if (velocity.x === 0 && velocity.y === 0) {
      timestampRef.current = null;
      return;
    }
    const previousTimestamp =
      timestampRef.current ?? timestamp - 1000 / 60;
    const elapsedSeconds =
      Math.min(32, Math.max(0, timestamp - previousTimestamp)) / 1000;
    timestampRef.current = timestamp;
    pan(velocity.x * elapsedSeconds, velocity.y * elapsedSeconds);
    frameRef.current = window.requestAnimationFrame(tickRef.current);
  };

  const update = useCallback((
    clientX: number,
    clientY: number,
    onPan: (x: number, y: number) => void,
    interactionActive: () => boolean = () => true,
  ) => {
    pointerRef.current = { x: clientX, y: clientY };
    panRef.current = onPan;
    interactionActiveRef.current = interactionActive;
    if (!frameRef.current) {
      frameRef.current = window.requestAnimationFrame(tickRef.current);
    }
  }, []);

  useDragInterruption({
    hasActiveDrag: () => pointerRef.current !== null,
    onCancel: stop,
  });

  useEffect(() => stop, [stop]);
  return { stop, update };
}
