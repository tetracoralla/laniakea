import { useCallback, useEffect, useRef } from "react";

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
  const maximumSpeed = 12;
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

  const stop = useCallback(() => {
    pointerRef.current = null;
    panRef.current = null;
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  const tickRef = useRef<() => void>(() => undefined);
  tickRef.current = () => {
    frameRef.current = 0;
    const pointer = pointerRef.current;
    const container = containerRef.current;
    const pan = panRef.current;
    if (!pointer || !container || !pan) return;
    const delta = flowAutoPanDelta(
      container.getBoundingClientRect(),
      pointer.x,
      pointer.y,
    );
    if (delta.x === 0 && delta.y === 0) return;
    pan(delta.x, delta.y);
    frameRef.current = window.requestAnimationFrame(() => tickRef.current());
  };

  const update = useCallback((
    clientX: number,
    clientY: number,
    onPan: (x: number, y: number) => void,
  ) => {
    pointerRef.current = { x: clientX, y: clientY };
    panRef.current = onPan;
    if (!frameRef.current) {
      frameRef.current = window.requestAnimationFrame(() => tickRef.current());
    }
  }, []);

  useEffect(() => stop, [stop]);
  return { stop, update };
}
