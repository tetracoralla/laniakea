import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  attachedNodeDetachTravel,
  buildNodeDropSpatialIndex,
  childInsertionPosition,
  clientPointToCanvas,
  dragConnectorPath,
  floatingPositionFromPointer,
  nodeDropParentHitTest,
  nodeDropCandidateIds,
} from "../model/nodeDrag";

export type NodeDropIntent = "attach" | "detach" | "retain";

interface NodeDragGesture {
  document: MindMapDocument;
  pointerId: number;
  nodeId: string;
  startClient: CanvasPoint;
  grabOffset: CanvasPoint;
  excludedIds: Set<string>;
  startedFloating: boolean;
  moved: boolean;
  point: CanvasPoint;
  dropTargetId: string | null;
  dropPosition: number | null;
  dropIntent: NodeDropIntent;
  captureElement: HTMLElement;
}

interface NodeDragOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  connectorPreviewRef: RefObject<SVGPathElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  panModifierHeld: RefObject<boolean>;
  document: MindMapDocument;
  layout: LayoutResult;
  editingId: string | null;
  liveViewport: RefObject<Viewport>;
  onAttach: (id: string, parentId: string, position: number) => void;
  onDetach: (id: string, position: CanvasPoint) => void;
}

interface NodeDragBindings {
  onClickCapture: MouseEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
}

function subtreeIds(document: MindMapDocument, rootId: string): Set<string> {
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id) continue;
    const node = document.nodes[id];
    if (!node || ids.has(id)) continue;
    ids.add(id);
    pending.push(...node.children);
  }
  return ids;
}

