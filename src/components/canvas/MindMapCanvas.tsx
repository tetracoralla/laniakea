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
  canvasContentBounds,
  computeLayout,
  mainBranchAnchorForCollapseTransition,
  shareStableLayout,
  sizeForNode,
  stabilizeMainBranchAnchor,
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
  shareStableVisibleIds,
  viewportNeedsRenderWindowRefresh,
  visibleLayoutNodeIds,
} from "../../model/viewportCulling";
import {
  canvasZoomToFit,
  canvasZoomFromWheel,
  clampCanvasZoom,
  minCanvasZoom,
} from "../../model/zoom";
import { Connectors } from "./Connectors";
import { MindMapNode } from "./MindMapNode";
import { SelectionMarquee } from "./SelectionMarquee";
import { createCanvasTextWidthMeasurer } from "./textMeasure";

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
  fitRequest?: number;
  onSelectionChange: (selection: SelectionState) => void;
  onBeginEdit: (id: string) => void;
  onSpaceTap: () => void;
  onDraftChange: (value: string) => void;
  onPasteStructured: (id: string, value: string) => boolean;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onOpenNodeContextMenu?: (
    id: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onOpenSubspace?: (id: string) => void;
  onAttachNode: (
    ids: readonly string[],
    parentId: string,
    position: number,
  ) => void;
  onDetachNode: (
    positions: readonly { id: string; x: number; y: number }[],
  ) => void;
  onViewportChange: (viewport: Viewport) => void;
  onZoomPreview?: (zoom: number) => void;
}

