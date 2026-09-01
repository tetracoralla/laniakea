import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useFlowConnectionDrag } from "../../hooks/useFlowConnectionDrag";
import { useFlowAutoPan } from "../../hooks/useFlowAutoPan";
import { useFlowEdgeReconnect } from "../../hooks/useFlowEdgeReconnect";
import { useFlowNodeDrag } from "../../hooks/useFlowNodeDrag";
import { useFlowViewport } from "../../hooks/useFlowViewport";
import { computeFlowLayout, flowNodeSize } from "../../model/flowLayout";
import {
  connectableFlowNodeIds,
  positionFlowNode,
} from "../../model/spaces";
import type {
  FlowNodeKind,
  FlowNodePosition,
  FlowPlacementDirection,
  FlowSpace,
  Viewport,
} from "../../types/mindmap";
import { Icon } from "../icons/Icon";
import { FlowNodeMenu } from "../spaces/FlowNodeMenu";
import { FlowTargetPicker } from "../spaces/FlowTargetPicker";
import { FlowConnectionPreview } from "./FlowConnectionPreview";
import { FlowEdgeLayer } from "./FlowEdgeLayer";
import { FlowNodeView } from "./FlowNodeView";
import { FlowShapePalette } from "./FlowShapePalette";
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
  onAddNode?: (
    id: string,
    kind: Extract<FlowNodeKind, "step" | "decision">,
    direction: FlowPlacementDirection,
    currentPositions: Record<string, FlowNodePosition>,
  ) => void;
  onAddNext: (id: string) => void;
  onAddBranch: (id: string) => void;
  onAddShape?: (
    kind: FlowNodeKind,
    position: FlowNodePosition,
    currentPositions: Record<string, FlowNodePosition>,
  ) => void;
  onChangeKind: (id: string, kind: FlowNodeKind) => void;
  onChangeEdgeLabel: (edgeId: string, label: string) => void;
  onConnect: (
    fromId: string,
    toId: string,
    ports?: {
      fromPort?: FlowPlacementDirection;
      toPort?: FlowPlacementDirection;
    },
  ) => void;
  onDelete: (id: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onReconnectEdge?: (
    edgeId: string,
    endpoint: "from" | "to",
    nodeId: string,
    port: FlowPlacementDirection,
  ) => void;
  onPositionsChange?: (positions: Record<string, FlowNodePosition>) => void;
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
      onAddNode = () => undefined,
      onAddNext,
      onAddBranch,
      onAddShape = () => undefined,
      onChangeKind,
      onChangeEdgeLabel,
      onConnect,
      onDelete,
      onDeleteEdge = () => undefined,
      onReconnectEdge = () => undefined,
      onPositionsChange = () => undefined,
      onViewportChange,
    },
    ref,
  ) {
    const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
    const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const measureTextWidth = useMemo(
      () => createCanvasTextWidthMeasurer(),
      [],
    );
    const layout = useMemo(
      () => computeFlowLayout(space, measureTextWidth),
      [measureTextWidth, space.nodes, space.edges, space.positions],
    );
    const nodes = useMemo(() => Object.values(space.nodes), [space.nodes]);
    const clearCanvasSelection = useCallback(() => {
      onSelect(null);
      setSelectedEdgeId(null);
      setNodeMenu(null);
    }, [onSelect]);
    const {
      bindings,
      containerRef,
      contentRef,
      fit,
      flushViewport,
      panBy,
    } = useFlowViewport({
      layout,
      onCanvasPointerDown: clearCanvasSelection,
      onViewportChange,
      selectedId,
      viewport: space.viewport,
    });
    const currentPositions = useMemo(
      () => Object.fromEntries(
        Object.entries(layout.nodes).map(([id, node]) => [
          id,
          { x: node.x, y: node.y },
        ]),
      ),
      [layout.nodes],
    );
    const createFromPort = useCallback((
      nodeId: string,
      port: FlowPlacementDirection,
    ) => {
      onAddNode(nodeId, "step", port, currentPositions);
    }, [currentPositions, onAddNode]);
    const connection = useFlowConnectionDrag({
      containerRef,
      onConnect,
      onCreateFromPort: createFromPort,
      onSelect,
      space,
    });
    const selectEdge = useCallback((edgeId: string) => {
      onSelect(null);
      setNodeMenu(null);
      setConnectingFromId(null);
      setSelectedEdgeId(edgeId);
      window.requestAnimationFrame(() => {
        containerRef.current?.focus({ preventScroll: true });
      });
    }, [containerRef, onSelect]);
    const edgeReconnect = useFlowEdgeReconnect({
      containerRef,
      onReconnect: onReconnectEdge,
      onSelectEdge: selectEdge,
      space,
    });
    useEffect(() => {
      if (selectedEdgeId && !space.edges.some(({ id }) => id === selectedEdgeId)) {
        setSelectedEdgeId(null);
      }
    }, [selectedEdgeId, space.edges]);
    const beginConnectionDrag = useCallback((
      fromId: string,
      fromPort: FlowPlacementDirection,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      setNodeMenu(null);
      setConnectingFromId(null);
      setSelectedEdgeId(null);
      connection.begin(fromId, fromPort, event);
    }, [connection.begin]);
    const moveNode = useCallback((
      nodeId: string,
      position: FlowNodePosition,
      currentPositions: Record<string, FlowNodePosition>,
    ) => {
      const positioned = positionFlowNode(
        space,
        nodeId,
        position,
        currentPositions,
      );
      onPositionsChange(
        positioned.positions ?? { ...currentPositions, [nodeId]: position },
      );
    }, [onPositionsChange, space]);
    const selectNode = useCallback((nodeId: string | null) => {
      setSelectedEdgeId(null);
      onSelect(nodeId);
    }, [onSelect]);
    const nodeDrag = useFlowNodeDrag({
      containerRef,
      layout,
      onMove: moveNode,
      onSelect: selectNode,
      space,
    });
    const autoPan = useFlowAutoPan(containerRef);
    const keepAutoPanning = useCallback((
      clientX: number,
      clientY: number,
      shiftViewport: (x: number, y: number) => void,
    ) => {
      autoPan.update(clientX, clientY, (x, y) => {
        panBy(x, y);
        shiftViewport(x, y);
      });
    }, [autoPan, panBy]);
    const insertShapeAtClientPoint = useCallback((
      kind: Extract<FlowNodeKind, "step" | "decision" | "start">,
      clientPoint: { x: number; y: number },
      requireInside: boolean,
    ) => {
      const canvas = containerRef.current;
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      if (
        requireInside &&
        (clientPoint.x < bounds.left || clientPoint.x > bounds.right ||
          clientPoint.y < bounds.top || clientPoint.y > bounds.bottom)
      ) return;
      const size = flowNodeSize(kind, "", measureTextWidth);
      const canvasPoint = {
        x: (clientPoint.x - bounds.left - space.viewport.x) / space.viewport.zoom,
        y: (clientPoint.y - bounds.top - space.viewport.y) / space.viewport.zoom,
      };
      const grid = 12;
      let x = Math.round((canvasPoint.x - size.width / 2) / grid) * grid;
      let y = Math.round((canvasPoint.y - size.height / 2) / grid) * grid;
      const centerX = x + size.width / 2;
      const centerY = y + size.height / 2;
      const alignmentRange = 10 / space.viewport.zoom;
      for (const node of Object.values(layout.nodes)) {
        const nodeCenterX = node.x + node.width / 2;
        const nodeCenterY = node.y + node.height / 2;
        if (Math.abs(nodeCenterX - centerX) <= alignmentRange) {
          x = nodeCenterX - size.width / 2;
        }
        if (Math.abs(nodeCenterY - centerY) <= alignmentRange) {
          y = nodeCenterY - size.height / 2;
        }
      }
      const collisionInset = 18;
      for (let attempt = 0; attempt <= Object.keys(layout.nodes).length; attempt += 1) {
        const collision = Object.values(layout.nodes).find((node) =>
          x < node.x + node.width + collisionInset &&
          x + size.width + collisionInset > node.x &&
          y < node.y + node.height + collisionInset &&
          y + size.height + collisionInset > node.y
        );
        if (!collision) break;
        x = Math.round((collision.x + collision.width + 72) / grid) * grid;
        y = collision.y + (collision.height - size.height) / 2;
      }
      onAddShape(kind, { x, y }, currentPositions);
    }, [
      containerRef,
      currentPositions,
      layout.nodes,
      measureTextWidth,
      onAddShape,
      space.viewport,
    ]);
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
      setSelectedEdgeId(null);
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
    const selectedCanConnect = useMemo(
      () => selectedId
        ? connectableFlowNodeIds(space, selectedId).size > 0
        : false,
      [selectedId, space],
    );
    return (
      <div
        aria-label="流程画布"
        className="flow-canvas"
        data-flow-connecting={
          connection.state || edgeReconnect.state ? "true" : undefined
        }
        data-flow-edge-selected={selectedEdgeId ? "true" : undefined}
        onKeyDown={(event) => {
          if (!selectedEdgeId) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setSelectedEdgeId(null);
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            event.stopPropagation();
            onDeleteEdge(selectedEdgeId);
            setSelectedEdgeId(null);
          }
        }}
        onLostPointerCapture={(event) => {
          autoPan.stop();
          edgeReconnect.lostPointerCapture(event);
          connection.lostPointerCapture(event);
          nodeDrag.lostPointerCapture(event);
        }}
        onPointerCancel={(event) => {
          autoPan.stop();
          if (edgeReconnect.pointerCancel(event)) return;
          if (connection.pointerCancel(event)) return;
          if (nodeDrag.pointerCancel(event)) return;
          bindings.onPointerCancel(event);
        }}
        onPointerDown={bindings.onPointerDown}
        onPointerMove={(event) => {
          if (edgeReconnect.pointerMove(event)) {
            keepAutoPanning(event.clientX, event.clientY, edgeReconnect.shiftViewport);
            return;
          }
          if (connection.pointerMove(event)) {
            keepAutoPanning(event.clientX, event.clientY, connection.shiftViewport);
            return;
          }
          if (nodeDrag.pointerMove(event)) {
            keepAutoPanning(event.clientX, event.clientY, nodeDrag.shiftViewport);
            return;
          }
          autoPan.stop();
          bindings.onPointerMove(event);
        }}
        onPointerUp={(event) => {
          autoPan.stop();
          if (edgeReconnect.pointerUp(event)) return;
          if (connection.pointerUp(event)) return;
          if (nodeDrag.pointerUp(event)) return;
          bindings.onPointerUp(event);
        }}
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
            onDeleteEdge={(edgeId) => {
              onDeleteEdge(edgeId);
              setSelectedEdgeId(null);
              window.requestAnimationFrame(() => {
                containerRef.current?.focus({ preventScroll: true });
              });
            }}
            onEndpointPointerDown={edgeReconnect.begin}
            onSelectEdge={selectEdge}
            selectedEdgeId={selectedEdgeId}
            spaceId={space.id}
          />

          {nodes.map((node) => {
            const position = layout.nodes[node.id];
            if (!position) return null;
            const editing = node.id === editingId;
            return (
              <FlowNodeView
                canStartConnection={
                  node.id === selectedId && selectedCanConnect
                }
                connectableTarget={
                  connection.connectableIds.has(node.id) ||
                  edgeReconnect.connectableIds.has(node.id)
                }
                connectionTarget={
                  connection.state?.targetId === node.id ||
                  edgeReconnect.state?.targetId === node.id
                }
                connectionTargetPort={
                  connection.state?.targetId === node.id
                    ? connection.state.targetPort
                    : edgeReconnect.state?.targetId === node.id
                      ? edgeReconnect.state.targetPort
                    : null
                }
                connectingSource={connection.state?.fromId === node.id}
                draft={editing ? draft : ""}
                editing={editing}
                key={node.id}
                node={node}
                onAddNode={(nodeId, kind, direction) =>
                  onAddNode(nodeId, kind, direction, currentPositions)
                }
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onConnectPointerDown={beginConnectionDrag}
                onCommitEdit={onCommitEdit}
                onDraftChange={onDraftChange}
                onOpenMenu={openNodeMenu}
                onNodePointerDown={nodeDrag.begin}
                onPortClick={(nodeId, port) => {
                  if (connection.consumeHandledPortClick(nodeId, port)) return;
                  createFromPort(nodeId, port);
                }}
                onSelect={selectNode}
                position={position}
                selected={node.id === selectedId}
              />
            );
          })}
        </div>

        {connection.state && (
          <FlowConnectionPreview
            end={connection.state.current}
            fromPort={connection.state.fromPort}
            spaceId={space.id}
            start={connection.state.start}
            toPort={connection.state.targetPort}
          />
        )}
        {edgeReconnect.preview && (
          <FlowConnectionPreview
            end={edgeReconnect.preview.end}
            fromPort={edgeReconnect.preview.fromPort}
            spaceId={`${space.id}-reconnect`}
            start={edgeReconnect.preview.start}
            toPort={edgeReconnect.preview.toPort}
          />
        )}
        <div aria-live="polite" className="sr-only" role="status">
          {edgeReconnect.targetLabel
            ? `松开以重接到${edgeReconnect.targetLabel}`
            : connection.targetLabel
              ? `松开以连接到${connection.targetLabel}`
              : edgeReconnect.state
                ? "拖动端点到节点的另一侧或其他节点"
                : connection.state
              ? "拖动到可连接的节点"
              : ""}
        </div>

        <FlowShapePalette
          onDrop={(kind, point) => insertShapeAtClientPoint(kind, point, true)}
          onInsert={(kind) => {
            const bounds = containerRef.current?.getBoundingClientRect();
            if (!bounds) return;
            insertShapeAtClientPoint(kind, {
              x: (bounds.left + bounds.right) / 2,
              y: (bounds.top + bounds.bottom) / 2,
            }, false);
          }}
        />

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
