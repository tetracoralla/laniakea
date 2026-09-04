import {
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";
import {
  canvasPointToContent,
  contentPointToCanvas,
  marqueeAutoPanVelocity,
  nodesInsideMarquee,
  passedDragThreshold,
  rectFromPoints,
  type CanvasPoint,
  type CanvasRect,
} from "../model/marquee";
import {
  addToSelection,
  createSelection,
  emptySelection,
} from "../model/selection";
import type {
  LayoutResult,
  SelectionState,
  Viewport,
} from "../types/mindmap";
import {
  releaseOwnedPointerCapture,
  useDragInterruption,
} from "./useDragInterruption";

interface SelectGesture {
  captureElement: HTMLElement;
  kind: "select";
  pointerId: number;
  start: CanvasPoint;
  anchor: CanvasPoint;
  current: CanvasPoint;
  additive: boolean;
  baseSelection: SelectionState;
  clickSelection: SelectionState;
  previewSelection: SelectionState;
  viewportMoved: boolean;
  canvasSize: { width: number; height: number };
}

interface PanGesture {
  captureElement: HTMLElement;
  kind: "pan";
  pointerId: number;
  originX: number;
  originY: number;
  viewportX: number;
  viewportY: number;
  moved: boolean;
}

type CanvasGesture = SelectGesture | PanGesture;

interface CanvasGestureOptions {
  layout: LayoutResult;
  selection: SelectionState;
  editingId: string | null;
  liveViewport: RefObject<Viewport>;
  renderViewport: (viewport: Viewport) => void;
  onSelectionChange: (selection: SelectionState) => void;
  onSpaceTap: () => void;
  onViewportChange: (viewport: Viewport) => void;
}

interface CanvasGestureBindings {
  onClickCapture: MouseEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
}

interface CanvasGestureResult {
  activeSelection: SelectionState;
  marqueeRect: CanvasRect | null;
  selecting: boolean;
  className: string;
  panModifierHeld: RefObject<boolean>;
  bindings: CanvasGestureBindings;
}

export function ignoresSpaceShortcut(
  target: EventTarget | null,
  canvasSelector = ".mindmap-canvas",
): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (
    element.matches("input, textarea, select, [contenteditable='true']") ||
    element.closest("[role='dialog']")
  ) {
    return true;
  }
  if (element.closest(canvasSelector)) return false;
  return Boolean(
    element.matches("button, a, summary") ||
      element.closest(
        "button, a, summary, [role='button'], [role='menuitem']",
      ),
  );
}

