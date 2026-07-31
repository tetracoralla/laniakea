import { memo } from "react";
import { connectorPath } from "../../model/layout";
import type {
  LayoutNode,
  LayoutResult,
  MindMapDocument,
} from "../../types/mindmap";

interface ConnectorsProps {
  document: MindMapDocument;
  layout: LayoutResult;
  renderedIds: readonly string[];
}

const ConnectorPath = memo(function ConnectorPath({
  parent,
  child,
}: {
  parent: LayoutNode;
  child: LayoutNode;
}) {
  return (
    <path
      className={`connector connector--${child.tone}`}
      d={connectorPath(parent, child)}
    />
  );
});

export const Connectors = memo(function Connectors({
  document,
  layout,
  renderedIds,
}: ConnectorsProps) {
  return (
    <svg
      aria-hidden="true"
      className="connectors"
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
    >
      {renderedIds.map((id) => {
        const child = document.nodes[id];
        if (!child?.parentId) return null;
        const parentLayout = layout.nodes[child.parentId];
        const childLayout = layout.nodes[id];
        if (!parentLayout || !childLayout) return null;
        return (
          <ConnectorPath
            child={childLayout}
            key={`${child.parentId}-${id}`}
            parent={parentLayout}
          />
        );
      })}
    </svg>
  );
});
