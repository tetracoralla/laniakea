import {
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";
import {
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

interface SelectGesture {
  kind: "select";
  pointerId: number;
  start: CanvasPoint;
  current: CanvasPoint;
  additive: boolean;
  baseSelection: SelectionState;
  previewSelection: SelectionState;
}

interface PanGesture {
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
  containerRef: RefObject<HTMLDivElement | null>;
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
  bindings: CanvasGestureBindings;
}

export function ignoresSpaceShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (
    element.matches("input, textarea, select, [contenteditable='true']") ||
    element.closest("[role='dialog']")
  ) {
    return true;
  }
  if (element.closest(".mindmap-canvas")) return false;
  return Boolean(
    element.matches("button, a, summary") ||
      element.closest(
        "button, a, summary, [role='button'], [role='menuitem']",
      ),
  );
}

export function useCanvasGestures({
  containerRef,
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
  const [spaceMode, setSpaceMode] = useState(false);
  const [gesture, setGestureState] = useState<CanvasGesture | null>(null);

  const setGesture = (next: CanvasGesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };

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
      if (gestureRef.current?.kind === "pan") {
        onViewportChange(liveViewport.current);
      }
      spaceHeld.current = false;
      spaceUsedForPan.current = false;
      setSpaceMode(false);
      setGesture(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
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
      if (!suppressNextClick.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick.current = false;
    },
    onPointerDown: (event) => {
      const wantsPan = event.button === 1 || spaceHeld.current;
      const wantsSelection =
        event.button === 0 && event.target === event.currentTarget;
      if (!wantsPan && !wantsSelection) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (wantsPan) {
        if (spaceHeld.current) spaceUsedForPan.current = true;
        setGesture({
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
      setGesture({
        kind: "select",
        pointerId: event.pointerId,
        start: point,
        current: point,
        additive: event.shiftKey,
        baseSelection: selection,
        previewSelection: selection,
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
        setGesture({ ...currentGesture, current });
        return;
      }
      const hits = nodesInsideMarquee(
        layout,
        liveViewport.current,
        rectFromPoints(currentGesture.start, current),
      );
      const previewSelection = currentGesture.additive
        ? addToSelection(
            currentGesture.baseSelection,
            hits,
            layout.visibleIds,
          )
        : createSelection(hits, layout.visibleIds, hits[0]);
      setGesture({
        ...currentGesture,
        current,
        previewSelection,
      });
    },
    onPointerUp: (event) => {
      const currentGesture = gestureRef.current;
      if (
        !currentGesture ||
        currentGesture.pointerId !== event.pointerId
      ) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (currentGesture.kind === "pan") {
        suppressNextClick.current = currentGesture.moved;
        onViewportChange(liveViewport.current);
      } else if (
        passedDragThreshold(
          currentGesture.start,
          currentGesture.current,
        )
      ) {
        onSelectionChange(currentGesture.previewSelection);
      } else {
        onSelectionChange(emptySelection());
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
      if (currentGesture.kind === "pan") {
        onViewportChange(liveViewport.current);
      }
      setGesture(null);
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
      ? rectFromPoints(gesture.start, gesture.current)
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
    bindings,
  };
}
