import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useFlowConnectionDrag } from "../../hooks/useFlowConnectionDrag";
import { useFlowAutoPan } from "../../hooks/useFlowAutoPan";
import { useFlowEdgeReconnect } from "../../hooks/useFlowEdgeReconnect";
import { useFlowKeyboardCommands } from "../../hooks/useFlowKeyboardCommands";
import { useFlowNodeDrag } from "../../hooks/useFlowNodeDrag";
import { useFlowViewport } from "../../hooks/useFlowViewport";
import {
  compileFlowConnectors,
  computeFlowLayout,
  includeFlowConnectorBounds,
  flowNavigationTarget,
  flowNodeSize,
  resolveFlowDirectionalPlacement,
  type FlowNavigationDirection,
} from "../../model/flowLayout";
import {
  connectableFlowNodeIds,
  positionFlowNode,
} from "../../model/spaces";
import type {
  FlowEdge,
  FlowEdgeRouteOverride,
  FlowEdgeStyle,
  FlowNodeKind,
  FlowNodePosition,
  FlowPlacementDirection,
  FlowSpace,
  Viewport,
} from "../../types/mindmap";
import type { TextWidthMeasurer } from "../../model/layout";
import { Icon } from "../icons/Icon";
import { FlowNodeMenu } from "../spaces/FlowNodeMenu";
import { FlowTargetPicker } from "../spaces/FlowTargetPicker";
import { FlowConnectionPreview } from "./FlowConnectionPreview";
import { FlowEdgeLayer } from "./FlowEdgeLayer";
import { FlowNodeView } from "./FlowNodeView";
import { FlowQuickCreatePreview } from "./FlowQuickCreatePreview";
import { FlowShapePalette } from "./FlowShapePalette";
import { createCanvasTextWidthMeasurer } from "./textMeasure";

