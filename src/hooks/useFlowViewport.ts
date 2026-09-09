import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { flowContentBounds, type FlowLayoutResult } from "../model/flowLayout";
import { ignoresSpaceShortcut } from "./useCanvasGestures";
import { useCanvasPanCursor } from "./useCanvasPanCursor";
import {
  hasActiveCanvasDrag,
  releaseOwnedPointerCapture,
  useDragInterruption,
} from "./useDragInterruption";
import {
  canvasZoomFromWheel,
  steppedCanvasZoom,
  canvasZoomToFit,
  wheelPanPixelDelta,
} from "../model/zoom";
import type { Viewport } from "../types/mindmap";

interface FlowViewportOptions {
  layout: FlowLayoutResult;
  onCanvasPointerDown: () => void;
  onViewportChange: (viewport: Viewport) => void;
  /** Space tapped without panning: the main-map "edit selection" gesture. */
  onSpaceTap?: () => void;
  selectedId: string | null;
  viewport: Viewport;
}

interface FlowViewportBindings {
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
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
  focusSelected: () => void;
  revealEditor: (editor: HTMLElement) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  flushViewport: () => void;
  getViewport: () => Viewport;
  panBy: (x: number, y: number) => void;
  /** Live ref: true while Space is held (the pan modifier). */
  panModifierHeld: RefObject<boolean>;
  panSurfaceRef: RefObject<HTMLDivElement | null>;
}

