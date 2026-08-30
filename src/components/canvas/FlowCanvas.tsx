import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useFlowViewport } from "../../hooks/useFlowViewport";
import { computeFlowLayout } from "../../model/flowLayout";
import { connectableFlowNodeIds } from "../../model/spaces";
import type {
  FlowNodeKind,
  FlowSpace,
  Viewport,
} from "../../types/mindmap";
import { Icon } from "../icons/Icon";
import { FlowNodeMenu } from "../spaces/FlowNodeMenu";
import { FlowTargetPicker } from "../spaces/FlowTargetPicker";
import { FlowEdgeLayer } from "./FlowEdgeLayer";
import { FlowNodeView } from "./FlowNodeView";
import { createCanvasTextWidthMeasurer } from "./textMeasure";

export interface FlowCanvasHandle {
  fit: () => void;
  focusCanvas: () => void;
  flushViewport: () => void;
}

export interface FlowCanvasProps {
  space: FlowSpace;
  selectedId: string | null;
  editingId: string | null;
  draft: string;
  onSelect: (id: string | null) => void;
  onBeginEdit: (id: string) => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: () => void;
  onAddNext: (id: string) => void;
  onAddBranch: (id: string) => void;
  onChangeKind: (id: string, kind: FlowNodeKind) => void;
  onChangeEdgeLabel: (edgeId: string, label: string) => void;
  onConnect: (fromId: string, toId: string) => void;
  onDelete: (id: string) => void;
  onViewportChange: (viewport: Viewport) => void;
}

interface NodeMenuState {
  nodeId: string;
  returnFocus: HTMLElement;
  targetRect: { left: number; right: number; top: number; bottom: number };
}

export const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(
  function FlowCanvas(
    {
      space,
      selectedId,
      editingId,
      draft,
      onSelect,
      onBeginEdit,
      onDraftChange,
      onCommitEdit,
      onCancelEdit,
      onAddNext,
      onAddBranch,
      onChangeKind,
      onChangeEdgeLabel,
      onConnect,
      onDelete,
      onViewportChange,
    },
    ref,
  ) {
    const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
    const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
    const measureTextWidth = useMemo(
      () => createCanvasTextWidthMeasurer(),
      [],
    );
    const layout = useMemo(
      () => computeFlowLayout(space, measureTextWidth),
      [measureTextWidth, space.nodes, space.edges],
    );
    const nodes = useMemo(() => Object.values(space.nodes), [space.nodes]);
    const clearCanvasSelection = useCallback(() => {
      onSelect(null);
      setNodeMenu(null);
    }, [onSelect]);
    const {
      bindings,
      containerRef,
      contentRef,
      fit,
      flushViewport,
    } = useFlowViewport({
      layout,
      onCanvasPointerDown: clearCanvasSelection,
      onViewportChange,
      selectedId,
      viewport: space.viewport,
    });

    useImperativeHandle(ref, () => ({
      fit,
      flushViewport,
      focusCanvas: () => containerRef.current?.focus({ preventScroll: true }),
    }), [containerRef, fit, flushViewport]);

    const openNodeMenu = useCallback((
      nodeId: string,
      targetRect: { left: number; right: number; top: number; bottom: number },
      returnFocus: HTMLElement,
    ) => {
      onSelect(nodeId);
      setNodeMenu({ nodeId, returnFocus, targetRect });
    }, [onSelect]);

    const connectionSourceId = connectingFromId ?? nodeMenu?.nodeId ?? null;
    const connectableIds = useMemo(
      () => connectionSourceId
        ? connectableFlowNodeIds(space, connectionSourceId)
        : new Set<string>(),
      [connectionSourceId, space],
    );
    const connectCandidates = useMemo(
      () => connectingFromId
        ? nodes.filter((node) => connectableIds.has(node.id))
        : [],
      [connectableIds, connectingFromId, nodes],
    );

    return (
      <div
        aria-label="流程画布"
        className="flow-canvas"
        onPointerCancel={bindings.onPointerCancel}
        onPointerDown={bindings.onPointerDown}
        onPointerMove={bindings.onPointerMove}
        onPointerUp={bindings.onPointerUp}
        ref={containerRef}
        role="application"
        tabIndex={0}
      >
        <div
          className="flow-canvas__content"
          ref={contentRef}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate3d(${space.viewport.x}px, ${space.viewport.y}px, 0) scale(${space.viewport.zoom})`,
          }}
        >
          <FlowEdgeLayer
            edges={space.edges}
            layout={layout}
            onChangeLabel={onChangeEdgeLabel}
            spaceId={space.id}
          />

          {nodes.map((node) => {
            const position = layout.nodes[node.id];
            if (!position) return null;
            const editing = node.id === editingId;
            return (
              <FlowNodeView
                draft={editing ? draft : ""}
                editing={editing}
                key={node.id}
                node={node}
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onCommitEdit={onCommitEdit}
                onDraftChange={onDraftChange}
                onOpenMenu={openNodeMenu}
                onSelect={onSelect}
                position={position}
                selected={node.id === selectedId}
              />
            );
          })}
        </div>

        <button
          aria-label="适应内容"
          className="flow-fit-button"
          onClick={fit}
          title="适应内容"
          type="button"
        >
          <Icon name="fit" size={16} />
        </button>

        {nodeMenu && space.nodes[nodeMenu.nodeId] && (
          <FlowNodeMenu
            canConnect={connectableIds.size > 0}
            node={space.nodes[nodeMenu.nodeId]}
            onAddBranch={() => {
              const nodeId = nodeMenu.nodeId;
              setNodeMenu(null);
              onAddBranch(nodeId);
            }}
            onAddNext={() => {
              const nodeId = nodeMenu.nodeId;
              setNodeMenu(null);
              onAddNext(nodeId);
            }}
            onBeginEdit={() => {
              const nodeId = nodeMenu.nodeId;
              setNodeMenu(null);
              onBeginEdit(nodeId);
            }}
            onChangeKind={(kind) => {
              const nodeId = nodeMenu.nodeId;
              setNodeMenu(null);
              onChangeKind(nodeId, kind);
            }}
            onClose={() => {
              const returnFocus = nodeMenu.returnFocus;
              setNodeMenu(null);
              window.requestAnimationFrame(() =>
                returnFocus.focus({ preventScroll: true }),
              );
            }}
            onConnect={() => {
              const nodeId = nodeMenu.nodeId;
              setNodeMenu(null);
              setConnectingFromId(nodeId);
            }}
            onDelete={() => {
              const nodeId = nodeMenu.nodeId;
              setNodeMenu(null);
              onDelete(nodeId);
            }}
            targetRect={nodeMenu.targetRect}
          />
        )}

        {connectingFromId && space.nodes[connectingFromId] && (
          <FlowTargetPicker
            candidates={connectCandidates}
            onChoose={(targetId) => {
              onConnect(connectingFromId, targetId);
              setConnectingFromId(null);
              window.requestAnimationFrame(() =>
                containerRef.current?.focus({ preventScroll: true }),
              );
            }}
            onClose={() => {
              setConnectingFromId(null);
              window.requestAnimationFrame(() =>
                containerRef.current?.focus({ preventScroll: true }),
              );
            }}
            sourceLabel={space.nodes[connectingFromId].text}
          />
        )}
      </div>
    );
  },
);