export const MindMapCanvas = forwardRef<CanvasHandle, MindMapCanvasProps>(
  function MindMapCanvas(
    {
      document,
      selection,
      editingId,
      draft,
      fitRequest = 0,
      onSelectionChange,
      onBeginEdit,
      onSpaceTap,
      onDraftChange,
      onPasteStructured,
      onCommitEdit,
      onCancelEdit,
      onToggle,
      onOpenNodeContextMenu = () => undefined,
      onOpenSubspace = () => undefined,
      onAttachNode,
      onDetachNode,
      onViewportChange,
      onZoomPreview,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const dragPreviewRef = useRef<HTMLDivElement>(null);
    const dragConnectorPreviewRef = useRef<SVGPathElement>(null);
    const dragAnnouncementRef = useRef<HTMLDivElement>(null);
    const persistTimer = useRef<number | null>(null);
    const pendingViewportCommitRef = useRef<{
      emit: (viewport: Viewport) => void;
    } | null>(null);
    const viewportFrame = useRef<number | null>(null);
    const liveViewport = useRef(document.viewport);
    const containerBoundsRef = useRef<{
      height: number;
      left: number;
      top: number;
      width: number;
    } | null>(null);
    const previousLayoutRef = useRef<LayoutResult | null>(null);
    const previousDocumentRef = useRef<MindMapDocument | null>(null);
    const handledFitRequestRef = useRef(0);
    const fitSelectionRevealGuardRef = useRef<{
      layout: LayoutResult;
      selection: SelectionState;
    } | null>(null);
    const lastSingleSelectionIdRef = useRef(
      selection.selectedIds.length === 1 ? selection.primaryId : null,
    );
    const draftHeightLayoutRef = useRef<{
      base: LayoutResult;
      editingId: string;
      height: number;
      layout: LayoutResult;
    } | null>(null);
    const activeSelectionRef = useRef(selection);
    const visibleIdsRef = useRef<readonly string[]>([]);
    const renderedIdsRef = useRef<readonly string[]>([]);
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
    const measureTextWidth = useMemo(
      () => createCanvasTextWidthMeasurer(),
      [],
    );
    const documentLayout = useMemo(
      () => {
        const computed = computeLayout(
          document,
          undefined,
          measureTextWidth,
        );
        const collapseTransition = mainBranchAnchorForCollapseTransition(
          previousDocumentRef.current,
          document,
        );
        const next = shareStableLayout(
          previousLayoutRef.current,
          stabilizeMainBranchAnchor(
            previousLayoutRef.current,
            computed,
            document,
            collapseTransition,
          ),
        );
        return next;
      },
      [
        document.floatingRoots,
        document.nodes,
        document.rootId,
        measureTextWidth,
      ],
    );
    useLayoutEffect(() => {
      previousDocumentRef.current = document;
      previousLayoutRef.current = documentLayout;
    }, [document, documentLayout]);
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
          measureTextWidth,
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
          }, measureTextWidth),
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
          measureTextWidth,
        ),
      [
        document,
        draftSizingText,
        editingId,
        heightAwareLayout,
        measureTextWidth,
      ],
    );
    visibleIdsRef.current = layout.visibleIds;
    const viewport = document.viewport;

    const renderViewport = useCallback((next: Viewport) => {
      liveViewport.current = next;
      if (viewportFrame.current === null) {
        viewportFrame.current = window.requestAnimationFrame(() => {
          viewportFrame.current = null;
          const live = liveViewport.current;
          if (contentRef.current) {
            contentRef.current.style.transform = `translate3d(${live.x}px, ${live.y}px, 0) scale(${live.zoom})`;
          }
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

    // The delayed pan commit must target the surface that was panned, not the
    // surface that happens to be mounted when the timer fires: root and Map
    // Space share this component, so a stale emit would write one layer's
    // viewport into the other document.
    const flushPendingViewportCommit = useCallback(() => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      const pending = pendingViewportCommitRef.current;
      pendingViewportCommitRef.current = null;
      pending?.emit(liveViewport.current);
    }, []);

    const scheduleViewportCommit = useCallback((next: Viewport) => {
      renderViewport(next);
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      pendingViewportCommitRef.current = { emit: onViewportChange };
      persistTimer.current = window.setTimeout(() => {
        persistTimer.current = null;
        const pending = pendingViewportCommitRef.current;
        pendingViewportCommitRef.current = null;
        pending?.emit(liveViewport.current);
      }, 120);
    }, [onViewportChange, renderViewport]);

    const commitViewportImmediately = useCallback((next: Viewport) => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      pendingViewportCommitRef.current = null;
      onViewportChange(next);
    }, [onViewportChange]);

    const handleWheel = useCallback((event: WheelEvent) => {
      const editor =
        event.target instanceof HTMLTextAreaElement &&
        event.target.classList.contains("mind-node__editor")
          ? event.target
          : null;
      if (editor && editor.scrollHeight > editor.clientHeight) {
        return;
      }
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        const bounds =
          containerBoundsRef.current ??
          containerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const current = liveViewport.current;
        const nextZoom = canvasZoomFromWheel(
          current.zoom,
          event.deltaY,
          event.deltaMode,
          bounds.height,
        );
        const pointX = event.clientX - bounds.left;
        const pointY = event.clientY - bounds.top;
        const contentX = (pointX - current.x) / current.zoom;
        const contentY = (pointY - current.y) / current.zoom;
        if (nextZoom === current.zoom) {
          onZoomPreview?.(nextZoom);
          return;
        }
        scheduleViewportCommit({
          zoom: nextZoom,
          x: pointX - contentX * nextZoom,
          y: pointY - contentY * nextZoom,
        });
        onZoomPreview?.(nextZoom);
        return;
      }
      const current = liveViewport.current;
      scheduleViewportCommit({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      });
    }, [onZoomPreview, scheduleViewportCommit]);

    const {
      activeSelection,
      marqueeRect,
      selecting,
      className,
      panModifierHeld,
      bindings,
    } = useCanvasGestures({
      layout,
      selection,
      editingId,
      liveViewport,
      renderViewport,
      onSelectionChange,
      onSpaceTap,
      onViewportChange: commitViewportImmediately,
    });
    activeSelectionRef.current = activeSelection;
    const { beginNodeDrag, bindings: nodeDragBindings } = useNodeDrag({
      containerRef,
      containerBoundsRef,
      connectorPreviewRef: dragConnectorPreviewRef,
      previewRef: dragPreviewRef,
      announcementRef: dragAnnouncementRef,
      panModifierHeld,
      document,
      layout,
      selection: activeSelection,
      editingId,
      liveViewport,
      onSelectionChange,
      onAttach: onAttachNode,
      onDetach: onDetachNode,
    });
    const selectedIdSet = useMemo(
      () => new Set(activeSelection.selectedIds),
      [activeSelection.selectedIds],
    );
    const pinnedIds = useMemo(
      () => nodeIdsRequiredInDom(
        activeSelection.primaryId,
        editingId,
        null,
        null,
      ),
      [activeSelection.primaryId, editingId],
    );
    const renderedIds = useMemo(() => {
      const next = visibleLayoutNodeIds(
          layout,
          renderViewportState,
          containerSize,
          pinnedIds,
        );
      const stable = shareStableVisibleIds(renderedIdsRef.current, next);
      renderedIdsRef.current = stable;
      return stable;
    }, [containerSize, layout, pinnedIds, renderViewportState]);
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
      const current = liveViewport.current;
      const clamped = clampCanvasZoom(
        nextZoom,
        Math.min(current.zoom, minCanvasZoom),
      );
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const contentX = (centerX - current.x) / current.zoom;
      const contentY = (centerY - current.y) / current.zoom;
      onZoomPreview?.(clamped);
      commitViewportImmediately({
        zoom: clamped,
        x: centerX - contentX * clamped,
        y: centerY - contentY * clamped,
      });
    };

    const fit = useCallback(() => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const content = canvasContentBounds(layout);
      const zoom = canvasZoomToFit(
        content.width,
        content.height,
        bounds.width,
        bounds.height,
      );
      onZoomPreview?.(zoom);
      commitViewportImmediately({
        zoom,
        x: (bounds.width - content.width * zoom) / 2 - content.minX * zoom,
        y: (bounds.height - content.height * zoom) / 2 - content.minY * zoom,
      });
    }, [commitViewportImmediately, layout, onZoomPreview]);

    useLayoutEffect(() => {
      if (
        fitRequest <= 0 ||
        handledFitRequestRef.current === fitRequest
      ) {
        return;
      }
      handledFitRequestRef.current = fitRequest;
      fitSelectionRevealGuardRef.current = { layout, selection };
      fit();
    }, [fit, fitRequest, layout, selection]);

    const focusSelected = () => {
      const bounds = containerRef.current?.getBoundingClientRect();
      const node = selection.primaryId
        ? layout.nodes[selection.primaryId]
        : null;
      if (!bounds || !node) return;
      const current = liveViewport.current;
      commitViewportImmediately({
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
        zoomIn: () => zoomAtCenter(liveViewport.current.zoom + 0.1),
        zoomOut: () => zoomAtCenter(liveViewport.current.zoom - 0.1),
        resetZoom: () => {
          onZoomPreview?.(1);
          commitViewportImmediately({
            zoom: 1,
            x: 96,
            y: -24,
          });
        },
      }),
      [commitViewportImmediately, fit, layout, onZoomPreview, selection.primaryId, viewport],
    );

    useLayoutEffect(() => {
      // A pending pan belongs to the previously mounted surface. Flush it
      // through its captured emit before the incoming viewport overwrites
      // liveViewport, so neither layer's document receives the other's value.
      flushPendingViewportCommit();
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
    }, [flushPendingViewportCommit, viewport]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const updateSize = () => {
        const bounds = container.getBoundingClientRect();
        const nextSize = {
          width: bounds.width,
          height: bounds.height,
        };
        containerBoundsRef.current = {
          ...nextSize,
          left: bounds.left,
          top: bounds.top,
        };
        setContainerSize((current) =>
          current.width === nextSize.width &&
          current.height === nextSize.height
            ? current
            : nextSize,
        );
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
        // Match the Flow canvas: a pan interrupted by unmounting (for example
        // entering a Flow Space) still commits instead of silently dropping.
        flushPendingViewportCommit();
        if (viewportFrame.current !== null) {
          window.cancelAnimationFrame(viewportFrame.current);
          viewportFrame.current = null;
        }
      },
      [flushPendingViewportCommit],
    );

    useEffect(() => {
      const selectedId =
        selection.selectedIds.length === 1 ? selection.primaryId : null;
      const fitGuard = fitSelectionRevealGuardRef.current;
      if (fitGuard?.layout === layout && fitGuard.selection === selection) {
        fitSelectionRevealGuardRef.current = null;
        lastSingleSelectionIdRef.current = selectedId;
        return;
      }
      fitSelectionRevealGuardRef.current = null;
      if (selecting) return;
      const previousSelectedId = lastSingleSelectionIdRef.current;
      lastSingleSelectionIdRef.current = selectedId;
      // A selection transition may reveal its new target for keyboard
      // navigation. Layout refreshes, draft edits, and viewport persistence
      // must never act as a watchdog that drags the user back to an already
      // selected node after a deliberate pan.
      if (!selectedId || selectedId === previousSelectedId) return;
      const node = layout.nodes[selectedId];
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
        onLostPointerCapture={nodeDragBindings.onLostPointerCapture}
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
          <svg
            aria-hidden="true"
            className="node-drag-connector-preview"
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
          >
            <path
              className="node-drag-connector-preview__path"
              ref={dragConnectorPreviewRef}
            />
          </svg>
          {renderedIds.map((id) => {
            const node = document.nodes[id];
            const selected = selectedIdSet.has(id);
            const portalSpace = node.subspaceId
              ? document.spaces?.[node.subspaceId]
              : undefined;
            return (
              <MindMapNode
                draft={draftForNode(id, editingId, draft)}
                editing={editingId === id}
                key={id}
                layout={layout.nodes[id]}
                node={node}
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onCommitEdit={onCommitEdit}
                onDraftChange={onDraftChange}
                onOpenContextMenu={onOpenNodeContextMenu}
                onDragPointerDown={beginNodeDrag}
                onPasteStructured={onPasteStructured}
                onSelect={handleNodeSelect}
                onToggle={onToggle}
                onOpenSubspace={onOpenSubspace}
                portalSummary={
                  portalSpace
                    ? portalSpace.type === "map"
                      ? `思维图 · ${Object.keys(portalSpace.nodes).length} 个节点`
                      : `流程 · ${Object.values(portalSpace.nodes).filter(({ kind }) => kind !== "start" && kind !== "end").length} 步`
                    : undefined
                }
                portalFlow={
                  portalSpace?.type === "flow" ? portalSpace : undefined
                }
                primary={activeSelection.primaryId === id}
                selected={selected}
              />
            );
          })}
          <div
            aria-hidden="true"
            className="node-drag-preview"
            hidden
            ref={dragPreviewRef}
          />
        </div>
        {marqueeRect && <SelectionMarquee rect={marqueeRect} />}
        <div
          aria-live="polite"
          className="sr-only"
          ref={dragAnnouncementRef}
        >
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
