import {
  compileFlowQuickCreateRoute,
  flowConnectorPathFromRoute,
  type FlowDirectionalPlacement,
  type FlowLayoutNode,
  type FlowLayoutResult,
} from "../../model/flowLayout";
import type { TextWidthMeasurer } from "../../model/layout";
import type { FlowPlacementDirection, FlowSpace } from "../../types/mindmap";

interface FlowQuickCreatePreviewProps {
  direction: FlowPlacementDirection;
  layout: FlowLayoutResult;
  measureTextWidth?: TextWidthMeasurer;
  placement: FlowDirectionalPlacement;
  source: FlowLayoutNode;
  space: Pick<FlowSpace, "nodes" | "edges" | "edgeRoutes">;
  spaceId: string;
}

export function FlowQuickCreatePreview({
  direction,
  layout,
  measureTextWidth,
  placement,
  source,
  space,
  spaceId,
}: FlowQuickCreatePreviewProps) {
  const route = compileFlowQuickCreateRoute(
    space,
    layout,
    source.id,
    direction,
    placement,
    measureTextWidth,
  );
  const markerId = `flow-quick-create-${spaceId}`;
  return (
    <>
      <svg
        aria-hidden="true"
        className="flow-quick-create-preview__connector"
        data-quick-create-preview="true"
        height={layout.height}
        style={{ left: layout.minX, top: layout.minY }}
        viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
        width={layout.width}
      >
        <defs>
          <marker
            id={markerId}
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
          >
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
        </defs>
        {route && (
          <path
            d={flowConnectorPathFromRoute(route)}
            markerEnd={`url(#${markerId})`}
          />
        )}
      </svg>
      <div
        aria-hidden="true"
        className="flow-quick-create-preview__node"
        style={{
          height: placement.height,
          left: placement.x,
          top: placement.y,
          width: placement.width,
        }}
      />
    </>
  );
}
