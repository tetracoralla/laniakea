import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";
import { nodeInlinePadding } from "../../model/layout";
import { subspacePreview } from "../../model/subspacePreview";
import { passedDragThreshold } from "../../model/marquee";
import {
  releaseOwnedPointerCapture,
  useDragInterruption,
} from "../../hooks/useDragInterruption";
import type { BranchTone, LaniakeaSpace, LayoutNode } from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface SubspacePortalNodeProps {
  darkTone?: BranchTone;
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
  captureElement: HTMLElement;
}

const dragThreshold = 5;

export const SubspacePortalNode = memo(function SubspacePortalNode({
  darkTone,
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
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PortalDragState | null>(null);
  const suppressClickRef = useRef(false);
  const preview = useMemo(() => subspacePreview(space), [space, locale]);

  const clearDropTarget = useCallback(() => {
    document
      .querySelector(".mind-node.is-portal-drop-target")
      ?.classList.remove("is-portal-drop-target");
  }, []);

  const resetDrag = useCallback(() => {
    clearDropTarget();
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) {
      releaseOwnedPointerCapture(drag.captureElement, drag.pointerId);
    }
    const container = containerRef.current;
    if (!container) return;
    container.classList.remove("is-dragging");
    container.style.removeProperty("transform");
    container.style.removeProperty("pointer-events");
  }, [clearDropTarget]);

  useDragInterruption({
    hasActiveDrag: () => Boolean(dragRef.current),
    onCancel: resetDrag,
  });

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
      captureElement: event.currentTarget,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (
      !drag.dragged &&
      !passedDragThreshold(
        { x: drag.startX, y: drag.startY },
        { x: event.clientX, y: event.clientY },
        dragThreshold,
      )
    ) {
      return;
    }
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
      className={`subspace-portal subspace-portal--${space.type} subspace-portal--${layout.tone} subspace-portal--${layout.depth === 1 ? "branch" : layout.depth === 2 ? "secondary" : "leaf"} ${selected ? "is-selected" : ""}`}
      data-subspace-anchor-id={anchorId}
      data-dark-tone={darkTone}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(anchorId);
        const bounds = event.currentTarget.getBoundingClientRect();
        onOpenContextMenu(anchorId, bounds, event.currentTarget);
      }}
      ref={containerRef}
      style={{
        "--node-padding-inline": `${nodeInlinePadding(layout.depth)}px`,
        height: layout.height,
        left: layout.x,
        top: layout.y,
        width: layout.width,
      } as CSSProperties}
    >
      <button
        aria-label={t("{0}概要：{1}", preview.typeLabel, preview.text)}
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
        <span className="subspace-portal__summary">{preview.text}</span>
      </button>
      <button
        aria-label={preview.accessibleLabel}
        className="subspace-portal__open"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(anchorId);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title={t("进入{0}", preview.typeLabel)}
        type="button"
      >
        <Icon name="layers" size={14} />
      </button>
    </div>
  );
});
