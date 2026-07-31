import {
  useCallback,
  useRef,
  useState,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";
import type {
  LayoutResult,
  MindMapDocument,
  Viewport,
} from "../types/mindmap";
import { passedDragThreshold, type CanvasPoint } from "../model/marquee";
import {
  clientPointToCanvas,
  floatingPositionFromPointer,
  layoutNodeAtPoint,
  pointTouchesAnyNode,
} from "../model/nodeDrag";

interface NodeDragGesture {
  pointerId: number;
  nodeId: string;
  startClient: CanvasPoint;
  grabOffset: CanvasPoint;
  excludedIds: Set<string>;
  moved: boolean;
  point: CanvasPoint;
  dropTargetId: string | null;
  invalidTarget: boolean;
  captureElement: HTMLElement;
}

interface NodeDragOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  panModifierHeld: RefObject<boolean>;
  document: MindMapDocument;
  layout: LayoutResult;
  editingId: string | null;
  liveViewport: RefObject<Viewport>;
  onAttach: (id: string, parentId: string) => void;
  onDetach: (id: string, position: CanvasPoint) => void;
}

interface NodeDragBindings {
  onClickCapture: MouseEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
}

function subtreeIds(document: MindMapDocument, rootId: string): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    const node = document.nodes[id];
    if (!node || ids.has(id)) return;
    ids.add(id);
    node.children.forEach(visit);
  };
  visit(rootId);
  return ids;
}

export function useNodeDrag({
  containerRef,
  previewRef,
  panModifierHeld,
  document,
  layout,
  editingId,
  liveViewport,
  onAttach,
  onDetach,
}: NodeDragOptions): {
  beginNodeDrag: PointerEventHandler<HTMLDivElement>;
  bindings: NodeDragBindings;
  draggingId: string | null;
  dropTargetId: string | null;
} {
  const gestureRef = useRef<NodeDragGesture | null>(null);
  const suppressNextClick = useRef(false);
  const documentRef = useRef(document);
  const layoutRef = useRef(layout);
  const editingIdRef = useRef(editingId);
  const onAttachRef = useRef(onAttach);
  const onDetachRef = useRef(onDetach);
  documentRef.current = document;
  layoutRef.current = layout;
  editingIdRef.current = editingId;
  onAttachRef.current = onAttach;
  onDetachRef.current = onDetach;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const hidePreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.style.opacity = "0";
    }
  }, [previewRef]);

  const clearGesture = useCallback(() => {
    gestureRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    hidePreview();
  }, [hidePreview]);

  const beginNodeDrag: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const id = event.currentTarget.dataset.nodeId;
      const container = containerRef.current;
      const target = event.target;
      const currentDocument = documentRef.current;
      const currentLayout = layoutRef.current;
      if (
        event.button !== 0 ||
        panModifierHeld.current ||
        !id ||
        id === currentDocument.rootId ||
        editingIdRef.current !== null ||
        !container ||
        !(target instanceof Element) ||
        !target.closest(".mind-node__content")
      ) {
        return;
      }
      const source = currentLayout.nodes[id];
      if (!source) return;
      const point = clientPointToCanvas(
        event.clientX,
        event.clientY,
        container.getBoundingClientRect(),
        liveViewport.current,
      );
      gestureRef.current = {
        pointerId: event.pointerId,
        nodeId: id,
        startClient: { x: event.clientX, y: event.clientY },
        grabOffset: {
          x: point.x - source.x,
          y: point.y - source.y,
        },
        excludedIds: subtreeIds(currentDocument, id),
        moved: false,
        point,
        dropTargetId: null,
        invalidTarget: false,
        captureElement: event.currentTarget,
      };
    },
    [containerRef, liveViewport, panModifierHeld],
  );

  const bindings: NodeDragBindings = {
    onClickCapture: (event) => {
      if (!suppressNextClick.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick.current = false;
    },
    onPointerMove: (event) => {
      const gesture = gestureRef.current;
      const container = containerRef.current;
      if (
        !gesture ||
        gesture.pointerId !== event.pointerId ||
        !container
      ) {
        return;
      }
      const moved =
        gesture.moved ||
        passedDragThreshold(gesture.startClient, {
          x: event.clientX,
          y: event.clientY,
        });
      const point = clientPointToCanvas(
        event.clientX,
        event.clientY,
        container.getBoundingClientRect(),
        liveViewport.current,
      );
      if (!moved) {
        gesture.point = point;
        return;
      }

      event.preventDefault();
      if (
        !gesture.moved &&
        !gesture.captureElement.hasPointerCapture(event.pointerId)
      ) {
        gesture.captureElement.setPointerCapture(event.pointerId);
      }
      const targetId = layoutNodeAtPoint(
        layoutRef.current,
        point,
        gesture.excludedIds,
      );
      const invalidTarget =
        !targetId &&
        pointTouchesAnyNode(
          layoutRef.current,
          point,
          gesture.excludedIds,
        );
      gesture.moved = true;
      gesture.point = point;
      gesture.dropTargetId = targetId;
      gesture.invalidTarget = invalidTarget;
      if (draggingId !== gesture.nodeId) {
        setDraggingId(gesture.nodeId);
      }
      if (dropTargetId !== targetId) {
        setDropTargetId(targetId);
      }
      const preview = previewRef.current;
      if (preview) {
        const position = floatingPositionFromPointer(
          point,
          gesture.grabOffset,
        );
        preview.style.opacity = invalidTarget ? "0.45" : "0.82";
        preview.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      }
    },
    onPointerUp: (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (gesture.captureElement.hasPointerCapture(event.pointerId)) {
        gesture.captureElement.releasePointerCapture(event.pointerId);
      }
      if (gesture.moved) {
        suppressNextClick.current = true;
        if (gesture.dropTargetId) {
          onAttachRef.current(gesture.nodeId, gesture.dropTargetId);
        } else if (!gesture.invalidTarget) {
          onDetachRef.current(
            gesture.nodeId,
            floatingPositionFromPointer(
              gesture.point,
              gesture.grabOffset,
            ),
          );
        }
      }
      clearGesture();
    },
    onPointerCancel: (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      clearGesture();
    },
  };

  return {
    beginNodeDrag,
    bindings,
    draggingId,
    dropTargetId,
  };
}
