import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  compileFlowConnectors,
  flowConnectorCrossings,
  flowConnectorDeleteAnchor,
  flowConnectorPathFromRoute,
  flowConnectorPointOnRoute,
  type FlowLayoutResult,
} from "../../model/flowLayout";
import type { TextWidthMeasurer } from "../../model/layout";
import type { FlowEdge, FlowPlacementDirection, FlowSpace } from "../../types/mindmap";

interface FlowEdgeLayerProps {
  layout: FlowLayoutResult;
  measureTextWidth?: TextWidthMeasurer;
  onChangeLabel: (edgeId: string, label: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onEndpointPointerDown: (
    edge: FlowEdge,
    endpoint: "from" | "to",
    movingPort: FlowPlacementDirection,
    fixedPort: FlowPlacementDirection,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void;
  onSelectEdge: (edgeId: string) => void;
  selectedEdgeId: string | null;
  space: FlowSpace;
  spaceId: string;
}

export const FlowEdgeLayer = memo(function FlowEdgeLayer({
  layout,
  measureTextWidth,
  onChangeLabel,
  onDeleteEdge,
  onEndpointPointerDown,
  onSelectEdge,
  selectedEdgeId,
  space,
  spaceId,
}: FlowEdgeLayerProps) {
  const edges = space.edges;
  const editorRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const editFinishedByKeyRef = useRef(false);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const obstacleNodes = useMemo(() => Object.values(layout.nodes), [layout.nodes]);
  const routes = useMemo(() => {
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    return compileFlowConnectors(space, layout, measureTextWidth).flatMap((route) => {
      const edge = edgeById.get(route.edgeId);
      return edge ? [{ edge, ...route }] : [];
    });
  }, [edges, layout, measureTextWidth, space]);
  const crossings = useMemo(
    () => flowConnectorCrossings(routes),
    [routes],
  );
  const routeByEdgeId = useMemo(
    () => new Map(routes.map(({ edge, route }) => [edge.id, route])),
    [routes],
  );

  useEffect(() => {
    if (!editingEdgeId) return;
    editFinishedByKeyRef.current = false;
    editorRef.current?.focus({ preventScroll: true });
    editorRef.current?.select();
  }, [editingEdgeId]);

  useEffect(() => {
    if (editingEdgeId && !edges.some((edge) => edge.id === editingEdgeId)) {
      setEditingEdgeId(null);
      setDraft("");
    }
  }, [edges, editingEdgeId]);

  const beginEdit = (edge: FlowEdge) => {
    editFinishedByKeyRef.current = false;
    setEditingEdgeId(edge.id);
    setDraft(edge.label);
  };

  const finishEdit = () => {
    setEditingEdgeId(null);
    setDraft("");
  };

  return (
    <>
      <svg
        aria-label="流程连线"
        className="flow-connectors"
        height={layout.height}
        style={{ left: layout.minX, top: layout.minY }}
        viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
        width={layout.width}
      >
        <defs>
          <marker
            id={`flow-arrow-${spaceId}`}
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
          >
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = layout.nodes[edge.from];
          const to = layout.nodes[edge.to];
          if (!from || !to) return null;
          const route = routeByEdgeId.get(edge.id);
          if (!route) return null;
          const path = flowConnectorPathFromRoute(
            route,
            crossings[edge.id],
          );
          return (
            <g key={edge.id}>
              <path
                className={`flow-connector${selectedEdgeId === edge.id ? " is-selected" : ""}`}
                d={path}
                markerEnd={
                  selectedEdgeId === edge.id
                    ? undefined
                    : `url(#flow-arrow-${spaceId})`
                }
              />
              <path
                className="flow-connector__hit"
                d={flowConnectorPathFromRoute(
                  route,
                  crossings[edge.id],
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge(edge.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge(edge.id);
                  beginEdit(edge);
                }}
              />
            </g>
          );
        })}
      </svg>

      {selectedEdgeId && (() => {
          const edge = edges.find((candidate) => candidate.id === selectedEdgeId);
          const route = routeByEdgeId.get(selectedEdgeId);
          if (!edge || !route) return null;
          return (
            <svg
              aria-label="连线端点"
              className="flow-edge-handle-layer"
              height={layout.height}
              style={{ left: layout.minX, top: layout.minY }}
              viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
              width={layout.width}
            >
              <g className="flow-edge-handles">
                <circle
                  aria-label="拖动连线起点"
                  className="flow-edge-handle flow-edge-handle--from"
                  cx={route.start.x}
                  cy={route.start.y}
                  data-flow-edge-endpoint="from"
                  data-flow-edge-id={edge.id}
                  onPointerDown={(event) => onEndpointPointerDown(
                    edge,
                    "from",
                    route.fromPort,
                    route.toPort,
                    event,
                  )}
                  r="6"
                  role="button"
                  tabIndex={0}
                />
                <circle
                  aria-hidden="true"
                  className="flow-edge-handle__core"
                  cx={route.start.x}
                  cy={route.start.y}
                  r="2.4"
                />
                <circle
                  aria-label="拖动连线终点"
                  className="flow-edge-handle flow-edge-handle--to"
                  cx={route.end.x}
                  cy={route.end.y}
                  data-flow-edge-endpoint="to"
                  data-flow-edge-id={edge.id}
                  onPointerDown={(event) => onEndpointPointerDown(
                    edge,
                    "to",
                    route.toPort,
                    route.fromPort,
                    event,
                  )}
                  r="6"
                  role="button"
                  tabIndex={0}
                />
                <circle
                  aria-hidden="true"
                  className="flow-edge-handle__core"
                  cx={route.end.x}
                  cy={route.end.y}
                  r="2.4"
                />
              </g>
            </svg>
          );
        })()}

      {selectedEdgeId && (() => {
        const route = routeByEdgeId.get(selectedEdgeId);
        if (!route) return null;
        const point = flowConnectorDeleteAnchor(route, obstacleNodes);
        return (
          <button
            aria-label="删除连线"
            className="flow-edge-delete"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteEdge(selectedEdgeId);
            }}
            style={{ left: point.x, top: point.y }}
            title="删除连线（Delete）"
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        );
      })()}

      {edges.map((edge) => {
        const from = layout.nodes[edge.from];
        const to = layout.nodes[edge.to];
        if (!from || !to || (!edge.label && editingEdgeId !== edge.id)) {
          return null;
        }
        const route = routeByEdgeId.get(edge.id);
        if (!route) return null;
        const point = flowConnectorPointOnRoute(route, 0.34);
        return editingEdgeId === edge.id ? (
          <input
            aria-label="编辑分支名称"
            className="flow-edge-label flow-edge-label__editor"
            key={edge.id}
            onBlur={(event) => {
              if (!composingRef.current && !editFinishedByKeyRef.current) {
                onChangeLabel(edge.id, event.currentTarget.value);
                finishEdit();
              }
            }}
            onChange={(event) => {
              if (!composingRef.current) setDraft(event.target.value);
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              setDraft(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (composingRef.current || event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                editFinishedByKeyRef.current = true;
                onChangeLabel(edge.id, event.currentTarget.value);
                finishEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                editFinishedByKeyRef.current = true;
                finishEdit();
              }
            }}
            ref={editorRef}
            style={{ left: point.x, top: point.y }}
            value={draft}
          />
        ) : (
          <button
            aria-label={`编辑分支名称：${edge.label}`}
            className="flow-edge-label"
            key={edge.id}
            onClick={() => beginEdit(edge)}
            style={{ left: point.x, top: point.y }}
            title="编辑分支名称"
            type="button"
          >
            {edge.label}
          </button>
        );
      })}
    </>
  );
});
