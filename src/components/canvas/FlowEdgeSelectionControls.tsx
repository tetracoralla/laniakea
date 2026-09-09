import { useLocale } from "../../i18n/useLocale";
import { t } from "../../i18n/locale";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FlowEdgeRouteDragController } from "../../hooks/useFlowEdgeRouteDrag";
import {
  flowConnectorToolbarAnchor,
  flowRouteAdjustmentHandle,
  type FlowConnectorRoute,
  type FlowLayoutResult,
  type FlowObstacleBounds,
} from "../../model/flowLayout";
import type {
  FlowEdge,
  FlowEdgeRouteOverride,
  FlowEdgeStyle,
  FlowPlacementDirection,
} from "../../types/mindmap";
import { FlowEdgeToolbar } from "./FlowEdgeToolbar";

interface FlowEdgeSelectionControlsProps {
  edge: FlowEdge;
  layout: FlowLayoutResult;
  labelBounds?: readonly FlowObstacleBounds[];
  onBeginEdit: () => void;
  onChangeRoute: (route: FlowEdgeRouteOverride | null) => void;
  onChangeStyle: (patch: Partial<FlowEdgeStyle>) => void;
  onClearSelection: () => void;
  onDelete: () => void;
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
  route: FlowConnectorRoute;
  routeDrag: FlowEdgeRouteDragController;
  routeOverride?: FlowEdgeRouteOverride;
  zoom: number;
}

export function FlowEdgeSelectionControls({
  edge,
  layout,
  labelBounds = [],
  onBeginEdit,
  onChangeRoute,
  onChangeStyle,
  onClearSelection,
  onDelete,
  onEndpointPointerDown,
  onEndpointKeyboardActivate,
  route,
  routeDrag,
  routeOverride,
  zoom,
}: FlowEdgeSelectionControlsProps) {
  useLocale();
  const endpointHitRadius = 10 / zoom;
  const endpointCoreRadius = 3 / zoom;
  const routeHitRadius = 11 / zoom;
  const routeCoreRadius = 3 / zoom;
  const adjustment = (edge.style?.kind ?? "rounded") !== "straight" &&
      (edge.style?.kind ?? "rounded") !== "curved"
    ? flowRouteAdjustmentHandle(route, routeOverride)
    : null;
  const toolbarAnchor = flowConnectorToolbarAnchor(
    route,
    [...Object.values(layout.nodes), ...labelBounds],
    zoom,
    edge.style?.kind ?? "rounded",
  );

  return (
    <>
      <svg
        aria-label={t("连线端点")}
        className="flow-edge-handle-layer"
        height={layout.height}
        style={{ left: layout.minX, top: layout.minY }}
        viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
        width={layout.width}
      >
        <g className="flow-edge-handles">
          <circle
            aria-label={t("重连连线起点")}
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
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onEndpointKeyboardActivate(
                edge,
                "from",
                route.fromPort,
                event.currentTarget,
              );
            }}
            r={endpointHitRadius}
            role="button"
            tabIndex={0}
          />
          <circle
            aria-hidden="true"
            className="flow-edge-handle__core"
            cx={route.start.x}
            cy={route.start.y}
            r={endpointCoreRadius}
          />
          <circle
            aria-label={t("重连连线终点")}
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
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onEndpointKeyboardActivate(
                edge,
                "to",
                route.toPort,
                event.currentTarget,
              );
            }}
            r={endpointHitRadius}
            role="button"
            tabIndex={0}
          />
          <circle
            aria-hidden="true"
            className="flow-edge-handle__core"
            cx={route.end.x}
            cy={route.end.y}
            r={endpointCoreRadius}
          />
          {adjustment && (
            <>
              <circle
                aria-label={adjustment.axis === "y"
                  ? t("上下拖动调整连线位置")
                  : t("左右拖动调整连线位置")}
                className={`flow-edge-route-handle flow-edge-route-handle--${adjustment.axis}`}
                cx={adjustment.x}
                cy={adjustment.y}
                onKeyDown={(event) => {
                  const delta = event.shiftKey ? 1 : 12;
                  const direction = adjustment.axis === "x"
                    ? event.key === "ArrowLeft" ? -delta
                      : event.key === "ArrowRight" ? delta : 0
                    : event.key === "ArrowUp" ? -delta
                      : event.key === "ArrowDown" ? delta : 0;
                  if (!direction) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onChangeRoute({
                    axis: adjustment.axis,
                    coordinate: adjustment.coordinate + direction,
                  });
                }}
                onDoubleClick={(event) => { event.stopPropagation(); routeDrag.cancel(); onBeginEdit(); }}
                onLostPointerCapture={routeDrag.lostPointerCapture}
                onPointerCancel={routeDrag.pointerCancel}
                onPointerDown={(event) => routeDrag.begin(
                  edge.id,
                  route,
                  event,
                  routeOverride,
                )}
                onPointerMove={routeDrag.pointerMove}
                onPointerUp={routeDrag.pointerUp}
                r={routeHitRadius}
                role="button"
                tabIndex={0}
              />
              <circle
                aria-hidden="true"
                className="flow-edge-route-handle__core"
                cx={adjustment.x}
                cy={adjustment.y}
                r={routeCoreRadius}
              />
            </>
          )}
        </g>
      </svg>
      <FlowEdgeToolbar
        anchor={toolbarAnchor}
        edge={edge}
        hasManualRoute={Boolean(routeOverride)}
        onBeginLabel={onBeginEdit}
        onChangeStyle={onChangeStyle}
        onDelete={onDelete}
        onDeselect={onClearSelection}
        onResetRoute={() => onChangeRoute(null)}
      />
    </>
  );
}
