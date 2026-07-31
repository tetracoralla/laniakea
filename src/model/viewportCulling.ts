import type {
  LayoutResult,
  Viewport,
} from "../types/mindmap";

export interface ViewportSize {
  width: number;
  height: number;
}

export function visibleLayoutNodeIds(
  layout: LayoutResult,
  viewport: Viewport,
  viewportSize: ViewportSize,
  pinnedIds: ReadonlySet<string> = new Set(),
  overscan = 480,
): string[] {
  if (viewportSize.width <= 0 || viewportSize.height <= 0) {
    return layout.visibleIds;
  }

  const zoom = Math.max(viewport.zoom, 0.01);
  const left = (-viewport.x - overscan) / zoom;
  const top = (-viewport.y - overscan) / zoom;
  const right =
    (viewportSize.width - viewport.x + overscan) / zoom;
  const bottom =
    (viewportSize.height - viewport.y + overscan) / zoom;

  return layout.visibleIds.filter((id) => {
    if (pinnedIds.has(id)) return true;
    const node = layout.nodes[id];
    return (
      node.x + node.width >= left &&
      node.x <= right &&
      node.y + node.height >= top &&
      node.y <= bottom
    );
  });
}
