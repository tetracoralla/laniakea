import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { FlowLayoutResult } from "../model/flowLayout";
import {
  canvasZoomFromWheel,
  canvasZoomToFit,
} from "../model/zoom";
import type { Viewport } from "../types/mindmap";

interface FlowViewportOptions {
  layout: FlowLayoutResult;
  onCanvasPointerDown: () => void;
  onViewportChange: (viewport: Viewport) => void;
  selectedId: string | null;
  viewport: Viewport;
}

interface FlowViewportBindings {
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface FlowViewportController {
  bindings: FlowViewportBindings;
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  fit: () => void;
  flushViewport: () => void;
  panBy: (x: number, y: number) => void;
}

export function useFlowViewport({
  layout,
  onCanvasPointerDown,
  onViewportChange,
  selectedId,
  viewport,
}: FlowViewportOptions): FlowViewportController {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    viewport: Viewport;
  } | null>(null);
  const liveViewport = useRef(viewport);
  const persistTimer = useRef<number | null>(null);
  const viewportDirtyRef = useRef(false);
  const viewportChangeRef = useRef(onViewportChange);
  const observedSize = useRef<{ width: number; height: number } | null>(null);
  const canvasPointerDownRef = useRef(onCanvasPointerDown);
  const layoutRef = useRef(layout);
  const previousSelectedIdRef = useRef(selectedId);

  viewportChangeRef.current = onViewportChange;
  canvasPointerDownRef.current = onCanvasPointerDown;
  layoutRef.current = layout;

  const renderViewport = useCallback((next: Viewport) => {
    liveViewport.current = next;
    if (contentRef.current) {
      contentRef.current.style.transform =
        `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
    }
  }, []);

  const flushViewport = useCallback(() => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    if (!viewportDirtyRef.current) return;
    viewportDirtyRef.current = false;
    viewportChangeRef.current(liveViewport.current);
  }, []);

  const scheduleViewport = useCallback((next: Viewport) => {
    renderViewport(next);
    viewportDirtyRef.current = true;
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(flushViewport, 120);
  }, [flushViewport, renderViewport]);

  const fit = useCallback(() => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const zoom = canvasZoomToFit(
      layout.width,
      layout.height,
      bounds.width,
      bounds.height,
    );
    const next = {
      zoom,
      x: (bounds.width - layout.width * zoom) / 2 - layout.minX * zoom,
      y: (bounds.height - layout.height * zoom) / 2 - layout.minY * zoom,
    };
    renderViewport(next);
    viewportDirtyRef.current = false;
    viewportChangeRef.current(next);
  }, [layout.height, layout.minX, layout.minY, layout.width, renderViewport]);

  useEffect(() => {
    renderViewport(viewport);
  }, [renderViewport, viewport]);

  // Only a selection change may auto-pan. Layout also changes on every text
  // edit; re-centering then would fight the user's manual pan.
  useEffect(() => {
    const previousSelectedId = previousSelectedIdRef.current;
    previousSelectedIdRef.current = selectedId;
    if (!selectedId || selectedId === previousSelectedId) return;
    const node = layoutRef.current.nodes[selectedId];
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!node || !bounds) return;
    const current = liveViewport.current;
    const inset = 84;
    const left = node.x * current.zoom + current.x;
    const right = (node.x + node.width) * current.zoom + current.x;
    const top = node.y * current.zoom + current.y;
    const bottom = (node.y + node.height) * current.zoom + current.y;
    let x = current.x;
    let y = current.y;
    if (left < inset) x += inset - left;
    else if (right > bounds.width - inset) {
      x -= right - (bounds.width - inset);
    }
    if (top < inset) y += inset - top;
    else if (bottom > bounds.height - inset) {
      y -= bottom - (bounds.height - inset);
    }
    if (x !== current.x || y !== current.y) {
      scheduleViewport({ ...current, x, y });
    }
  }, [scheduleViewport, selectedId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = liveViewport.current;
      if (event.metaKey || event.ctrlKey) {
        const bounds = container.getBoundingClientRect();
        const zoom = canvasZoomFromWheel(
          current.zoom,
          event.deltaY,
          event.deltaMode,
          bounds.height,
        );
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        const contentX = (x - current.x) / current.zoom;
        const contentY = (y - current.y) / current.zoom;
        scheduleViewport({
          zoom,
          x: x - contentX * zoom,
          y: y - contentY * zoom,
        });
      } else {
        scheduleViewport({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        });
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scheduleViewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      const previous = observedSize.current;
      observedSize.current = next;
      if (!previous) return;
      const deltaX = next.width - previous.width;
      const deltaY = next.height - previous.height;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
      const current = liveViewport.current;
      scheduleViewport({
        ...current,
        x: current.x + deltaX / 2,
        y: current.y + deltaY / 2,
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleViewport]);

  useEffect(() => () => flushViewport(), [flushViewport]);

  const panBy = useCallback((x: number, y: number) => {
    if (x === 0 && y === 0) return;
    const current = liveViewport.current;
    scheduleViewport({ ...current, x: current.x + x, y: current.y + y });
  }, [scheduleViewport]);

  return {
    containerRef,
    contentRef,
    fit,
    flushViewport,
    panBy,
    bindings: {
      onPointerCancel: (event) => {
        if (panRef.current?.pointerId !== event.pointerId) return;
        panRef.current = null;
        flushViewport();
      },
      onPointerDown: (event) => {
        if (event.target !== event.currentTarget) return;
        canvasPointerDownRef.current();
        panRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          viewport: liveViewport.current,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const pan = panRef.current;
        if (!pan || pan.pointerId !== event.pointerId) return;
        scheduleViewport({
          ...pan.viewport,
          x: pan.viewport.x + event.clientX - pan.x,
          y: pan.viewport.y + event.clientY - pan.y,
        });
      },
      onPointerUp: (event) => {
        if (panRef.current?.pointerId !== event.pointerId) return;
        panRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        flushViewport();
      },
    },
  };
}
