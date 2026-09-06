import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useDragInterruption } from "./useDragInterruption";
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
  onPreview?: (preview: { nodeId: string; position: FlowNodePosition } | null) => void;
  space: FlowSpace;
}

interface ActiveFlowNodeDrag {
  base: FlowNodePosition;
  zoom: number;
  currentPositions: Record<string, FlowNodePosition>;
  element: HTMLElement;
  moved: boolean;
  nodeId: string;
  pointerId: number;
  panX: number;
  panY: number;
  lastClientX: number;
  lastClientY: number;
  startClientX: number;
  startClientY: number;
}

export function useFlowNodeDrag({
  containerRef,
  layout,
  onMove,
  onSelect,
  onPreview = () => undefined,
  space,
}: FlowNodeDragOptions) {
  const activeRef = useRef<ActiveFlowNodeDrag | null>(null);
  const spaceIdRef = useRef(space.id);
  const frameRef = useRef(0);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const renderPreview = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const active = activeRef.current;
      if (!active) return;
      onPreviewRef.current({ nodeId: active.nodeId, position: {
        x: active.base.x + (active.lastClientX - active.startClientX - active.panX) / active.zoom,
        y: active.base.y + (active.lastClientY - active.startClientY - active.panY) / active.zoom,
      } });
    });
  }, []);

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
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    onPreviewRef.current(null);
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
      zoom: space.viewport.zoom,
      currentPositions,
      element,
      moved: false,
      nodeId,
      pointerId: event.pointerId,
      panX: 0,
      panY: 0,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };

  }, [containerRef, layout.nodes, onSelect, space.viewport.zoom]);

  const update = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    active.lastClientX = event.clientX;
    active.lastClientY = event.clientY;
    const deltaX = (event.clientX - active.startClientX - active.panX) / active.zoom;
    const deltaY = (event.clientY - active.startClientY - active.panY) / active.zoom;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance >= 4) {
      if (!active.moved) containerRef.current?.setPointerCapture?.(event.pointerId);
      active.moved = true;
      active.element.classList.add("is-dragging");
      renderPreview();
    }
    return true;
  }, [containerRef, renderPreview, space.viewport.zoom]);

  const pointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const deltaX = (event.clientX - active.startClientX - active.panX) / active.zoom;
    const deltaY = (event.clientY - active.startClientY - active.panY) / active.zoom;
    const shouldCommit = active.moved || Math.hypot(deltaX, deltaY) >= 4;
    const position = {
      x: active.base.x + deltaX,
      y: active.base.y + deltaY,
    };
    const { currentPositions, nodeId } = active;
    clear(shouldCommit);
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

  useDragInterruption({
    hasActiveDrag: () => activeRef.current !== null,
    onCancel: () => clear(),
  });

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    if (spaceIdRef.current === space.id) return;
    spaceIdRef.current = space.id;
    clear(false);
  }, [clear, space.id]);

  return {
    begin,
    active: () => activeRef.current !== null,
    lostPointerCapture,
    pointerCancel,
    pointerMove: update,
    pointerUp,
    shiftViewport: (x: number, y: number) => {
      const active = activeRef.current;
      if (!active) return;
      active.panX += x;
      active.panY += y;
      active.moved = true;
      active.element.classList.add("is-dragging");
      renderPreview();
    },
  };
}