export interface FlowCanvasHandle {
  fit: () => void;
  focusSelected: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
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
  onSpaceTap?: () => void;
  onDraftChange: (value: string) => void;
  onEdgeDraftChange?: (edgeId: string, value: string) => void;
  onEdgeDraftFinish?: (cancelled: boolean) => void;
  onCommitEdit: (id: string, value: string) => void;
  onCancelEdit: () => void;
  onAddNode?: (
    id: string,
    kind: Extract<FlowNodeKind, "step" | "decision">,
    direction: FlowPlacementDirection,
    currentPositions: Record<string, FlowNodePosition>,
    resolvedPosition?: FlowNodePosition,
  ) => void;
  onAddNext: (id: string) => void;
  onAddBranch: (id: string) => void;
  onAddShape?: (
    kind: FlowNodeKind,
    position: FlowNodePosition,
    currentPositions: Record<string, FlowNodePosition>,
  ) => void;
  onChangeKind: (id: string, kind: FlowNodeKind, positions: Record<string, FlowNodePosition>, measureTextWidth?: TextWidthMeasurer) => void;
  onChangeEdgeLabel: (edgeId: string, label: string) => void;
  onChangeEdgeLabelOffset?: (edgeId: string, offset: FlowNodePosition) => void;
  onChangeEdgeRoute?: (
    edgeId: string,
    route: FlowEdgeRouteOverride | null,
  ) => void;
  onChangeEdgeStyle?: (edgeId: string, patch: Partial<FlowEdgeStyle>) => void;
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
  keyboardEnabled?: boolean;
  onBack?: () => void;
  onRedo?: () => void;
  onUndo?: () => void;
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

interface EdgeReconnectPickerState {
  edgeId: string;
  endpoint: "from" | "to";
  movingPort: FlowPlacementDirection;
  returnFocus: SVGCircleElement;
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
      onSpaceTap = () => undefined,
      onDraftChange,
      onEdgeDraftChange = () => undefined,
      onEdgeDraftFinish = () => undefined,
      onCommitEdit,
      onCancelEdit,
      onAddNode = () => undefined,
      onAddNext,
      onAddBranch,
      onAddShape = () => undefined,
      onChangeKind,
      onChangeEdgeLabel,
      onChangeEdgeLabelOffset = () => undefined,
      onChangeEdgeRoute = () => undefined,
      onChangeEdgeStyle = () => undefined,
      onConnect,
      onDelete,
      onDeleteEdge = () => undefined,
      keyboardEnabled = true,
      onBack = () => undefined,
      onRedo = () => undefined,
      onUndo = () => undefined,
      onReconnectEdge = () => undefined,
      onPositionsChange = () => undefined,
      onViewportChange,
    },
    ref,
  ) {
    const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
    const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [edgeReconnectPicker, setEdgeReconnectPicker] =
      useState<EdgeReconnectPickerState | null>(null);
    const [quickCreateIntent, setQuickCreateIntent] = useState<{
      id: string;
      port: FlowPlacementDirection;
    } | null>(null);
    const [nodeDragPreview, setNodeDragPreview] = useState<{
      nodeId: string; position: FlowNodePosition;
    } | null>(null);
    const measureTextWidth = useMemo(
      () => createCanvasTextWidthMeasurer(),
      [],
    );
    const baseLayout = useMemo(() => {
      const current = computeFlowLayout(editingId && space.nodes[editingId] ? {
        ...space,
        nodes: { ...space.nodes, [editingId]: { ...space.nodes[editingId], text: draft } },
      } : space, measureTextWidth);
      return current;
    }, [draft, editingId, measureTextWidth, space.nodes, space.edges, space.positions]);
    const displayedLayout = useMemo(() => nodeDragPreview ? {
      ...baseLayout,
      nodes: { ...baseLayout.nodes, [nodeDragPreview.nodeId]: {
        ...baseLayout.nodes[nodeDragPreview.nodeId], ...nodeDragPreview.position,
      } },
    } : baseLayout, [baseLayout, nodeDragPreview]);
    const connectors = useMemo(
      () => compileFlowConnectors(space, displayedLayout, measureTextWidth),
      [displayedLayout, measureTextWidth, space.edgeRoutes, space.edges, space.nodes],
    );
    const layout = useMemo(
      () => includeFlowConnectorBounds(
        space,
        displayedLayout,
        measureTextWidth,
        connectors,
      ),
      [displayedLayout, connectors, measureTextWidth, space.edgeLabelOffsets],
    );
    const nodes = useMemo(() => Object.values(space.nodes), [space.nodes]);
    const clearCanvasSelection = useCallback(() => {
      onSelect(null);
      setSelectedEdgeId(null);
      setEdgeReconnectPicker(null);
      setNodeMenu(null);
      setQuickCreateIntent(null);
    }, [onSelect]);
    const {
      bindings,
      containerRef,
      contentRef,
      fit,
      focusSelected,
      zoomIn,
      zoomOut,
      resetZoom,
      flushViewport,
      panBy,
      panModifierHeld,
    } = useFlowViewport({
      layout,
      onCanvasPointerDown: clearCanvasSelection,
      onViewportChange,
      onSpaceTap,
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
    const createDirectionalNode = useCallback((
      nodeId: string,
      kind: Extract<FlowNodeKind, "step" | "decision">,
      port: FlowPlacementDirection,
    ) => {
      setQuickCreateIntent(null);
      const placement = resolveFlowDirectionalPlacement(
        space,
        nodeId,
        kind,
        port,
        currentPositions,
        measureTextWidth,
      );
      onAddNode(
        nodeId,
        kind,
        port,
        currentPositions,
        placement ? { x: placement.x, y: placement.y } : undefined,
      );
    }, [currentPositions, measureTextWidth, onAddNode, space]);
    const createFromPort = useCallback((
      nodeId: string,
      port: FlowPlacementDirection,
    ) => createDirectionalNode(nodeId, "step", port), [createDirectionalNode]);
    const connection = useFlowConnectionDrag({
      containerRef,
      onConnect,
      onCreateFromPort: createFromPort,
      onSelect,
      space,
    });
    const selectEdge = useCallback((
      edgeId: string,
      restoreCanvasFocus = true,
    ) => {
      onSelect(null);
      setNodeMenu(null);
      setConnectingFromId(null);
      setEdgeReconnectPicker(null);
      setSelectedEdgeId(edgeId);
      setQuickCreateIntent(null);
      if (restoreCanvasFocus) {
        containerRef.current?.focus({ preventScroll: true });
      }
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
        setEdgeReconnectPicker(null);
      }
    }, [selectedEdgeId, space.edges]);
    useEffect(() => {
      setSelectedEdgeId(null);
      setEdgeReconnectPicker(null);
      setQuickCreateIntent(null);
      setConnectingFromId(null);
      setNodeMenu(null);
    }, [space.id]);
    const beginConnectionDrag = useCallback((
      fromId: string,
      fromPort: FlowPlacementDirection,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (panModifierHeld.current) return;
      setNodeMenu(null);
      setConnectingFromId(null);
      setSelectedEdgeId(null);
      setEdgeReconnectPicker(null);
      setQuickCreateIntent(null);
      connection.begin(fromId, fromPort, event);
    }, [connection.begin, panModifierHeld]);
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
      setEdgeReconnectPicker(null);
      onSelect(nodeId);
    }, [onSelect]);
    const nodeDrag = useFlowNodeDrag({
      containerRef,
      layout,
      onMove: moveNode,
      onPreview: setNodeDragPreview,
      onSelect: selectNode,
      space,
    });
    const quickCreatePlacement = useMemo(() => quickCreateIntent
      ? resolveFlowDirectionalPlacement(
          space,
          quickCreateIntent.id,
          "step",
          quickCreateIntent.port,
          currentPositions,
          measureTextWidth,
        )
      : null, [
        currentPositions,
        measureTextWidth,
        quickCreateIntent,
        space,
      ]);
    const navigateSelection = useCallback((direction: FlowNavigationDirection) => {
      if (!selectedId) return;
      const target = flowNavigationTarget(space, selectedId, direction);
      if (target) selectNode(target);
    }, [selectNode, selectedId, space]);
    useFlowKeyboardCommands({
      enabled: keyboardEnabled && edgeReconnectPicker === null,
      selectedEdgeId,
      selectedId,
      onAddNext,
      onAddBranch,
      onBeginEdit,
      onClearEdgeSelection: () => {
        setSelectedEdgeId(null);
        setEdgeReconnectPicker(null);
      },
      onDelete,
      onDeleteEdge: (edgeId) => {
        onDeleteEdge(edgeId);
        setSelectedEdgeId(null);
        setEdgeReconnectPicker(null);
      },
      onNavigate: navigateSelection,
      onBack,
      onUndo,
      onRedo,
    });
    const autoPan = useFlowAutoPan(containerRef);
    const keepAutoPanning = useCallback((
      clientX: number,
      clientY: number,
      shiftViewport: (x: number, y: number) => void,
      interactionActive: () => boolean,
    ) => {
      autoPan.update(clientX, clientY, (x, y) => {
        panBy(x, y);
        shiftViewport(x, y);
      }, interactionActive);
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
      focusSelected,
      zoomIn,
      zoomOut,
      resetZoom,
      flushViewport,
      focusCanvas: () => containerRef.current?.focus({ preventScroll: true }),
    }), [containerRef, fit, focusSelected, zoomIn, zoomOut, resetZoom, flushViewport]);

    const openNodeMenu = useCallback((
      nodeId: string,
      targetRect: { left: number; right: number; top: number; bottom: number },
      returnFocus: HTMLElement,
    ) => {
      onSelect(nodeId);
      setSelectedEdgeId(null);
      setEdgeReconnectPicker(null);
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
    const edgeReconnectChoice = useMemo(() => {
      if (!edgeReconnectPicker) return null;
      const edge = space.edges.find(({ id }) => id === edgeReconnectPicker.edgeId);
      if (!edge) return null;
      const withoutCurrent = {
        ...space,
        edges: space.edges.filter(({ id }) => id !== edge.id),
      };
      const candidateIds = edgeReconnectPicker.endpoint === "from"
        ? new Set(
            Object.keys(space.nodes).filter((nodeId) =>
              connectableFlowNodeIds(withoutCurrent, nodeId).has(edge.to),
            ),
          )
        : connectableFlowNodeIds(withoutCurrent, edge.from);
      return {
        edge,
        candidates: nodes.filter(({ id }) => candidateIds.has(id)),
      };
    }, [edgeReconnectPicker, nodes, space]);
    const closeEdgeReconnectPicker = useCallback(() => {
      const returnFocus = edgeReconnectPicker?.returnFocus;
      setEdgeReconnectPicker(null);
      window.requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        else containerRef.current?.focus({ preventScroll: true });
      });
    }, [containerRef, edgeReconnectPicker]);
    return (
      <div
        aria-label="流程画布"
        className="flow-canvas"
        data-flow-connecting={
          connection.state || edgeReconnect.state ? "true" : undefined
        }
        onLostPointerCapture={(event) => {
          autoPan.stop();
          edgeReconnect.lostPointerCapture(event);
          connection.lostPointerCapture(event);
          nodeDrag.lostPointerCapture(event);
          bindings.onLostPointerCapture(event);
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
            keepAutoPanning(
              event.clientX,
              event.clientY,
              edgeReconnect.shiftViewport,
              edgeReconnect.active,
            );
            return;
          }
          if (connection.pointerMove(event)) {
            keepAutoPanning(
              event.clientX,
              event.clientY,
              connection.shiftViewport,
              connection.active,
            );
            return;
          }
          if (nodeDrag.pointerMove(event)) {
            keepAutoPanning(
              event.clientX,
              event.clientY,
              nodeDrag.shiftViewport,
              nodeDrag.active,
            );
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
            connectors={connectors}
            edges={space.edges}
            edgeRoutes={space.edgeRoutes}
            edgeLabelOffsets={space.edgeLabelOffsets}
            onChangeLabelOffset={onChangeEdgeLabelOffset}
            layout={layout}
            measureTextWidth={measureTextWidth}
            nodes={space.nodes}
            onChangeLabel={onChangeEdgeLabel}
            onChangeRoute={onChangeEdgeRoute}
            onChangeStyle={onChangeEdgeStyle}
            onClearSelection={() => {
              setSelectedEdgeId(null);
              setEdgeReconnectPicker(null);
              window.requestAnimationFrame(() => {
                containerRef.current?.focus({ preventScroll: true });
              });
            }}
            onDraftChange={onEdgeDraftChange}
            onDraftFinish={onEdgeDraftFinish}
            onDeleteEdge={(edgeId) => {
              onDeleteEdge(edgeId);
              setSelectedEdgeId(null);
              setEdgeReconnectPicker(null);
              window.requestAnimationFrame(() => {
                containerRef.current?.focus({ preventScroll: true });
              });
            }}
            onEndpointKeyboardActivate={(
              edge: FlowEdge,
              endpoint,
              movingPort,
              returnFocus,
            ) => {
              setConnectingFromId(null);
              setEdgeReconnectPicker({
                edgeId: edge.id,
                endpoint,
                movingPort,
                returnFocus,
              });
            }}
            onEndpointPointerDown={edgeReconnect.begin}
            onSelectEdge={selectEdge}
            selectedEdgeId={selectedEdgeId}
            spaceId={space.id}
            zoom={space.viewport.zoom}
          />

          {quickCreateIntent && quickCreatePlacement &&
            !connection.state && !edgeReconnect.state &&
            layout.nodes[quickCreateIntent.id] && (
              <FlowQuickCreatePreview
                direction={quickCreateIntent.port}
                layout={layout}
                measureTextWidth={measureTextWidth}
                placement={quickCreatePlacement}
                source={layout.nodes[quickCreateIntent.id]}
                space={space}
                spaceId={space.id}
              />
            )}

          {nodes.map((node) => {
            const position = layout.nodes[node.id];
            if (!position) return null;
            const editing = node.id === editingId;
            return (
              <FlowNodeView
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
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onConnectPointerDown={beginConnectionDrag}
                onCommitEdit={onCommitEdit}
                onDraftChange={onDraftChange}
                onOpenMenu={openNodeMenu}
                onNodePointerDown={(nodeId, event) => {
                  // Space-held pointer presses pan the canvas instead of
                  // dragging nodes.
                  if (panModifierHeld.current) return;
                  nodeDrag.begin(nodeId, event);
                }}
                onPortClick={(nodeId, port) => {
                  if (connection.consumeHandledPortClick(nodeId, port)) return;
                  createFromPort(nodeId, port);
                }}
                onPortIntentChange={setQuickCreateIntent}
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
              onChangeKind(nodeId, kind, currentPositions, measureTextWidth);
            }}
            onClose={(restoreFocus) => {
              const returnFocus = nodeMenu.returnFocus;
              setNodeMenu(null);
              if (restoreFocus) {
                window.requestAnimationFrame(() =>
                  returnFocus.focus({ preventScroll: true }),
                );
              }
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

        {edgeReconnectPicker && edgeReconnectChoice && (
          <FlowTargetPicker
            candidates={edgeReconnectChoice.candidates}
            description={
              edgeReconnectPicker.endpoint === "from"
                ? "选择新的连线起点；保留当前出口方向"
                : "选择新的连线终点；保留当前入口方向"
            }
            eyebrow="连线端点"
            listLabel="可连接的步骤"
            onChoose={(nodeId) => {
              onReconnectEdge(
                edgeReconnectPicker.edgeId,
                edgeReconnectPicker.endpoint,
                nodeId,
                edgeReconnectPicker.movingPort,
              );
              closeEdgeReconnectPicker();
            }}
            onClose={closeEdgeReconnectPicker}
            sourceLabel={
              edgeReconnectChoice.edge.label ||
              `${space.nodes[edgeReconnectChoice.edge.from]?.text || "未命名步骤"} → ${space.nodes[edgeReconnectChoice.edge.to]?.text || "未命名步骤"}`
            }
            title={
              edgeReconnectPicker.endpoint === "from"
                ? "重连起点"
                : "重连终点"
            }
          />
        )}
      </div>
    );
  },
);