export function useNodeDrag({
  containerRef,
  connectorPreviewRef,
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
  dropPosition: number | null;
  dropIntent: NodeDropIntent | null;
} {
  const gestureRef = useRef<NodeDragGesture | null>(null);
  const suppressNextClick = useRef(false);
  const documentRef = useRef(document);
  const layoutRef = useRef(layout);
  const dropSpatialIndex = useMemo(
    () => buildNodeDropSpatialIndex(layout),
    [layout],
  );
  const dropSpatialIndexRef = useRef(dropSpatialIndex);
  const editingIdRef = useRef(editingId);
  const onAttachRef = useRef(onAttach);
  const onDetachRef = useRef(onDetach);
  documentRef.current = document;
  layoutRef.current = layout;
  dropSpatialIndexRef.current = dropSpatialIndex;
  editingIdRef.current = editingId;
  onAttachRef.current = onAttach;
  onDetachRef.current = onDetach;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<number | null>(null);
  const [dropIntent, setDropIntent] = useState<NodeDropIntent | null>(null);

  const hidePreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.style.opacity = "0";
      delete previewRef.current.dataset.dropIntent;
      delete previewRef.current.dataset.dropPosition;
    }
    if (connectorPreviewRef.current) {
      connectorPreviewRef.current.style.opacity = "0";
      connectorPreviewRef.current.setAttribute("d", "");
    }
  }, [connectorPreviewRef, previewRef]);

  const syncPreview = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture?.moved) return;
    const source = layoutRef.current.nodes[gesture.nodeId];
    if (!source) return;
    const position = floatingPositionFromPointer(
      gesture.point,
      gesture.grabOffset,
    );
    const preview = previewRef.current;
    if (preview) {
      preview.dataset.dropIntent = gesture.dropIntent;
      if (gesture.dropPosition === null) {
        delete preview.dataset.dropPosition;
      } else {
        preview.dataset.dropPosition = String(gesture.dropPosition);
      }
      preview.style.opacity =
        gesture.dropIntent === "retain" ? "0.58" : "0.86";
      preview.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }

    const connector = connectorPreviewRef.current;
    const parent = gesture.dropTargetId
      ? layoutRef.current.nodes[gesture.dropTargetId]
      : null;
    if (connector && parent && gesture.dropIntent === "attach") {
      connector.setAttribute(
        "d",
        dragConnectorPath(parent, {
          ...position,
          height: source.height,
          width: source.width,
        }),
      );
      connector.style.opacity = "1";
    } else if (connector) {
      connector.style.opacity = "0";
      connector.setAttribute("d", "");
    }
  }, [connectorPreviewRef, previewRef]);

  const clearGesture = useCallback((suppressClick = false) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (
      gesture &&
      gesture.captureElement.hasPointerCapture(gesture.pointerId)
    ) {
      gesture.captureElement.releasePointerCapture(gesture.pointerId);
    }
    if (suppressClick && gesture?.moved) {
      suppressNextClick.current = true;
    }
    setDraggingId(null);
    setDropTargetId(null);
    setDropPosition(null);
    setDropIntent(null);
    hidePreview();
  }, [hidePreview]);

  useLayoutEffect(() => {
    syncPreview();
  }, [draggingId, dropIntent, dropPosition, dropTargetId, syncPreview]);

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (
      gesture &&
      (gesture.document !== document ||
        !document.nodes[gesture.nodeId] ||
        editingId !== null)
    ) {
      clearGesture(true);
    }
  }, [clearGesture, document, editingId]);

  useEffect(() => {
    const cancelForInterruption = () => clearGesture(true);
    const handleVisibilityChange = () => {
      if (globalThis.document.visibilityState === "hidden") {
        cancelForInterruption();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gestureRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelForInterruption();
    };

    globalThis.window.addEventListener("blur", cancelForInterruption);
    globalThis.window.addEventListener("keydown", handleKeyDown, true);
    globalThis.document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    return () => {
      globalThis.window.removeEventListener("blur", cancelForInterruption);
      globalThis.window.removeEventListener("keydown", handleKeyDown, true);
      globalThis.document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      clearGesture();
    };
  }, [clearGesture]);

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
        document: currentDocument,
        pointerId: event.pointerId,
        nodeId: id,
        startClient: { x: event.clientX, y: event.clientY },
        grabOffset: {
          x: point.x - source.x,
          y: point.y - source.y,
        },
        excludedIds: subtreeIds(currentDocument, id),
        startedFloating: source.rootKind === "floating",
        moved: false,
        point,
        dropTargetId: null,
        dropPosition: null,
        dropIntent: "retain",
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
    onLostPointerCapture: (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      clearGesture(true);
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
      const source = layoutRef.current.nodes[gesture.nodeId];
      if (!source) return;
      const position = floatingPositionFromPointer(
        point,
        gesture.grabOffset,
      );
      const probe = {
        ...position,
        height: source.height,
        width: source.width,
      };
      const scale = 1 / liveViewport.current.zoom;
      const candidateIds = nodeDropCandidateIds(
        dropSpatialIndexRef.current,
        probe,
        scale,
      );
      const hit = nodeDropParentHitTest(
        layoutRef.current,
        probe,
        gesture.excludedIds,
        scale,
        candidateIds,
      );
      const targetId = hit.targetId;
      const nextDropPosition = targetId
        ? childInsertionPosition(
            documentRef.current,
            layoutRef.current,
            targetId,
            gesture.nodeId,
            probe,
          )
        : null;
      const hasDetachTravel = passedDragThreshold(
        gesture.startClient,
        { x: event.clientX, y: event.clientY },
        attachedNodeDetachTravel,
      );
      const nextDropIntent: NodeDropIntent = targetId
        ? "attach"
        : !hit.blockedByDraggedSubtree &&
            (gesture.startedFloating || hasDetachTravel)
          ? "detach"
          : "retain";
      gesture.moved = true;
      gesture.point = point;
      gesture.dropTargetId = targetId;
      gesture.dropPosition = nextDropPosition;
      gesture.dropIntent = nextDropIntent;
      setDraggingId((current) =>
        current === gesture.nodeId ? current : gesture.nodeId,
      );
      setDropTargetId((current) =>
        current === targetId ? current : targetId,
      );
      setDropPosition((current) =>
        current === nextDropPosition ? current : nextDropPosition,
      );
      setDropIntent((current) =>
        current === nextDropIntent ? current : nextDropIntent,
      );
      syncPreview();
    },
    onPointerUp: (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      clearGesture(gesture.moved);
      if (gesture.moved) {
        if (
          gesture.dropIntent === "attach" &&
          gesture.dropTargetId &&
          gesture.dropPosition !== null
        ) {
          onAttachRef.current(
            gesture.nodeId,
            gesture.dropTargetId,
            gesture.dropPosition,
          );
        } else if (gesture.dropIntent === "detach") {
          onDetachRef.current(
            gesture.nodeId,
            floatingPositionFromPointer(
              gesture.point,
              gesture.grabOffset,
            ),
          );
        }
      }
    },
    onPointerCancel: (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      clearGesture(true);
    },
  };

  return {
    beginNodeDrag,
    bindings,
    draggingId,
    dropTargetId,
    dropPosition,
    dropIntent,
  };
}
