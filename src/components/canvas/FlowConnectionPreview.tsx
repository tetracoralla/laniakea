import { flowPreviewConnectorPath } from "../../model/flowLayout";
import type { FlowPlacementDirection } from "../../types/mindmap";

interface FlowConnectionPreviewProps {
  end: { x: number; y: number };
  fromPort: FlowPlacementDirection;
  spaceId: string;
  start: { x: number; y: number };
  toPort?: FlowPlacementDirection | null;
}

export function FlowConnectionPreview({
  end,
  fromPort,
  spaceId,
  start,
  toPort,
}: FlowConnectionPreviewProps) {
  const markerId = `flow-preview-arrow-${spaceId}`;
  return (
    <svg
      aria-hidden="true"
      className="flow-connection-preview"
      height="100%"
      width="100%"
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
      <path
        className="flow-connection-preview__path"
        d={flowPreviewConnectorPath(start, end, fromPort, toPort ?? undefined)}
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  );
}
