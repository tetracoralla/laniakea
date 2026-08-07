import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCanvasGestures } from "../../hooks/useCanvasGestures";
import { useNodeDrag } from "../../hooks/useNodeDrag";
import {
  draftForNode,
  nodePlaceholder,
  nodeIdsRequiredInDom,
} from "../../model/canvasRender";
import {
  applyDraftWidth,
  computeLayout,
  shareStableLayout,
  sizeForNode,
} from "../../model/layout";
import {
  singleSelection,
  toggleSelectedNode,
} from "../../model/selection";
import type {
  LayoutResult,
  MindMapDocument,
  SelectionState,
  Viewport,
} from "../../types/mindmap";
import {
  viewportNeedsRenderWindowRefresh,
  visibleLayoutNodeIds,
} from "../../model/viewportCulling";
import { Connectors } from "./Connectors";
import { MindMapNode } from "./MindMapNode";
import { SelectionMarquee } from "./SelectionMarquee";

export interface CanvasHandle {
  fit: () => void;
  focusCanvas: () => void;
  focusSelected: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

interface MindMapCanvasProps {
  document: MindMapDocument;
  selection: SelectionState;
  editingId: string | null;
  draft: string;
  onSelectionChange: (selection: SelectionState) => void;
  onBeginEdit: (id: string) => void;
  onSpaceTap: () => void;
  onDraftChange: (value: string) => void;
  onPasteStructured: (id: string, value: string) => boolean;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onAttachNode: (id: string, parentId: string) => void;
  onDetachNode: (
    id: string,
    position: { x: number; y: number },
  ) => void;
  onViewportChange: (viewport: Viewport) => void;
}

const minZoom = 0.52;
const maxZoom = 1.8;

function clampZoom(value: number): number {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

export const MindMapCanvas = forwardRef<CanvasHandle, MindMapCanvasProps>(
  function MindMapCanvas(
    {
      document,
      selection,
      editingId,
      draft,
      onSelectionChange,
      onBeginEdit,
      onSpaceTap,
      onDraftChange,
      onPasteStructured,
      onCommitEdit,
      onCancelEdit,
      onToggle,
      onAttachNode,
      onDetachNode,
      onViewportChange,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const dragPreviewRef = useRef<HTMLDivElement>(null);
    const persistTimer = useRef<number | null>(null);
    const viewportFrame = useRef<number | null>(null);
    const liveViewport = useRef(document.viewport);
    const previousLayoutRef = useRef<LayoutResult | null>(null);
    const draftHeightLayoutRef = useRef<{
      base: LayoutResult;
      editingId: string;
      height: number;
      layout: LayoutResult;
    } | null>(null);
    const activeSelectionRef = useRef(selection);
    const visibleIdsRef = useRef<readonly string[]>([]);
    const [containerSize, setContainerSize] = useState(() => ({
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
    }));
    const containerSizeRef = useRef(containerSize);
    const [renderViewportState, setRenderViewportState] = useState(
      document.viewport,
    );
    const renderViewportStateRef = useRef(document.viewport);
    containerSizeRef.current = containerSize;
    const documentLayout = useMemo(
      () => {
        const next = shareStableLayout(
          previousLayoutRef.current,
          computeLayout(document),
        );
        previousLayoutRef.current = next;
        return next;
      },
      [document.floatingRoots, document.nodes, document.rootId],
    );
    const editingLayout = editingId
      ? documentLayout.nodes[editingId]
      : undefined;
    const draftSizingText =
      editingLayout && draft === ""
        ? (nodePlaceholder(editingLayout) ?? "")
        : draft;
    const draftSize = editingLayout
      ? sizeForNode(
          editingLayout.depth,
          draftSizingText,
          editingLayout.rootKind,
        )
      : null;
    let heightAwareLayout = documentLayout;
    if (
      editingId &&
      editingLayout &&
      draftSize &&
      draftSize.height !== editingLayout.height
    ) {
      const cached = draftHeightLayoutRef.current;
      if (
        !cached ||
        cached.base !== documentLayout ||
        cached.editingId !== editingId ||
        cached.height !== draftSize.height
      ) {
        draftHeightLayoutRef.current = {
          base: documentLayout,
          editingId,
          height: draftSize.height,
          layout: computeLayout(document, {
            id: editingId,
            text: draftSizingText,
          }),
        };
      }
      heightAwareLayout =
        draftHeightLayoutRef.current?.layout ?? documentLayout;
    } else {
      draftHeightLayoutRef.current = null;
    }
    const layout = useMemo(
      () =>
        applyDraftWidth(
          heightAwareLayout,
          document,
          editingId,
          draftSizingText,
        ),
      [document, draftSizingText, editingId, heightAwareLayout],
    );
    visibleIdsRef.current = layout.visibleIds;
    const viewport = document.viewport;

    const renderViewport = useCallback((next: Viewport) => {
      liveViewport.current = next;
      if (contentRef.current) {
        contentRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
      }
      if (viewportFrame.current === null) {
        viewportFrame.current = window.requestAnimationFrame(() => {
          viewportFrame.current = null;
          const live = liveViewport.current;
          if (
            !viewportNeedsRenderWindowRefresh(
              renderViewportStateRef.current,
              live,
              containerSizeRef.current,
            )
          ) {
            return;
          }
          renderViewportStateRef.current = live;
          setRenderViewportState(live);
        });
      }
    }, []);

    const scheduleViewportCommit = useCallback((next: Viewport) => {
      renderViewport(next);
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        onViewportChange(liveViewport.current);
        persistTimer.current = null;
      }, 120);
    }, [onViewportChange, renderViewport]);

    const handleWheel = useCallback((event: WheelEvent) => {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const current = liveViewport.current;
        const nextZoom = clampZoom(
          current.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
        );
        const pointX = event.clientX - bounds.left;
        const pointY = event.clientY - bounds.top;
        const contentX = (pointX - current.x) / current.zoom;
        const contentY = (pointY - current.y) / current.zoom;
        scheduleViewportCommit({
          zoom: nextZoom,
          x: pointX - contentX * nextZoom,
          y: pointY - contentY * nextZoom,
        });
        return;
      }
      const current = liveViewport.current;
      scheduleViewportCommit({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      });
    }, [scheduleViewportCommit]);

    const {
      activeSelection,
      marqueeRect,
      selecting,
      className,
      panModifierHeld,
      bindings,
    } = useCanvasGestures({
      containerRef,
      layout,
      selection,
      editingId,
      liveViewport,
      renderViewport,
      onSelectionChange,
      onSpaceTap,
      onViewportChange,
    });
    activeSelectionRef.current = activeSelection;
    const {
      beginNodeDrag,
      bindings: nodeDragBindings,
      draggingId,
      dropTargetId,
    } = useNodeDrag({
      containerRef,
      previewRef: dragPreviewRef,
      panModifierHeld,
      document,
      layout,
      editingId,
      liveViewport,
      onAttach: onAttachNode,
      onDetach: onDetachNode,
    });
    const selectedIdSet = useMemo(
      () => new Set(activeSelection.selectedIds),
      [activeSelection.selectedIds],
    );
    const pinnedIds = useMemo(() => {
      return nodeIdsRequiredInDom(
        activeSelection.primaryId,
        editingId,
        draggingId,
        dropTargetId,
      );
    }, [
      activeSelection.primaryId,
      draggingId,
      dropTargetId,
      editingId,
    ]);
    const renderedIds = useMemo(
      () =>
        visibleLayoutNodeIds(
          layout,
          renderViewportState,
          containerSize,
          pinnedIds,
        ),
      [containerSize, layout, pinnedIds, renderViewportState],
    );
    const handleNodeSelect = useCallback(
      (id: string, additive: boolean) => {
        onSelectionChange(
          additive
            ? toggleSelectedNode(
                activeSelectionRef.current,
                id,
                visibleIdsRef.current,
              )
            : singleSelection(id),
        );
      },
      [onSelectionChange],
    );

    const zoomAtCenter = (nextZoom: number) => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const clamped = clampZoom(nextZoom);
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const current = liveViewport.current;
      const contentX = (centerX - current.x) / current.zoom;
      const contentY = (centerY - current.y) / current.zoom;
      onViewportChange({
        zoom: clamped,
        x: centerX - contentX * clamped,
        y: centerY - contentY * clamped,
      });
    };