export function useCanvasGestures({
  layout,
  selection,
  editingId,
  liveViewport,
  renderViewport,
  onSelectionChange,
  onSpaceTap,
  onViewportChange,
}: CanvasGestureOptions): CanvasGestureResult {
  const spaceHeld = useRef(false);
  const spaceUsedForPan = useRef(false);
  const suppressNextClick = useRef(false);
  const gestureRef = useRef<CanvasGesture | null>(null);
  const marqueeAutoPanFrame = useRef<number | null>(null);
  const marqueeAutoPanTimestamp = useRef<number | null>(null);
  const [spaceMode, setSpaceMode] = useState(false);
  const [gesture, setGestureState] = useState<CanvasGesture | null>(null);

  const setGesture = (next: CanvasGesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };

  const stopMarqueeAutoPan = () => {
    if (marqueeAutoPanFrame.current !== null) {
      window.cancelAnimationFrame(marqueeAutoPanFrame.current);
      marqueeAutoPanFrame.current = null;
    }
    marqueeAutoPanTimestamp.current = null;
  };

  const marqueeRectForGesture = (
    currentGesture: SelectGesture,
    viewport: Viewport,
  ) =>
    rectFromPoints(
      contentPointToCanvas(currentGesture.anchor, viewport),
      currentGesture.current,
    );

  const previewMarqueeSelection = (
    currentGesture: SelectGesture,
    viewport: Viewport,
  ) => {
    const hits = nodesInsideMarquee(
      layout,
      viewport,
      marqueeRectForGesture(currentGesture, viewport),
    );
    return currentGesture.additive
      ? addToSelection(
          currentGesture.baseSelection,
          hits,
          layout.visibleIds,
        )
      : createSelection(hits, layout.visibleIds, hits[0]);
  };

  const startMarqueeAutoPan = () => {
    if (marqueeAutoPanFrame.current !== null) return;
    const step = (timestamp: number) => {
      marqueeAutoPanFrame.current = null;
      const currentGesture = gestureRef.current;
      if (
        currentGesture?.kind !== "select" ||
        !passedDragThreshold(
          currentGesture.start,
          currentGesture.current,
        )
      ) {
        marqueeAutoPanTimestamp.current = null;
        return;
      }

      const velocity = marqueeAutoPanVelocity(
        currentGesture.current,
        currentGesture.canvasSize,
      );
      if (velocity.x === 0 && velocity.y === 0) {
        marqueeAutoPanTimestamp.current = null;
        return;
      }

      const previousTimestamp =
        marqueeAutoPanTimestamp.current ?? timestamp - 1000 / 60;
      const elapsedSeconds =
        Math.min(32, Math.max(0, timestamp - previousTimestamp)) /
        1000;
      marqueeAutoPanTimestamp.current = timestamp;
      const currentViewport = liveViewport.current;
      const nextViewport = {
        ...currentViewport,
        x: currentViewport.x - velocity.x * elapsedSeconds,
        y: currentViewport.y - velocity.y * elapsedSeconds,
      };
      renderViewport(nextViewport);
      setGesture({
        ...currentGesture,
        previewSelection: previewMarqueeSelection(
          currentGesture,
          nextViewport,
        ),
        viewportMoved: true,
      });
      marqueeAutoPanFrame.current = window.requestAnimationFrame(step);
    };
    marqueeAutoPanFrame.current = window.requestAnimationFrame(step);
  };

  const interruptGesture = () => {
    const currentGesture = gestureRef.current;
    if (!currentGesture) return;
    if (
      currentGesture.kind === "pan" ||
      currentGesture.viewportMoved
    ) {
      onViewportChange(liveViewport.current);
    }
    if (currentGesture.kind === "pan" && currentGesture.moved) {
      suppressNextClick.current = true;
    }
    releaseOwnedPointerCapture(
      currentGesture.captureElement,
      currentGesture.pointerId,
    );
    stopMarqueeAutoPan();
    spaceHeld.current = false;
    spaceUsedForPan.current = false;
    setSpaceMode(false);
    setGesture(null);
  };

  useDragInterruption({
    hasActiveDrag: () => gestureRef.current !== null,
    onCancel: interruptGesture,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        ignoresSpaceShortcut(event.target)
      ) {
        return;
      }
      event.preventDefault();
      spaceHeld.current = true;
      setSpaceMode(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " || !spaceHeld.current) return;
      event.preventDefault();
      const shouldEdit =
        !spaceUsedForPan.current &&
        selection.selectedIds.length === 1 &&
        editingId === null;
      spaceHeld.current = false;
      spaceUsedForPan.current = false;
      setSpaceMode(false);
      if (shouldEdit) onSpaceTap();
    };
    const handleBlur = () => {
      spaceHeld.current = false;
      spaceUsedForPan.current = false;
      setSpaceMode(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      stopMarqueeAutoPan();
    };
  }, [
    editingId,
    liveViewport,
    onSpaceTap,
    onViewportChange,
    selection.selectedIds.length,
  ]);

  const bindings: CanvasGestureBindings = {
    onClickCapture: (event) => {
      if (!spaceHeld.current && !suppressNextClick.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick.current = false;
    },
    onLostPointerCapture: (event) => {
      if (gestureRef.current?.pointerId !== event.pointerId) return;
      interruptGesture();
    },
    onPointerDown: (event) => {
      const wantsPan =
        event.button === 1 ||
        (event.button === 0 && spaceHeld.current);
      const wantsSelection =
        event.button === 0 && event.target === event.currentTarget;
      if (!wantsPan && !wantsSelection) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (wantsPan) {
        if (spaceHeld.current) spaceUsedForPan.current = true;
        setGesture({
          captureElement: event.currentTarget,
          kind: "pan",
          pointerId: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          viewportX: liveViewport.current.x,
          viewportY: liveViewport.current.y,
          moved: false,
        });
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();
      const point = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const additiveModifier = event.shiftKey || event.metaKey;
      setGesture({
        captureElement: event.currentTarget,
        kind: "select",
        pointerId: event.pointerId,
        start: point,
        anchor: canvasPointToContent(point, liveViewport.current),
        current: point,
        additive: additiveModifier,
        baseSelection: selection,
        // A modifier click on empty canvas keeps the current selection
        // instead of acting as an accidental clear.
        clickSelection: additiveModifier ? selection : emptySelection(),
        previewSelection: selection,
        viewportMoved: false,
        canvasSize: { width: bounds.width, height: bounds.height },
      });
    },
    onPointerMove: (event) => {
      const currentGesture = gestureRef.current;
      if (
        !currentGesture ||
        currentGesture.pointerId !== event.pointerId
      ) {
        return;
      }
      if (currentGesture.kind === "pan") {
        const moved =
          currentGesture.moved ||
          Math.hypot(
            event.clientX - currentGesture.originX,
            event.clientY - currentGesture.originY,
          ) >= 4;
        renderViewport({
          ...liveViewport.current,
          x:
            currentGesture.viewportX +
            event.clientX -
            currentGesture.originX,
          y:
            currentGesture.viewportY +
            event.clientY -
            currentGesture.originY,
        });
        if (moved !== currentGesture.moved) {
          setGesture({ ...currentGesture, moved });
        }
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();
      const current = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      if (!passedDragThreshold(currentGesture.start, current)) {
        stopMarqueeAutoPan();
        setGesture({ ...currentGesture, current });
        return;
      }
      const nextGesture = {
        ...currentGesture,
        current,
        canvasSize: { width: bounds.width, height: bounds.height },
      };
      setGesture({
        ...nextGesture,
        previewSelection: previewMarqueeSelection(
          nextGesture,
          liveViewport.current,
        ),
      });
      const velocity = marqueeAutoPanVelocity(
        current,
        nextGesture.canvasSize,
      );
      if (velocity.x === 0 && velocity.y === 0) {
        stopMarqueeAutoPan();
      } else {
        startMarqueeAutoPan();
      }
    },
    onPointerUp: (event) => {
      const currentGesture = gestureRef.current;
      if (
        !currentGesture ||
        currentGesture.pointerId !== event.pointerId
      ) {
        return;
      }
      releaseOwnedPointerCapture(
        currentGesture.captureElement,
        currentGesture.pointerId,
      );
      stopMarqueeAutoPan();
      if (currentGesture.kind === "pan") {
        suppressNextClick.current = currentGesture.moved;
        onViewportChange(liveViewport.current);
      } else if (
        passedDragThreshold(
          currentGesture.start,
          currentGesture.current,
        )
      ) {
        if (currentGesture.viewportMoved) {
          onViewportChange(liveViewport.current);
        }
        onSelectionChange(currentGesture.previewSelection);
      } else {
        onSelectionChange(currentGesture.clickSelection);
      }
      setGesture(null);
    },
    onPointerCancel: (event) => {
      const currentGesture = gestureRef.current;
      if (
        !currentGesture ||
        currentGesture.pointerId !== event.pointerId
      ) {
        return;
      }
      interruptGesture();
    },
  };

  const selecting =
    gesture?.kind === "select" &&
    passedDragThreshold(gesture.start, gesture.current);
  const activeSelection = selecting
    ? gesture.previewSelection
    : selection;
  const marqueeRect =
    selecting && gesture.kind === "select"
      ? marqueeRectForGesture(gesture, liveViewport.current)
      : null;
  const className = [
    "mindmap-canvas",
    gesture?.kind === "pan" ? "is-panning" : "",
    selecting ? "is-selecting" : "",
    spaceMode ? "is-space-held" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    activeSelection,
    marqueeRect,
    selecting: gesture?.kind === "select",
    className,
    panModifierHeld: spaceHeld,
    bindings,
  };
}
