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
  renderedPortalAnchorIds?: readonly string[];
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
  renderedPortalAnchorIds = [],
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
      {renderedPortalAnchorIds.map((anchorId) => {
        const parent = layout.nodes[anchorId];
        const portal = layout.portals?.[anchorId];
        if (!parent || !portal) return null;
        return (
          <ConnectorPath
            child={portal}
            key={`${anchorId}-subspace`}
            parent={parent}
          />
        );
      })}
    </svg>
  );
});