    const fit = () => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const paddingX = 112;
      const paddingY = 96;
      const zoom = clampZoom(
        Math.min(
          1,
          (bounds.width - paddingX * 2) / layout.width,
          (bounds.height - paddingY * 2) / layout.height,
        ),
      );
      onViewportChange({
        zoom,
        x: (bounds.width - layout.width * zoom) / 2,
        y: (bounds.height - layout.height * zoom) / 2,
      });
    };

    const focusSelected = () => {
      const bounds = containerRef.current?.getBoundingClientRect();
      const node = selection.primaryId
        ? layout.nodes[selection.primaryId]
        : null;
      if (!bounds || !node) return;
      const current = liveViewport.current;
      onViewportChange({
        ...current,
        x:
          bounds.width / 2 -
          (node.x + node.width / 2) * current.zoom,
        y:
          bounds.height / 2 -
          (node.y + node.height / 2) * current.zoom,
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        fit,
        focusCanvas: () =>
          containerRef.current?.focus({ preventScroll: true }),
        focusSelected,
        zoomIn: () => zoomAtCenter(viewport.zoom + 0.1),
        zoomOut: () => zoomAtCenter(viewport.zoom - 0.1),
        resetZoom: () =>
          onViewportChange({
            zoom: 1,
            x: 96,
            y: -24,
          }),
      }),
      [layout, selection.primaryId, viewport],
    );

    useLayoutEffect(() => {
      liveViewport.current = viewport;
      if (contentRef.current) {
        contentRef.current.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`;
      }
      if (
        viewportNeedsRenderWindowRefresh(
          renderViewportStateRef.current,
          viewport,
          containerSizeRef.current,
        )
      ) {
        renderViewportStateRef.current = viewport;
        setRenderViewportState(viewport);
      }
    }, [viewport]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const updateSize = () => {
        const bounds = container.getBoundingClientRect();
        setContainerSize({
          width: bounds.width,
          height: bounds.height,
        });
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      container.addEventListener("wheel", handleWheel, {
        passive: false,
      });
      return () => container.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    useEffect(
      () => () => {
        if (persistTimer.current) window.clearTimeout(persistTimer.current);
        if (viewportFrame.current !== null) {
          window.cancelAnimationFrame(viewportFrame.current);
          viewportFrame.current = null;
        }
      },
      [],
    );

    useEffect(() => {
      if (
        selection.selectedIds.length !== 1 ||
        !selection.primaryId ||
        selecting
      ) {
        return;
      }
      const node = layout.nodes[selection.primaryId];
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!node || !bounds) return;
      const current = liveViewport.current;
      const left = node.x * current.zoom + current.x;
      const right = (node.x + node.width) * current.zoom + current.x;
      const top = node.y * current.zoom + current.y;
      const bottom = (node.y + node.height) * current.zoom + current.y;
      const inset = 96;
      let x = current.x;
      let y = current.y;

      if (left < inset) x += inset - left;
      if (right > bounds.width - inset) x -= right - (bounds.width - inset);
      if (top < inset) y += inset - top;
      if (bottom > bounds.height - inset) y -= bottom - (bounds.height - inset);

      if (x !== current.x || y !== current.y) {
        onViewportChange({ ...current, x, y });
      }
    }, [layout, onViewportChange, selecting, selection]);

    return (
      <div
        aria-label="思维导图画布"
        className={className}
        onClickCapture={(event) => {
          nodeDragBindings.onClickCapture(event);
          if (!event.defaultPrevented) bindings.onClickCapture(event);
        }}
        onPointerCancel={(event) => {
          nodeDragBindings.onPointerCancel(event);
          bindings.onPointerCancel(event);
        }}
        onPointerDown={bindings.onPointerDown}
        onPointerMove={(event) => {
          nodeDragBindings.onPointerMove(event);
          bindings.onPointerMove(event);
        }}
        onPointerUp={(event) => {
          nodeDragBindings.onPointerUp(event);
          bindings.onPointerUp(event);
        }}
        ref={containerRef}
        role="application"
        tabIndex={0}
      >
        <div
          className="mindmap-canvas__content"
          ref={contentRef}
          style={{
            width: layout.width,
            height: layout.height,
            transition: "none",
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
          }}
        >
          <Connectors
            document={document}
            layout={layout}
            renderedIds={renderedIds}
          />
          {renderedIds.map((id) => {
            const node = document.nodes[id];
            const selected = selectedIdSet.has(id);
            return (
              <MindMapNode
                draft={draftForNode(id, editingId, draft)}
                dragging={draggingId === id}
                dropTarget={dropTargetId === id}
                editing={editingId === id}
                key={id}
                layout={layout.nodes[id]}
                node={node}
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onCommitEdit={onCommitEdit}
                onDraftChange={onDraftChange}
                onDragPointerDown={beginNodeDrag}
                onPasteStructured={onPasteStructured}
                onSelect={handleNodeSelect}
                onToggle={onToggle}
                primary={activeSelection.primaryId === id}
                selected={selected}
              />
            );
          })}
          {draggingId && layout.nodes[draggingId] && (
            <div
              aria-hidden="true"
              className="node-drag-preview"
              ref={dragPreviewRef}
              style={{
                height: layout.nodes[draggingId].height,
                width: layout.nodes[draggingId].width,
              }}
            >
              {document.nodes[draggingId]?.text}
            </div>
          )}
        </div>
        {marqueeRect && <SelectionMarquee rect={marqueeRect} />}
        <div aria-live="polite" className="sr-only">
          {selection.selectedIds.length === 0
            ? "未选择节点"
            : selection.selectedIds.length === 1
              ? "已选择 1 个节点"
              : `已选择 ${selection.selectedIds.length} 个节点`}
        </div>
      </div>
    );
  },
);
