import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FlowNodePosition } from "../types/mindmap";
import { useDragInterruption } from "./useDragInterruption";

interface ActiveLabelDrag {
  id: string;
  pointerId: number;
  element: HTMLButtonElement;
  startX: number;
  startY: number;
  original: FlowNodePosition;
  next: FlowNodePosition;
  moved: boolean;
}

export function useFlowEdgeLabelDrag(
  scopeKey: string,
  zoom: number,
  onChange: (id: string, offset: FlowNodePosition) => void,
) {
  const active = useRef<ActiveLabelDrag | null>(null);
  const frame = useRef(0);
  const [preview, setPreview] = useState<{ id: string; offset: FlowNodePosition } | null>(null);
  const cancel = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    setPreview(null);
    if (current?.element.hasPointerCapture?.(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
  }, []);
  useEffect(() => cancel, [cancel, scopeKey]);
  useDragInterruption({ hasActiveDrag: () => active.current !== null, onCancel: cancel });

  const update = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = active.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    event.preventDefault();
    event.stopPropagation();
    current.moved = true;
    current.next = { x: current.original.x + dx / zoom, y: current.original.y + dy / zoom };
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (active.current) setPreview({ id: active.current.id, offset: active.current.next });
    });
  };
  return {
    preview,
    begin: (id: string, offset: FlowNodePosition, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      active.current = {
        id, original: offset, next: offset, element: event.currentTarget,
        pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false,
      };
      // Capture on the label itself so a fast first movement cannot leave the
      // narrow hit area. Keeping the original target preserves double-clicks.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    pointerMove: update,
    pointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      update(event);
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const { id, next, moved } = current;
      cancel();
      if (moved) onChange(id, next);
    },
    cancel,
  };
}