export function useFlowViewport({
  layout,
  onCanvasPointerDown,
  onViewportChange,
  onSpaceTap,
  selectedId,
  viewport,
}: FlowViewportOptions): FlowViewportController {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    captureElement: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    viewport: Viewport;
  } | null>(null);
  const liveViewport = useRef(viewport);
  const viewportFrame = useRef<number | null>(null);
  const { panSurfaceRef, setPanCursor } = useCanvasPanCursor();
  const persistTimer = useRef<number | null>(null);
  const viewportDirtyRef = useRef(false);
  const viewportChangeRef = useRef(onViewportChange);
  const observedSize = useRef<{ width: number; height: number } | null>(null);
  const canvasPointerDownRef = useRef(onCanvasPointerDown);
  const onSpaceTapRef = useRef(onSpaceTap);
  const spaceHeldRef = useRef(false);
  const spaceUsedForPanRef = useRef(false);
  const layoutRef = useRef(layout);
  const previousSelectedIdRef = useRef(selectedId);

  viewportChangeRef.current = onViewportChange;
  canvasPointerDownRef.current = onCanvasPointerDown;
  onSpaceTapRef.current = onSpaceTap;
  layoutRef.current = layout;

  const paintViewport = useCallback(() => {
    const next = liveViewport.current;
    if (contentRef.current) {
      contentRef.current.style.transform =
        `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
    }
  }, []);

  const renderViewport = useCallback((next: Viewport, coalesce = false) => {
    liveViewport.current = next;
    // Focus/reveal operations need the new position before reading editor
    // bounds. Only the high-frequency wheel and pointer stream is deferred.
    if (!coalesce) {
      if (viewportFrame.current !== null) {
        window.cancelAnimationFrame(viewportFrame.current);
        viewportFrame.current = null;
      }
      paintViewport();
      return;
    }
    if (viewportFrame.current !== null) return;
    viewportFrame.current = window.requestAnimationFrame(() => {
      viewportFrame.current = null;
      paintViewport();
    });
  }, [paintViewport]);

  const paintPendingViewport = useCallback(() => {
    if (viewportFrame.current !== null) {
      window.cancelAnimationFrame(viewportFrame.current);
      viewportFrame.current = null;
      paintViewport();
    }
  }, [paintViewport]);

  const flushViewport = useCallback(() => {
    paintPendingViewport();
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    if (!viewportDirtyRef.current) return;
    viewportDirtyRef.current = false;
    viewportChangeRef.current(liveViewport.current);
  }, [paintPendingViewport]);

  const scheduleViewport = useCallback((next: Viewport, coalesce = false) => {
    renderViewport(next, coalesce);
    viewportDirtyRef.current = true;
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(flushViewport, 120);
  }, [flushViewport, renderViewport]);

  const interruptPan = useCallback(() => {
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null;
    spaceHeldRef.current = false;
    spaceUsedForPanRef.current = false;
    setPanCursor(null);
    releaseOwnedPointerCapture(pan.captureElement, pan.pointerId);
    flushViewport();
  }, [flushViewport, setPanCursor]);

  useDragInterruption({
    hasActiveDrag: () => panRef.current !== null,
    onCancel: interruptPan,
  });

  const fit = useCallback(() => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const content = flowContentBounds(layout);
    const zoom = canvasZoomToFit(
      content.width,
      content.height,
      bounds.width,
      bounds.height,
    );
    const next = {
      zoom,
      x: (bounds.width - content.width * zoom) / 2 - content.minX * zoom,
      y: (bounds.height - content.height * zoom) / 2 - content.minY * zoom,
    };
    renderViewport(next);
    viewportDirtyRef.current = false;
    viewportChangeRef.current(next);
  }, [layout.height, layout.minX, layout.minY, layout.width, renderViewport]);

  const zoomAtCenter = useCallback((resolve: (zoom: number) => number) => {
    if (hasActiveCanvasDrag()) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const current = liveViewport.current;
    const zoom = resolve(current.zoom);
    const x = bounds.width / 2;
    const y = bounds.height / 2;
    scheduleViewport({
      zoom,
      x: x - ((x - current.x) / current.zoom) * zoom,
      y: y - ((y - current.y) / current.zoom) * zoom,
    });
  }, [scheduleViewport]);
  const zoomIn = useCallback(() => zoomAtCenter((zoom) => steppedCanvasZoom(zoom, 1)), [zoomAtCenter]);
  const zoomOut = useCallback(() => zoomAtCenter((zoom) => steppedCanvasZoom(zoom, -1)), [zoomAtCenter]);
  const resetZoom = useCallback(() => zoomAtCenter(() => 1), [zoomAtCenter]);
  const focusSelected = useCallback(() => {
    if (hasActiveCanvasDrag()) return;
    const node = selectedId ? layoutRef.current.nodes[selectedId] : null;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!node || !bounds) return;
    const current = liveViewport.current;
    scheduleViewport({
      ...current,
      x: bounds.width / 2 - (node.x + node.width / 2) * current.zoom,
      y: bounds.height / 2 - (node.y + node.height / 2) * current.zoom,
    });
  }, [scheduleViewport, selectedId]);

  const revealEditor = useCallback((editor: HTMLElement) => {
    // A wheel sample may still be waiting for a frame when editing starts.
    // Measure the editor in that latest viewport, not the previous paint.
    paintPendingViewport();
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const rect = editor.getBoundingClientRect();
    const insetX = Math.min(84, bounds.width / 4);
    const insetY = Math.min(84, bounds.height / 4);
    const left = bounds.left + insetX;
    const right = bounds.right - insetX;
    const top = bounds.top + insetY;
    const bottom = bounds.bottom - insetY;
    // Leave room for an empty label to grow while the user types. Revealing
    // only its current edge would immediately clip a longer label again.
    const x = rect.left < left || rect.right > right
      ? (left + right - rect.left - rect.right) / 2 : 0;
    const y = rect.top < top || rect.bottom > bottom
      ? (top + bottom - rect.top - rect.bottom) / 2 : 0;
    if (x || y) {
      const current = liveViewport.current;
      scheduleViewport({ ...current, x: current.x + x, y: current.y + y });
    }
  }, [paintPendingViewport, scheduleViewport]);

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
      if ((event.target as Element | null)?.closest?.("[data-flow-edge-toolbar]")) {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        return;
      }
      event.preventDefault();
      // Drag math divides by the viewport captured at pointer-down; changing
      // the viewport mid-gesture would slide the dragged content away from
      // the cursor, so the wheel yields until the gesture ends.
      if (panRef.current !== null || hasActiveCanvasDrag()) {
        return;
      }
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
        }, true);
      } else {
        const panDelta = wheelPanPixelDelta(
          event.deltaX,
          event.deltaY,
          event.deltaMode,
          container.getBoundingClientRect().height,
        );
        scheduleViewport({
          ...current,
          x: current.x - panDelta.x,
          y: current.y - panDelta.y,
        }, true);
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

  // Space mirrors the main map: hold to pan, a tap without panning opens the
  // editor for the current selection.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        ignoresSpaceShortcut(event.target, ".flow-canvas")
      ) {
        return;
      }
      event.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        spaceUsedForPanRef.current = false;
        setPanCursor(panRef.current ? "grabbing" : "grab");
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || !spaceHeldRef.current) return;
      event.preventDefault();
      spaceHeldRef.current = false;
      setPanCursor(panRef.current ? "grabbing" : null);
      if (spaceUsedForPanRef.current) {
        spaceUsedForPanRef.current = false;
        flushViewport();
      } else {
        onSpaceTapRef.current?.();
      }
    };
    const handleBlur = () => {
      if (!spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      setPanCursor(null);
      if (spaceUsedForPanRef.current) {
        spaceUsedForPanRef.current = false;
        flushViewport();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [flushViewport, setPanCursor]);

  const panBy = useCallback((x: number, y: number) => {
    if (x === 0 && y === 0) return;
    const current = liveViewport.current;
    scheduleViewport({ ...current, x: current.x + x, y: current.y + y });
  }, [scheduleViewport]);
  const getViewport = useCallback(() => liveViewport.current, []);

  return {
    containerRef,
    contentRef,
    fit,
    focusSelected,
    revealEditor,
    zoomIn,
    zoomOut,
    resetZoom,
    flushViewport,
    getViewport,
    panBy,
    panModifierHeld: spaceHeldRef,
    panSurfaceRef,
    bindings: {
      onLostPointerCapture: (event) => {
        if (panRef.current?.pointerId !== event.pointerId) return;
        interruptPan();
      },
      onPointerCancel: (event) => {
        if (panRef.current?.pointerId !== event.pointerId) return;
        interruptPan();
      },
      onPointerDown: (event) => {
        // Left button only (middle button is reserved for panning by the
        // main map); right-click must never start a viewport drag.
        if (event.button !== 0 && event.button !== 1) return;
        if (hasActiveCanvasDrag()) return;
        paintPendingViewport();
        const spacePan = spaceHeldRef.current && event.button === 0;
        if (event.target !== event.currentTarget && !spacePan) return;
        if (spacePan) {
          spaceUsedForPanRef.current = true;
        } else {
          canvasPointerDownRef.current();
        }
        const captureElement = panSurfaceRef.current ?? event.currentTarget;
        panRef.current = {
          captureElement,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          viewport: liveViewport.current,
        };
        setPanCursor("grabbing");
        captureElement.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const pan = panRef.current;
        if (!pan || pan.pointerId !== event.pointerId) return;
        scheduleViewport({
          ...pan.viewport,
          x: pan.viewport.x + event.clientX - pan.x,
          y: pan.viewport.y + event.clientY - pan.y,
        }, true);
      },
      onPointerUp: (event) => {
        const pan = panRef.current;
        if (pan?.pointerId !== event.pointerId) return;
        panRef.current = null;
        setPanCursor(spaceHeldRef.current ? "grab" : null);
        scheduleViewport({
          ...pan.viewport,
          x: pan.viewport.x + event.clientX - pan.x,
          y: pan.viewport.y + event.clientY - pan.y,
        });
        releaseOwnedPointerCapture(pan.captureElement, pan.pointerId);
        flushViewport();
      },
    },
  };
}
