import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { FlowLayoutResult } from "../model/flowLayout";
import { ignoresSpaceShortcut } from "./useCanvasGestures";
import {
  hasActiveCanvasDrag,
  releaseOwnedPointerCapture,
  useDragInterruption,
} from "./useDragInterruption";
import {
  canvasZoomFromWheel,
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
  flushViewport: () => void;
  panBy: (x: number, y: number) => void;
  /** Live ref: true while Space is held (the pan modifier). */
  panModifierHeld: RefObject<boolean>;
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

  const interruptPan = useCallback(() => {
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null;
    releaseOwnedPointerCapture(pan.captureElement, pan.pointerId);
    spaceHeldRef.current = false;
    spaceUsedForPanRef.current = false;
    flushViewport();
  }, [flushViewport]);

  useDragInterruption({
    hasActiveDrag: () => panRef.current !== null,
    onCancel: interruptPan,
  });

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
        });
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
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || !spaceHeldRef.current) return;
      event.preventDefault();
      spaceHeldRef.current = false;
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
  }, [flushViewport]);

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
    panModifierHeld: spaceHeldRef,
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
        const spacePan = spaceHeldRef.current && event.button === 0;
        if (event.target !== event.currentTarget && !spacePan) return;
        if (spacePan) {
          spaceUsedForPanRef.current = true;
        } else {
          canvasPointerDownRef.current();
        }
        panRef.current = {
          captureElement: event.currentTarget,
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
        const pan = panRef.current;
        if (pan?.pointerId !== event.pointerId) return;
        panRef.current = null;
        releaseOwnedPointerCapture(pan.captureElement, pan.pointerId);
        flushViewport();
      },
    },
  };
}
