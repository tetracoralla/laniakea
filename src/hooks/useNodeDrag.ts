import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";
import type {
  LayoutResult,
  MindMapDocument,
  SelectionState,
  Viewport,
} from "../types/mindmap";
import { passedDragThreshold, type CanvasPoint } from "../model/marquee";
import {
  attachedNodeDetachTravel,
  buildNodeDropSpatialIndex,
  childInsertionPosition,
  clientPointToCanvas,
  dragConnectorPath,
  nodeDropParentHitTest,
  nodeDropCandidateIds,
} from "../model/nodeDrag";
import {
  createSelection,
  normalizeSelectedRoots,
  selectionEquals,
} from "../model/selection";

export type NodeDropIntent = "attach" | "detach" | "retain";

export interface DraggedRootPosition extends CanvasPoint {
  id: string;
}

interface DragRoot {
  id: string;
  offsetX: number;
  offsetY: number;
}

interface NodeDragGesture {
  document: MindMapDocument;
  pointerId: number;
  leadId: string;
  roots: DragRoot[];
  nextSelection: SelectionState;
  startClient: CanvasPoint;
  grabOffset: CanvasPoint;
  minimumOffset: CanvasPoint;
  originalParentId: string | null;
  excludedIds: Set<string>;
  startedFloating: boolean;
  moved: boolean;
  selectionChanged: boolean;
  point: CanvasPoint;
  dropTargetId: string | null;
  dropPosition: number | null;
  dropIntent: NodeDropIntent;
  captureElement: HTMLElement;
}

interface NodeDragOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  containerBoundsRef: RefObject<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>;
  connectorPreviewRef: RefObject<SVGPathElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  announcementRef: RefObject<HTMLDivElement | null>;
  panModifierHeld: RefObject<boolean>;
  document: MindMapDocument;
  layout: LayoutResult;
  selection: SelectionState;
  editingId: string | null;
  liveViewport: RefObject<Viewport>;
  onSelectionChange: (selection: SelectionState) => void;
  onAttach: (
    ids: readonly string[],
    parentId: string,
    position: number,
  ) => void;
  onDetach: (positions: readonly DraggedRootPosition[]) => void;
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

function leadPosition(
  gesture: NodeDragGesture,
  point: CanvasPoint,
): CanvasPoint {
  const unclamped = {
    x: point.x - gesture.grabOffset.x,
    y: point.y - gesture.grabOffset.y,
  };
  return {
    x: Math.round(Math.max(32 - gesture.minimumOffset.x, unclamped.x)),
    y: Math.round(Math.max(32 - gesture.minimumOffset.y, unclamped.y)),
  };
}

function positionedRoots(
  gesture: NodeDragGesture,
  point = gesture.point,
): DraggedRootPosition[] {
  const lead = leadPosition(gesture, point);
  return gesture.roots.map(({ id, offsetX, offsetY }) => ({
    id,
    x: lead.x + offsetX,
    y: lead.y + offsetY,
  }));
}

function nodeElement(
  container: HTMLElement,
  id: string,
): HTMLElement | null {
  const node = container.ownerDocument.getElementById(`mind-node-${id}`);
  return node && container.contains(node) ? node : null;
}

function syncVisibleSelection(
  container: HTMLElement,
  current: SelectionState,
  next: SelectionState,
) {
  const affectedIds = new Set([
    ...current.selectedIds,
    ...next.selectedIds,
    ...(current.primaryId ? [current.primaryId] : []),
    ...(next.primaryId ? [next.primaryId] : []),
  ]);
  const selectedIds = new Set(next.selectedIds);
  affectedIds.forEach((id) => {
    const node = nodeElement(container, id);
    if (!node) return;
    const selected = selectedIds.has(id);
    node.classList.toggle("is-selected", selected);
    node.classList.toggle("is-primary", next.primaryId === id);
    node
      .querySelector<HTMLElement>(".mind-node__content")
      ?.setAttribute("aria-pressed", String(selected));
  });
}

