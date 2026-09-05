import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  compileFlowConnectors,
  flowConnectorPathFromRoute,
  flowConnectorPointOnRoute,
  type CompiledFlowConnector,
  type FlowLayoutResult,
} from "../../model/flowLayout";
import type { TextWidthMeasurer } from "../../model/layout";
import type {
  FlowConnectorEndpoint,
  FlowEdge,
  FlowEdgeRouteOverride,
  FlowEdgeStyle,
  FlowPlacementDirection,
  FlowSpace,
} from "../../types/mindmap";
import {
  isInputMethodKey,
  markInputMethodComposition,
} from "../../model/inputMethod";
import { useFlowEdgeRouteDrag } from "../../hooks/useFlowEdgeRouteDrag";
import { EDGE_TONES } from "../../styles/tokens";
import { FlowEdgeSelectionControls } from "./FlowEdgeSelectionControls";

interface FlowEdgeLayerProps {
  connectors: readonly CompiledFlowConnector[];
  edges: FlowSpace["edges"];
  edgeRoutes?: FlowSpace["edgeRoutes"];
  layout: FlowLayoutResult;
  measureTextWidth?: TextWidthMeasurer;
  nodes: FlowSpace["nodes"];
  onChangeLabel: (edgeId: string, label: string) => void;
  onChangeRoute: (edgeId: string, route: FlowEdgeRouteOverride | null) => void;
  onChangeStyle: (edgeId: string, patch: Partial<FlowEdgeStyle>) => void;
  onClearSelection: () => void;
  onDeleteEdge: (edgeId: string) => void;
  onDraftChange?: (edgeId: string, value: string) => void;
  onDraftFinish?: (cancelled: boolean) => void;
  onEndpointPointerDown: (
    edge: FlowEdge,
    endpoint: "from" | "to",
    movingPort: FlowPlacementDirection,
    fixedPort: FlowPlacementDirection,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => void;
  onEndpointKeyboardActivate: (
    edge: FlowEdge,
    endpoint: "from" | "to",
    movingPort: FlowPlacementDirection,
    returnFocus: SVGCircleElement,
  ) => void;
  onSelectEdge: (edgeId: string, restoreCanvasFocus?: boolean) => void;
  selectedEdgeId: string | null;
  spaceId: string;
  zoom: number;
}

function edgeStroke(edge: FlowEdge, selected: boolean): string {
  if (selected) return "var(--violet)";
  if (edge.style?.tone === "violet") return "var(--violet)";
  if (edge.style?.tone === "blue") return EDGE_TONES.blue;
  if (edge.style?.tone === "emerald") return EDGE_TONES.emerald;
  if (edge.style?.tone === "amber") return EDGE_TONES.amber;
  return "color-mix(in srgb, var(--violet) 42%, var(--muted-soft))";
}

function edgeWeight(edge: FlowEdge): string {
  if (edge.style?.weight === "thin") return "1.4px";
  if (edge.style?.weight === "bold") return "3px";
  return "2px";
}

function edgeDash(edge: FlowEdge): string {
  if (edge.style?.dash === "dashed") return "9 6";
  if (edge.style?.dash === "dotted") return "1 6";
  return "none";
}

function EndpointMarker({
  color,
  endpoint,
  id,
}: {
  color: string;
  endpoint: FlowConnectorEndpoint;
  id: string;
}) {
  if (endpoint === "none") return null;
  return (
    <marker
      id={id}
      markerHeight="10"
      markerUnits="userSpaceOnUse"
      markerWidth="10"
      orient="auto-start-reverse"
      refX={endpoint === "arrow" ? 8 : 5}
      refY="5"
      viewBox="0 0 10 10"
    >
      {endpoint === "arrow" ? (
        <path d="M1,1 L9,5 L1,9 Z" style={{ fill: color }} />
      ) : (
        <circle
          cx="5"
          cy="5"
          r={endpoint === "ring" ? 3.25 : 3}
          style={{
            fill: endpoint === "ring" ? "var(--surface)" : color,
            stroke: color,
            strokeWidth: endpoint === "ring" ? 1.5 : 0,
          }}
        />
      )}
    </marker>
  );
}

export const FlowEdgeLayer = memo(function FlowEdgeLayer({
  connectors,
  edges,
  edgeRoutes,
  layout,
  measureTextWidth,
  nodes,
  onChangeLabel,
  onChangeRoute,
  onChangeStyle,
  onClearSelection,
  onDeleteEdge,
  onDraftChange = () => undefined,
  onDraftFinish = () => undefined,
  onEndpointPointerDown,
  onEndpointKeyboardActivate,
  onSelectEdge,
  selectedEdgeId,
  spaceId,
  zoom,
}: FlowEdgeLayerProps) {
  const editorRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const commitAfterCompositionRef = useRef(false);
  const editFinishedByKeyRef = useRef(false);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const routeDrag = useFlowEdgeRouteDrag({
    onChange: onChangeRoute,
    scopeKey: spaceId,
    zoom,
  });
  const renderedEdgeRoutes = useMemo(() => routeDrag.preview
    ? {
        ...edgeRoutes,
        [routeDrag.preview.edgeId]: routeDrag.preview.route,
      }
    : edgeRoutes, [edgeRoutes, routeDrag.preview]);
  const routes = useMemo(() => {
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    const compiled = routeDrag.preview
      ? compileFlowConnectors({
          edges,
          edgeRoutes: renderedEdgeRoutes,
          nodes,
        }, layout, measureTextWidth)
      : connectors;
    return compiled.flatMap((route) => {
      const edge = edgeById.get(route.edgeId);
      return edge ? [{ edge, ...route }] : [];
    });
  }, [connectors, edges, layout, measureTextWidth, nodes, renderedEdgeRoutes, routeDrag.preview]);
  const routeByEdgeId = useMemo(
    () => new Map(routes.map(({ edge, route }) => [edge.id, route])),
    [routes],
  );
  const selectedEdge = selectedEdgeId
    ? edges.find((candidate) => candidate.id === selectedEdgeId)
    : undefined;
  const selectedRoute = selectedEdge
    ? routeByEdgeId.get(selectedEdge.id)
    : undefined;

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

  useEffect(() => {
    if (routeDrag.preview &&
        !edges.some((edge) => edge.id === routeDrag.preview?.edgeId)) {
      routeDrag.cancel();
    }
  }, [edges, routeDrag.cancel, routeDrag.preview]);

  const beginEdit = (edge: FlowEdge) => {
    editFinishedByKeyRef.current = false;
    setEditingEdgeId(edge.id);
    setDraft(edge.label);
  };

  const finishEdit = (cancelled: boolean) => {
    setEditingEdgeId(null);
    setDraft("");
    onDraftFinish(cancelled);
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
          {edges.flatMap((edge) => {
            const selected = selectedEdgeId === edge.id;
            const color = edgeStroke(edge, selected);
            const sourceEndpoint = edge.style?.sourceEndpoint ?? "none";
            const targetEndpoint = edge.style?.targetEndpoint ?? "arrow";
            return [
              <EndpointMarker
                color={color}
                endpoint={sourceEndpoint}
                id={`flow-edge-source-${spaceId}-${edge.id}`}
                key={`${edge.id}-source`}
              />,
              <EndpointMarker
                color={color}
                endpoint={targetEndpoint}
                id={`flow-edge-target-${spaceId}-${edge.id}`}
                key={`${edge.id}-target`}
              />,
            ];
          })}
        </defs>
        {edges.map((edge) => {
          const from = layout.nodes[edge.from];
          const to = layout.nodes[edge.to];
          if (!from || !to) return null;
          const route = routeByEdgeId.get(edge.id);
          if (!route) return null;
          const path = flowConnectorPathFromRoute(
            route,
            route.jumps,
            edge.style?.kind ?? "rounded",
          );
          const sourceEndpoint = edge.style?.sourceEndpoint ?? "none";
          const targetEndpoint = edge.style?.targetEndpoint ?? "arrow";
          const pathStyle = {
            "--flow-edge-color": edgeStroke(edge, selectedEdgeId === edge.id),
            "--flow-edge-dash": edgeDash(edge),
            "--flow-edge-width": edgeWeight(edge),
          } as CSSProperties;
          return (
            <g key={edge.id}>
              <path
                className={`flow-connector${selectedEdgeId === edge.id ? " is-selected" : ""}`}
                d={path}
                markerEnd={targetEndpoint === "none"
                  ? undefined
                  : `url(#flow-edge-target-${spaceId}-${edge.id})`}
                markerStart={sourceEndpoint === "none"
                  ? undefined
                  : `url(#flow-edge-source-${spaceId}-${edge.id})`}
                style={pathStyle}
              />
              <path
                aria-label={`选择连线：${nodes[edge.from]?.text || "未命名步骤"} 到 ${nodes[edge.to]?.text || "未命名步骤"}`}
                aria-pressed={selectedEdgeId === edge.id}
                className="flow-connector__hit"
                d={flowConnectorPathFromRoute(
                  route,
                  route.jumps,
                  edge.style?.kind ?? "rounded",
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
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectEdge(edge.id, false);
                }}
                role="button"
                strokeWidth={16 / zoom}
                tabIndex={0}
              />
            </g>
          );
        })}
      </svg>

      {selectedEdge && selectedRoute && (
        <FlowEdgeSelectionControls
          edge={selectedEdge}
          layout={layout}
          onBeginEdit={() => beginEdit(selectedEdge)}
          onChangeRoute={(route) => onChangeRoute(selectedEdge.id, route)}
          onChangeStyle={(patch) => onChangeStyle(selectedEdge.id, patch)}
          onClearSelection={onClearSelection}
          onDelete={() => onDeleteEdge(selectedEdge.id)}
          onEndpointKeyboardActivate={onEndpointKeyboardActivate}
          onEndpointPointerDown={onEndpointPointerDown}
          route={selectedRoute}
          routeDrag={routeDrag}
          routeOverride={edgeRoutes?.[selectedEdge.id]}
          zoom={zoom}
        />
      )}

      {edges.map((edge) => {
        const from = layout.nodes[edge.from];
        const to = layout.nodes[edge.to];
        if (!from || !to || (!edge.label && editingEdgeId !== edge.id)) {
          return null;
        }
        const route = routeByEdgeId.get(edge.id);
        if (!route) return null;
        const point = flowConnectorPointOnRoute(
          route,
          0.34,
          edge.style?.kind ?? "rounded",
        );
        return editingEdgeId === edge.id ? (
          <input
            aria-label="编辑分支名称"
            className="flow-edge-label flow-edge-label__editor"
            key={edge.id}
            onBlur={(event) => {
              if (composingRef.current) {
                commitAfterCompositionRef.current = true;
                return;
              }
              if (editFinishedByKeyRef.current) return;
              onChangeLabel(edge.id, event.currentTarget.value);
              finishEdit(false);
            }}
            onChange={(event) => {
              if (!composingRef.current) {
                setDraft(event.target.value);
                onDraftChange(edge.id, event.target.value);
              }
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              markInputMethodComposition(event.currentTarget, false);
              setDraft(event.currentTarget.value);
              onDraftChange(edge.id, event.currentTarget.value);
              if (commitAfterCompositionRef.current) {
                commitAfterCompositionRef.current = false;
                onChangeLabel(edge.id, event.currentTarget.value);
                finishEdit(false);
              }
            }}
            onCompositionStart={(event) => {
              composingRef.current = true;
              commitAfterCompositionRef.current = false;
              markInputMethodComposition(event.currentTarget, true);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (isInputMethodKey(event.nativeEvent, composingRef.current)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                editFinishedByKeyRef.current = true;
                onChangeLabel(edge.id, event.currentTarget.value);
                finishEdit(false);
              } else if (event.key === "Escape") {
                event.preventDefault();
                editFinishedByKeyRef.current = true;
                finishEdit(true);
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
