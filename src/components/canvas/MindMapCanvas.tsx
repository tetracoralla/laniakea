import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useCanvasGestures } from "../../hooks/useCanvasGestures";
import { computeLayout } from "../../model/layout";
import {
  singleSelection,
  toggleSelectedNode,
} from "../../model/selection";
import type {
  MindMapDocument,
  SelectionState,
  Viewport,
} from "../../types/mindmap";
import { Connectors } from "./Connectors";
import { MindMapNode } from "./MindMapNode";
import { SelectionMarquee } from "./SelectionMarquee";

export interface CanvasHandle {
  fit: () => void;
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
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onViewportChange: (viewport: Viewport) => void;
}

const minZoom = 0.52;
const maxZoom = 1.8;

function clampZoom(value: number): number {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

export function draftForNode(
  nodeId: string,
  editingId: string | null,
  draft: string,
): string {
  return nodeId === editingId ? draft : "";
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
      onCommitEdit,
      onCancelEdit,
      onToggle,
      onViewportChange,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const persistTimer = useRef<number | null>(null);
    const liveViewport = useRef(document.viewport);
    const layout = useMemo(
      () => computeLayout(document),
      [document.nodes, document.rootId],
    );
    const viewport = document.viewport;

    const renderViewport = (next: Viewport) => {
      liveViewport.current = next;
      if (contentRef.current) {
        contentRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
      }
    };

    const scheduleViewportCommit = (next: Viewport) => {
      renderViewport(next);
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        onViewportChange(liveViewport.current);
        persistTimer.current = null;
      }, 120);
    };

    const {
      activeSelection,
      marqueeRect,
      selecting,
      className,
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
    const selectedIdSet = useMemo(
      () => new Set(activeSelection.selectedIds),
      [activeSelection.selectedIds],
    );
    const handleNodeSelect = useCallback(
      (id: string, additive: boolean) => {
        onSelectionChange(
          additive
            ? toggleSelectedNode(
                selection,
                id,
                layout.visibleIds,
              )
            : singleSelection(id),
        );
      },
      [
        layout.visibleIds,
        onSelectionChange,
        selection,
      ],
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

    useEffect(() => {
      renderViewport(viewport);
    }, [viewport.x, viewport.y, viewport.zoom]);

    useEffect(
      () => () => {
        if (persistTimer.current) window.clearTimeout(persistTimer.current);
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
        {...bindings}
        onWheel={(event) => {
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
          } else {
            const current = liveViewport.current;
            scheduleViewportCommit({
              ...current,
              x: current.x - event.deltaX,
              y: current.y - event.deltaY,
            });
          }
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
            transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
          }}
        >
          <Connectors document={document} layout={layout} />
          {layout.visibleIds.map((id) => {
            const node = document.nodes[id];
            const selected = selectedIdSet.has(id);
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
                onSelect={handleNodeSelect}
                onToggle={onToggle}
                primary={activeSelection.primaryId === id}
                selected={selected}
              />
            );
          })}
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
