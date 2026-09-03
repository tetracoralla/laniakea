import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { subspacePreview } from "../../model/subspacePreview";
import type { LaniakeaSpace, LayoutNode } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface SubspacePortalNodeProps {
  anchorId: string;
  canMoveTo: (nodeId: string) => boolean;
  layout: LayoutNode;
  onMove: (sourceNodeId: string, targetNodeId: string) => void;
  onOpen: (anchorId: string) => void;
  onOpenContextMenu: (
    anchorId: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onSelect: (anchorId: string) => void;
  selected: boolean;
  space: LaniakeaSpace;
  zoom: number;
}

interface PortalDragState {
  dragged: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  targetId: string | null;
}

const dragThreshold = 5;

export const SubspacePortalNode = memo(function SubspacePortalNode({
  anchorId,
  canMoveTo,
  layout,
  onMove,
  onOpen,
  onOpenContextMenu,
  onSelect,
  selected,
  space,
  zoom,
}: SubspacePortalNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PortalDragState | null>(null);
  const suppressClickRef = useRef(false);
  const preview = useMemo(() => subspacePreview(space), [space]);

  const clearDropTarget = useCallback(() => {
    document
      .querySelector(".mind-node.is-portal-drop-target")
      ?.classList.remove("is-portal-drop-target");
  }, []);

  const resetDrag = useCallback(() => {
    clearDropTarget();
    dragRef.current = null;
    const container = containerRef.current;
    if (!container) return;
    container.classList.remove("is-dragging");
    container.style.removeProperty("transform");
    container.style.removeProperty("pointer-events");
  }, [clearDropTarget]);

  useEffect(() => {
    const cancel = () => resetDrag();
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      resetDrag();
    };
    const cancelWhenHidden = () => {
      if (document.visibilityState !== "visible") resetDrag();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", cancelOnEscape, true);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", cancelOnEscape, true);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      resetDrag();
    };
  }, [resetDrag]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(anchorId);
    dragRef.current = {
      dragged: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      targetId: null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.dragged && Math.hypot(deltaX, deltaY) < dragThreshold) return;
    drag.dragged = true;
    suppressClickRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    container.classList.add("is-dragging");
    container.style.transform = `translate3d(${deltaX / Math.max(zoom, 0.01)}px, ${deltaY / Math.max(zoom, 0.01)}px, 0)`;

    container.style.pointerEvents = "none";
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(".mind-node[data-node-id]");
    container.style.removeProperty("pointer-events");
    const targetId = target?.dataset.nodeId ?? null;
    const validTargetId =
      targetId && canMoveTo(targetId) ? targetId : null;
    if (drag.targetId === validTargetId) return;
    clearDropTarget();
    drag.targetId = validTargetId;
    if (validTargetId) target?.classList.add("is-portal-drop-target");
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetId = drag.dragged ? drag.targetId : null;
    resetDrag();
    if (targetId) onMove(anchorId, targetId);
  };

  return (
    <div
      className={`subspace-portal subspace-portal--${space.type} subspace-portal--${layout.tone} ${selected ? "is-selected" : ""}`}
      data-subspace-anchor-id={anchorId}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(anchorId);
        const bounds = event.currentTarget.getBoundingClientRect();
        onOpenContextMenu(anchorId, bounds, event.currentTarget);
      }}
      ref={containerRef}
      style={{
        height: layout.height,
        left: layout.x,
        top: layout.y,
        width: layout.width,
      }}
    >
      <button
        aria-label={`${preview.typeLabel}概要：${preview.text}`}
        aria-pressed={selected}
        className="subspace-portal__content"
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            event.preventDefault();
            return;
          }
          onSelect(anchorId);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!suppressClickRef.current) onOpen(anchorId);
          suppressClickRef.current = false;
        }}
        onLostPointerCapture={(event) => {
          event.stopPropagation();
          resetDrag();
        }}
        onPointerCancel={(event) => {
          event.stopPropagation();
          resetDrag();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          event.stopPropagation();
          finishDrag(event);
        }}
        type="button"
      >
        {space.type === "map" ? (
          <span className="subspace-portal__map-summary">
            {preview.lines.map((line, index) => (
              <span key={`${index}:${line}`}>{line}</span>
            ))}
          </span>
        ) : (
          <span className="subspace-portal__flow-summary">{preview.text}</span>
        )}
      </button>
      <button
        aria-label={preview.accessibleLabel}
        className="subspace-portal__open"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(anchorId);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title={`进入${preview.typeLabel}`}
        type="button"
      >
        <Icon name="layers" size={14} />
      </button>
    </div>
  );
});
