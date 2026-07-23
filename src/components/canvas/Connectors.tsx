import { connectorPath } from "../../model/layout";
import type { LayoutResult, MindMapDocument } from "../../types/mindmap";

interface ConnectorsProps {
  document: MindMapDocument;
  layout: LayoutResult;
}

export function Connectors({ document, layout }: ConnectorsProps) {
  return (
    <svg
      aria-hidden="true"
      className="connectors"
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
    >
      {layout.visibleIds.flatMap((id) => {
        const parentLayout = layout.nodes[id];
        const parent = document.nodes[id];
        if (!parent || parent.collapsed) return [];

        return parent.children.map((childId) => {
          const childLayout = layout.nodes[childId];
          if (!childLayout) return null;
          return (
            <path
              className={`connector connector--${childLayout.tone}`}
              d={connectorPath(parentLayout, childLayout)}
              key={`${id}-${childId}`}
            />
          );
        });
      })}
    </svg>
  );
}