function populatePreview(
  preview: HTMLDivElement,
  gesture: NodeDragGesture,
  layout: LayoutResult,
  document: MindMapDocument,
) {
  const roots = gesture.roots
    .map(({ id }) => layout.nodes[id])
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  if (roots.length === 0) return;
  const bounds = roots.reduce(
    (current, node) => ({
      minX: Math.min(current.minX, node.x),
      minY: Math.min(current.minY, node.y),
      maxX: Math.max(current.maxX, node.x + node.width),
      maxY: Math.max(current.maxY, node.y + node.height),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  preview.replaceChildren();
  preview.style.height = `${bounds.maxY - bounds.minY}px`;
  preview.style.width = `${bounds.maxX - bounds.minX}px`;
  roots.forEach((root) => {
    const item = preview.ownerDocument.createElement("div");
    item.className = `node-drag-preview__item${
      root.rootKind === "main" ? " node-drag-preview__item--root" : ""
    }`;
    item.style.height = `${root.height}px`;
    item.style.left = `${root.x - bounds.minX}px`;
    item.style.top = `${root.y - bounds.minY}px`;
    item.style.width = `${root.width}px`;
    item.style.fontSize = `${
      root.rootKind === "main"
        ? 19
        : root.rootKind === "floating"
          ? 17
          : root.depth === 1
            ? 16
            : root.depth === 2
              ? 15
              : 13
    }px`;
    item.style.fontWeight = String(
      root.rootKind === "main"
        ? 580
        : root.rootKind === "floating"
          ? 650
          : root.depth === 1
            ? 620
            : root.depth === 2
              ? 530
              : 500,
    );
    item.textContent = document.nodes[root.id]?.text ?? "";
    preview.append(item);
  });
  preview.hidden = false;
}

function dragAnnouncement(
  gesture: NodeDragGesture,
  document: MindMapDocument,
): string {
  const subject =
    gesture.roots.length > 1
      ? `${gesture.roots.length} 个分支`
      : "分支";
  if (gesture.dropTargetId) {
    const target = document.nodes[gesture.dropTargetId];
    return `松手将${subject}移入“${target?.text || "未命名节点"}”${
      gesture.dropPosition === null
        ? ""
        : `，排在第 ${gesture.dropPosition + 1} 个`
    }`;
  }
  return gesture.dropIntent === "detach"
    ? `松手将${subject}移到画布空白处`
    : "继续拖动以选择上级节点";
}

function selectionAnnouncement(selection: SelectionState): string {
  return selection.selectedIds.length === 0
    ? "未选择节点"
    : selection.selectedIds.length === 1
      ? "已选择 1 个节点"
      : `已选择 ${selection.selectedIds.length} 个节点`;
}

export function useNodeDrag({
  containerRef,
  containerBoundsRef,
  connectorPreviewRef,
  previewRef,
  announcementRef,
  panModifierHeld,
  document,
  layout,
  selection,
  editingId,
  liveViewport,
  onSelectionChange,
  onAttach,
  onDetach,
}: NodeDragOptions): {
  beginNodeDrag: PointerEventHandler<HTMLDivElement>;
  bindings: NodeDragBindings;
} {
  const gestureRef = useRef<NodeDragGesture | null>(null);
  const suppressNextClick = useRef(false);
  const documentRef = useRef(document);
  const layoutRef = useRef(layout);
  const selectionRef = useRef(selection);
  const dropSpatialIndex = useMemo(
    () => buildNodeDropSpatialIndex(layout),
    [layout],
  );
  const dropSpatialIndexRef = useRef(dropSpatialIndex);
  const editingIdRef = useRef(editingId);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onAttachRef = useRef(onAttach);
  const onDetachRef = useRef(onDetach);
  documentRef.current = document;
  layoutRef.current = layout;
  selectionRef.current = selection;
  dropSpatialIndexRef.current = dropSpatialIndex;
  editingIdRef.current = editingId;
  onSelectionChangeRef.current = onSelectionChange;
  onAttachRef.current = onAttach;
  onDetachRef.current = onDetach;
  const hidePreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current.hidden = true;
      previewRef.current.style.opacity = "0";
      previewRef.current.style.removeProperty("height");
      previewRef.current.style.removeProperty("transform");
      previewRef.current.style.removeProperty("width");
      delete previewRef.current.dataset.dropIntent;
      delete previewRef.current.dataset.dropPosition;
      previewRef.current.replaceChildren();
    }
    if (connectorPreviewRef.current) {
      connectorPreviewRef.current.style.opacity = "0";
      connectorPreviewRef.current.setAttribute("d", "");
    }
  }, [connectorPreviewRef, previewRef]);

  const syncPreview = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture?.moved) return;
    const source = layoutRef.current.nodes[gesture.leadId];
    if (!source) return;
    const position = leadPosition(gesture, gesture.point);
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
      preview.style.transform = `translate3d(${position.x + gesture.minimumOffset.x}px, ${position.y + gesture.minimumOffset.y}px, 0)`;
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
    if (
      gesture?.selectionChanged &&
      gesture.document === documentRef.current
    ) {
      // Keep the 10k-node tree out of the pointer-move lane. The visible
      // selection is already synchronized below; React can yield while it
      // adopts the same state after the gesture finishes.
      startTransition(() => {
        onSelectionChangeRef.current(gesture.nextSelection);
      });
    }
    const container = containerRef.current;
    if (container) {
      gesture?.roots.forEach(({ id }) => {
        const root = nodeElement(container, id);
        if (root) delete root.dataset.nodeDragging;
      });
      if (gesture?.dropTargetId) {
        const target = nodeElement(container, gesture.dropTargetId);
        if (target) delete target.dataset.nodeDropTarget;
      }
    }
    if (announcementRef.current) {
      announcementRef.current.textContent = selectionAnnouncement(
        selectionRef.current,
      );
    }
    hidePreview();
  }, [announcementRef, containerRef, hidePreview]);

  useLayoutEffect(() => {
    const gesture = gestureRef.current;
    if (
      gesture &&
      (gesture.document !== document ||
        gesture.roots.some(({ id }) => !document.nodes[id]) ||
        editingId !== null)
    ) {
      clearGesture(true);
      return;
    }
    if (gesture?.moved && announcementRef.current) {
      announcementRef.current.textContent = dragAnnouncement(
        gesture,
        document,
      );
    }
  }, [announcementRef, clearGesture, document, editingId, selection]);

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

      const currentSelection = selectionRef.current;
      const requestedSelection = currentSelection.selectedIds.includes(id)
        ? currentSelection.selectedIds.filter(
            (selectedId) => selectedId !== currentDocument.rootId,
          )
        : [id];
      const rootIds = normalizeSelectedRoots(
        currentDocument,
        requestedSelection,
      ).filter((rootId) => rootId !== currentDocument.rootId);
      const leadId =
        rootIds.find((rootId) => subtreeIds(currentDocument, rootId).has(id)) ??
        rootIds[0];
      const source = leadId ? currentLayout.nodes[leadId] : null;
      if (!source) return;
      const roots = rootIds
        .map((rootId) => {
          const root = currentLayout.nodes[rootId];
          return root
            ? {
                id: rootId,
                offsetX: root.x - source.x,
                offsetY: root.y - source.y,
              }
            : null;
        })
        .filter((root): root is DragRoot => Boolean(root));
      if (roots.length === 0) return;

      // A pointer can only originate from a visible node. Avoid scanning the
      // entire 10k-node display order for the overwhelmingly common single
      // selection drag; multi-selection still preserves canonical map order.
      const nextSelection = requestedSelection.length === 1
        ? { primaryId: id, selectedIds: [id] }
        : createSelection(requestedSelection, currentLayout.visibleIds, id);
      const point = clientPointToCanvas(
        event.clientX,
        event.clientY,
        containerBoundsRef.current ?? container.getBoundingClientRect(),
        liveViewport.current,
      );
      const excludedIds = new Set<string>();
      roots.forEach(({ id: rootId }) => {
        subtreeIds(currentDocument, rootId).forEach((subtreeId) => {
          excludedIds.add(subtreeId);
        });
      });
      const minimumOffset = roots.reduce(
        (minimum, root) => ({
          x: Math.min(minimum.x, root.offsetX),
          y: Math.min(minimum.y, root.offsetY),
        }),
        { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
      );
      const parentIds = new Set(
        roots.map(({ id: rootId }) => currentDocument.nodes[rootId]?.parentId),
      );
      const originalParentId = parentIds.size === 1
        ? ([...parentIds][0] ?? null)
        : null;
      gestureRef.current = {
        document: currentDocument,
        pointerId: event.pointerId,
        leadId,
        roots,
        nextSelection,
        startClient: { x: event.clientX, y: event.clientY },
        grabOffset: {
          x: point.x - source.x,
          y: point.y - source.y,
        },
        minimumOffset,
        originalParentId,
        excludedIds,
        startedFloating: roots.every(
          ({ id: rootId }) => currentLayout.nodes[rootId]?.rootKind === "floating",
        ),
        moved: false,
        selectionChanged: false,
        point,
        dropTargetId: null,
        dropPosition: null,
        dropIntent: "retain",
        captureElement: event.currentTarget,
      };
    },
    [containerBoundsRef, containerRef, liveViewport, panModifierHeld],
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
      if (!gesture || gesture.pointerId !== event.pointerId || !container) {
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
        containerBoundsRef.current ?? container.getBoundingClientRect(),
        liveViewport.current,
      );
      if (!moved) {
        gesture.point = point;
        return;
      }

      event.preventDefault();
      if (
        !gesture.moved &&
        !selectionEquals(selectionRef.current, gesture.nextSelection)
      ) {
        const currentSelection = selectionRef.current;
        selectionRef.current = gesture.nextSelection;
        syncVisibleSelection(
          container,
          currentSelection,
          gesture.nextSelection,
        );
        gesture.selectionChanged = true;
      }
      if (
        !gesture.moved &&
        !gesture.captureElement.hasPointerCapture(event.pointerId)
      ) {
        gesture.captureElement.setPointerCapture(event.pointerId);
      }
      const source = layoutRef.current.nodes[gesture.leadId];
      if (!source) return;
      const position = leadPosition(gesture, point);
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
        gesture.originalParentId,
      );
      const targetId = hit.targetId;
      const nextDropPosition = targetId
        ? childInsertionPosition(
            documentRef.current,
            layoutRef.current,
            targetId,
            gesture.roots.map(({ id: rootId }) => rootId),
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
      const firstMove = !gesture.moved;
      const previousTargetId = gesture.dropTargetId;
      gesture.moved = true;
      gesture.point = point;
      gesture.dropTargetId = targetId;
      gesture.dropPosition = nextDropPosition;
      gesture.dropIntent = nextDropIntent;
      if (firstMove) {
        // Drag-only feedback is intentionally independent from React state.
        // Updating five parent states here reconciled every mounted overview
        // node even though only roots, one target, and one preview can change.
        gesture.roots.forEach(({ id }) => {
          const root = nodeElement(container, id);
          if (root) root.dataset.nodeDragging = "true";
        });
        if (previewRef.current) {
          populatePreview(
            previewRef.current,
            gesture,
            layoutRef.current,
            documentRef.current,
          );
        }
      }
      if (previousTargetId !== targetId) {
        if (previousTargetId) {
          const previousTarget = nodeElement(container, previousTargetId);
          if (previousTarget) delete previousTarget.dataset.nodeDropTarget;
        }
        if (targetId) {
          const target = nodeElement(container, targetId);
          if (target) target.dataset.nodeDropTarget = "true";
        }
      }
      if (announcementRef.current) {
        announcementRef.current.textContent = dragAnnouncement(
          gesture,
          documentRef.current,
        );
      }
      syncPreview();
    },
    onPointerUp: (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      clearGesture(gesture.moved);
      if (gesture.moved) {
        const ids = gesture.roots.map(({ id }) => id);
        if (
          gesture.dropIntent === "attach" &&
          gesture.dropTargetId &&
          gesture.dropPosition !== null
        ) {
          startTransition(() => {
            onAttachRef.current(
              ids,
              gesture.dropTargetId!,
              gesture.dropPosition!,
            );
          });
        } else if (gesture.dropIntent === "detach") {
          startTransition(() => {
            onDetachRef.current(positionedRoots(gesture));
          });
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
  };
}
