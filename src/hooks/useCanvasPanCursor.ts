import { useCallback, useRef } from "react";

/** A stationary hit surface owns the hand cursor while the content moves.
 * Updating only this element avoids restyling every node on large canvases. */
export function useCanvasPanCursor() {
  const panSurfaceRef = useRef<HTMLDivElement>(null);
  const setPanCursor = useCallback((cursor: "grab" | "grabbing" | null) => {
    const surface = panSurfaceRef.current;
    if (!surface) return;
    if (cursor) {
      if (surface.dataset.panCursor !== cursor) surface.dataset.panCursor = cursor;
    } else if (surface.dataset.panCursor) {
      delete surface.dataset.panCursor;
    }
  }, []);
  return { panSurfaceRef, setPanCursor };
}
