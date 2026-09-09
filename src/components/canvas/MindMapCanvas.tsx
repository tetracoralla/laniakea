import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import { darkBranchTones } from "../../theme/darkBranchTones";
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
import { hasActiveCanvasDrag } from "../../hooks/useDragInterruption";
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
  visibleLayoutPortalAnchorIds,
} from "../../model/viewportCulling";
import {
  canvasZoomToFit,
  canvasZoomFromWheel,
  clampCanvasZoom,
  minCanvasZoom,
  steppedCanvasZoom,
  wheelPanPixelDelta,
} from "../../model/zoom";
import { clientPointToCanvas } from "../../model/nodeDrag";
import {
  mindNodeInteractionTarget,
  type CanvasInteractionTarget,
} from "../../model/canvasInteraction";
import { Connectors } from "./Connectors";
import { MindMapNode } from "./MindMapNode";
import { SelectionMarquee } from "./SelectionMarquee";
import { SubspacePortalNode } from "./SubspacePortalNode";
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
  onEditTab?: (id: string, value: string, shiftKey: boolean) => void;
  onToggle: (id: string) => void;
  onOpenNodeContextMenu?: (
    id: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
    targetKind: CanvasInteractionTarget["kind"],
  ) => void;
  onOpenSubspace?: (id: string) => void;
  onMoveSubspace?: (sourceNodeId: string, targetNodeId: string) => void;
  onSelectSubspace?: (anchorId: string) => void;
  interactionTarget?: CanvasInteractionTarget;
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
  onOpenCanvasContextMenu?: (anchor: {
    clientX: number;
    clientY: number;
    contentX: number;
    contentY: number;
  }) => void;
  onCreateFloatingAt?: (contentX: number, contentY: number) => void;
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
      onEditTab,
      onToggle,
      onOpenNodeContextMenu = () => undefined,
      onOpenSubspace = () => undefined,
      onMoveSubspace = () => undefined,
      onSelectSubspace = () => undefined,
      interactionTarget = mindNodeInteractionTarget,
      onAttachNode,
      onDetachNode,
      onViewportChange,
      onZoomPreview,
      onOpenCanvasContextMenu = () => undefined,
      onCreateFloatingAt = () => undefined,
    },
    ref,
  ) {
    const locale = useLocale();
    const selectedSubspaceAnchorId =
      interactionTarget.kind === "subspace-portal"
        ? interactionTarget.anchorNodeId
        : null;
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
        document.spaces,
        measureTextWidth,
        locale,
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
    const darkTones = useMemo(() => darkBranchTones(document),
      [document.nodes, document.rootId, document.floatingRoots]);
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
          applyRenderWindowRefresh(live);
        });
      }
    }, []);

    // Render-window maintenance for one viewport sample. Committed viewports
    // apply it synchronously so contraction never depends on a frame firing.
    const applyRenderWindowRefresh = useCallback((live: Viewport) => {
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
      renderViewport(next);
      applyRenderWindowRefresh(next);
      onViewportChange(next);
    }, [applyRenderWindowRefresh, onViewportChange, renderViewport]);

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
      const target = {
        zoom: clamped,
        x: centerX - contentX * clamped,
        y: centerY - contentY * clamped,
      };
      onZoomPreview?.(clamped);
      commitViewportImmediately(target);
    };

    const handleWheel = useCallback((event: WheelEvent) => {
      const editor =
        event.target instanceof HTMLTextAreaElement &&
        event.target.classList.contains("mind-node__editor")
          ? event.target
          : null;
      if (
        editor &&
        editor.scrollHeight > editor.clientHeight &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        return;
      }
      event.preventDefault();
      // Pointer-owned geometry is calculated from the viewport captured when
      // the gesture begins. Wheel movement yields until that owner finishes.
      if (hasActiveCanvasDrag()) return;
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
      const panDelta = wheelPanPixelDelta(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        containerBoundsRef.current?.height ??
          containerRef.current?.getBoundingClientRect().height ??
          0,
      );
      scheduleViewportCommit({
        ...current,
        x: current.x - panDelta.x,
        y: current.y - panDelta.y,
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
      renderViewport,
      commitViewport: commitViewportImmediately,
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
    const renderedPortalAnchorIds = useMemo(
      () =>
        visibleLayoutPortalAnchorIds(
          layout,
          renderViewportState,
          containerSize,
          selectedSubspaceAnchorId,
        ),
      [
        containerSize,
        layout,
        renderViewportState,
        selectedSubspaceAnchorId,
      ],
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
        ? selectedSubspaceAnchorId === selection.primaryId
          ? layout.portals?.[selection.primaryId]
          : layout.nodes[selection.primaryId]
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
        zoomIn: () => zoomAtCenter(steppedCanvasZoom(liveViewport.current.zoom, 1)),
        zoomOut: () => zoomAtCenter(steppedCanvasZoom(liveViewport.current.zoom, -1)),
        resetZoom: () => {
          const bounds = containerRef.current?.getBoundingClientRect();
          if (!bounds) return;
          const current = liveViewport.current;
          const anchorNode = selection.primaryId
            ? selectedSubspaceAnchorId === selection.primaryId
              ? layout.portals?.[selection.primaryId]
              : layout.nodes[selection.primaryId]
            : null;
          const anchorX = anchorNode
            ? anchorNode.x + anchorNode.width / 2
            : (bounds.width / 2 - current.x) / current.zoom;
          const anchorY = anchorNode
            ? anchorNode.y + anchorNode.height / 2
            : (bounds.height / 2 - current.y) / current.zoom;
          onZoomPreview?.(1);
          commitViewportImmediately({
            zoom: 1,
            x: bounds.width / 2 - anchorX,
            y: bounds.height / 2 - anchorY,
          });
        },
      }),
      [fit, layout, onZoomPreview, selectedSubspaceAnchorId, selection.primaryId, viewport],
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
        commitViewportImmediately({ ...current, x, y });
      }
    }, [commitViewportImmediately, layout, selecting, selection]);

    const canvasPointFromClient = (clientX: number, clientY: number) =>
      clientPointToCanvas(
        clientX,
        clientY,
        containerBoundsRef.current ??
          containerRef.current?.getBoundingClientRect() ?? {
            left: 0,
            top: 0,
            width: 0,
            height: 0,
          },
        liveViewport.current,
      );

    return (
      <div
        aria-label={t("思维导图画布")}
        className={className}
        onClickCapture={(event) => {
          nodeDragBindings.onClickCapture(event);
          if (!event.defaultPrevented) bindings.onClickCapture(event);
        }}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          const point = canvasPointFromClient(
            event.clientX,
            event.clientY,
          );
          onOpenCanvasContextMenu({
            clientX: event.clientX,
            clientY: event.clientY,
            contentX: point.x,
            contentY: point.y,
          });
        }}
        onDoubleClick={(event) => {
          if (
            event.target !== event.currentTarget || event.button !== 0 ||
            event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
            panModifierHeld.current || hasActiveCanvasDrag()
          ) return;
          event.preventDefault();
          const point = canvasPointFromClient(
            event.clientX,
            event.clientY,
          );
          onCreateFloatingAt(point.x, point.y);
        }}
        onPointerCancel={(event) => {
          nodeDragBindings.onPointerCancel(event);
          bindings.onPointerCancel(event);
        }}
        onPointerDown={bindings.onPointerDown}
        onLostPointerCapture={(event) => {
          nodeDragBindings.onLostPointerCapture(event);
          bindings.onLostPointerCapture(event);
        }}
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
            darkTones={darkTones}
            document={document}
            layout={layout}
            renderedPortalAnchorIds={renderedPortalAnchorIds}
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
            const selected =
              selectedIdSet.has(id) && selectedSubspaceAnchorId !== id;
            return (
              <MindMapNode
                darkTone={darkTones[id]}
                draft={draftForNode(id, editingId, draft)}
                editing={editingId === id}
                key={id}
                layout={layout.nodes[id]}
                node={node}
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onCommitEdit={onCommitEdit}
                onDraftChange={onDraftChange}
                onEditTab={onEditTab}
                onOpenContextMenu={(id, targetRect, returnFocus) =>
                  onOpenNodeContextMenu(
                    id,
                    targetRect,
                    returnFocus,
                    "mind-node",
                  )
                }
                onDragPointerDown={beginNodeDrag}
                onPasteStructured={onPasteStructured}
                onSelect={handleNodeSelect}
                onToggle={onToggle}
                primary={
                  activeSelection.primaryId === id &&
                  selectedSubspaceAnchorId !== id
                }
                selected={selected}
              />
            );
          })}
          {renderedPortalAnchorIds.map((anchorId) => {
            const subspaceId = document.nodes[anchorId]?.subspaceId;
            const space = subspaceId
              ? document.spaces?.[subspaceId]
              : undefined;
            const portalLayout = layout.portals?.[anchorId];
            if (!space || !portalLayout) return null;
            return (
              <SubspacePortalNode
                darkTone={darkTones[anchorId]}
                anchorId={anchorId}
                canMoveTo={(targetId) =>
                  targetId !== anchorId &&
                  Boolean(document.nodes[targetId]) &&
                  !document.nodes[targetId].subspaceId
                }
                key={`subspace:${anchorId}`}
                layout={portalLayout}
                onMove={onMoveSubspace}
                onOpen={onOpenSubspace}
                onOpenContextMenu={(id, targetRect, returnFocus) =>
                  onOpenNodeContextMenu(
                    id,
                    targetRect,
                    returnFocus,
                    "subspace-portal",
                  )
                }
                onSelect={onSelectSubspace}
                selected={selectedSubspaceAnchorId === anchorId}
                space={space}
                zoom={document.viewport.zoom}
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
            ? t("未选择节点")
            : selection.selectedIds.length === 1
              ? t("已选择 1 个节点")
              : t("已选择 {0} 个节点", selection.selectedIds.length)}
        </div>
      </div>
    );
  },
);
