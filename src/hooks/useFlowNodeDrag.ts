import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { FlowLayoutResult } from "../model/flowLayout";
import type { FlowNodePosition, FlowSpace } from "../types/mindmap";

interface FlowNodeDragOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  layout: FlowLayoutResult;
  onMove: (
    nodeId: string,
    position: FlowNodePosition,
    currentPositions: Record<string, FlowNodePosition>,
  ) => void;
  onSelect: (id: string | null) => void;
  space: FlowSpace;
}

interface ActiveFlowNodeDrag {
  base: FlowNodePosition;
  currentPositions: Record<string, FlowNodePosition>;
  element: HTMLElement;
  moved: boolean;
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}

export function useFlowNodeDrag({
  containerRef,
  layout,
  onMove,
  onSelect,
  space,
}: FlowNodeDragOptions) {
  const activeRef = useRef<ActiveFlowNodeDrag | null>(null);
  const spaceIdRef = useRef(space.id);

  const releaseCapture = useCallback((pointerId: number) => {
    const canvas = containerRef.current;
    if (canvas?.hasPointerCapture?.(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }, [containerRef]);

  const clear = useCallback((focus = true) => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    active.element.style.removeProperty("transform");
    active.element.classList.remove("is-dragging");
    releaseCapture(active.pointerId);
    if (focus) {
      window.requestAnimationFrame(() =>
        containerRef.current?.focus({ preventScroll: true }),
      );
    }
  }, [containerRef, releaseCapture]);

  const begin = useCallback((
    nodeId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    const canvas = containerRef.current;
    const node = layout.nodes[nodeId];
    const element = event.currentTarget.closest<HTMLElement>("[data-flow-node-id]");
    if (!canvas || !node || !element) return;
    onSelect(nodeId);
    const currentPositions = Object.fromEntries(
      Object.entries(layout.nodes).map(([id, position]) => [
        id,
        { x: position.x, y: position.y },
      ]),
    );
    activeRef.current = {
      base: { x: node.x, y: node.y },
      currentPositions,
      element,
      moved: false,
      nodeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    canvas.setPointerCapture?.(event.pointerId);
  }, [containerRef, layout.nodes, onSelect]);

  const update = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const deltaX = (event.clientX - active.startClientX) / space.viewport.zoom;
    const deltaY = (event.clientY - active.startClientY) / space.viewport.zoom;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance >= 4) {
      active.moved = true;
      active.element.classList.add("is-dragging");
      active.element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    }
    return true;
  }, [space.viewport.zoom]);

  const pointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const deltaX = (event.clientX - active.startClientX) / space.viewport.zoom;
    const deltaY = (event.clientY - active.startClientY) / space.viewport.zoom;
    const shouldCommit = active.moved || Math.hypot(deltaX, deltaY) >= 4;
    const position = {
      x: active.base.x + deltaX,
      y: active.base.y + deltaY,
    };
    const { currentPositions, nodeId } = active;
    clear();
    if (shouldCommit) onMove(nodeId, position, currentPositions);
    return true;
  }, [clear, onMove, space.viewport.zoom]);

  const pointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeRef.current?.pointerId !== event.pointerId) return false;
    clear();
    return true;
  }, [clear]);

  const lostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeRef.current?.pointerId === event.pointerId) clear();
  }, [clear]);

  useEffect(() => {
    const cancel = () => clear();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") clear(false);
    };
    window.addEventListener("keydown", escape, { capture: true });
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", escape, { capture: true });
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clear]);

  useEffect(() => {
    if (spaceIdRef.current === space.id) return;
    spaceIdRef.current = space.id;
    clear(false);
  }, [clear, space.id]);

  useEffect(() => () => clear(false), [clear]);

  return {
    begin,
    active: () => activeRef.current !== null,
    lostPointerCapture,
    pointerCancel,
    pointerMove: update,
    pointerUp,
  };
}
