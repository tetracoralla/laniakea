import type {
  LayoutResult,
  Viewport,
} from "../types/mindmap";

export interface ViewportSize {
  width: number;
  height: number;
}

export function shareStableVisibleIds(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  if (
    previous.length === next.length &&
    previous.every((id, index) => id === next[index])
  ) {
    return previous;
  }
  return next;
}

export function viewportOverscan(viewportSize: ViewportSize): number {
  // One short viewport dimension already leaves a generous compositor-only
  // pan buffer. Using the long dimension on wide windows keeps thousands of
  // extra rows mounted at low zoom with no corresponding interaction benefit.
  return Math.max(480, Math.min(viewportSize.width, viewportSize.height));
}

function visibleContentBounds(
  viewport: Viewport,
  viewportSize: ViewportSize,
) {
  const zoom = Math.max(viewport.zoom, 0.01);
  return {
    left: -viewport.x / zoom,
    top: -viewport.y / zoom,
    right: (viewportSize.width - viewport.x) / zoom,
    bottom: (viewportSize.height - viewport.y) / zoom,
  };
}

/**
 * The mounted node window already extends beyond the visible viewport. Keep
 * using it while the live viewport remains inside that safe region so panning
 * can stay compositor-only instead of committing React work every frame.
 */
export function viewportNeedsRenderWindowRefresh(
  renderedViewport: Viewport,
  liveViewport: Viewport,
  viewportSize: ViewportSize,
  overscan = viewportOverscan(viewportSize),
): boolean {
  if (viewportSize.width <= 0 || viewportSize.height <= 0) return true;

  const renderedZoom = Math.max(renderedViewport.zoom, 0.01);
  const liveZoom = Math.max(liveViewport.zoom, 0.01);
  // Zooming in makes the visible content window smaller, so it can remain
  // inside the old overscan forever. Refresh after a material scale change to
  // release thousands of now-offscreen nodes instead of keeping an overview
  // render mounted throughout readable-zoom interaction.
  if (liveZoom / renderedZoom >= 1.35) return true;
  const refreshMargin = overscan / 2;
  const safeBounds = {
    left:
      (-renderedViewport.x - overscan + refreshMargin) /
      renderedZoom,
    top:
      (-renderedViewport.y - overscan + refreshMargin) /
      renderedZoom,
    right:
      (viewportSize.width -
        renderedViewport.x +
        overscan -
        refreshMargin) /
      renderedZoom,
    bottom:
      (viewportSize.height -
        renderedViewport.y +
        overscan -
        refreshMargin) /
      renderedZoom,
  };
  const liveBounds = visibleContentBounds(liveViewport, viewportSize);

  return (
    liveBounds.left < safeBounds.left ||
    liveBounds.top < safeBounds.top ||
    liveBounds.right > safeBounds.right ||
    liveBounds.bottom > safeBounds.bottom
  );
}

export function visibleLayoutNodeIds(
  layout: LayoutResult,
  viewport: Viewport,
  viewportSize: ViewportSize,
  pinnedIds: ReadonlySet<string> = new Set(),
  overscan = viewportOverscan(viewportSize),
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
