import type {
  LayoutNode,
  LayoutResult,
  MindMapDocument,
  Viewport,
} from "../types/mindmap";
import type { CanvasPoint } from "./marquee";

export const attachedNodeDetachTravel = 96;
export const nodeDropForwardReach = 96;
export const shallowNodeDropForwardReach = 132;
export const nodeDropVerticalReach = 56;
export const shallowNodeDropVerticalReach = 72;
export const nodeDropOverlapAllowance = 6;
export const nodeDropInvalidSubtreeRadius = 16;
export const nodeDropSpatialBucketSize = 256;

export interface CanvasBounds {
  left: number;
  top: number;
}

export function clientPointToCanvas(
  clientX: number,
  clientY: number,
  bounds: CanvasBounds,
  viewport: Viewport,
): CanvasPoint {
  return {
    x: (clientX - bounds.left - viewport.x) / viewport.zoom,
    y: (clientY - bounds.top - viewport.y) / viewport.zoom,
  };
}

export interface NodeDropHit {
  blockedByDraggedSubtree: boolean;
  targetId: string | null;
}

export interface NodeDropProbe {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface NodeDropSpatialIndex {
  bucketSize: number;
  buckets: Map<number, number[]>;
  visibleIds: readonly string[];
}

export function buildNodeDropSpatialIndex(
  layout: LayoutResult,
  bucketSize = nodeDropSpatialBucketSize,
): NodeDropSpatialIndex {
  const buckets = new Map<number, number[]>();
  layout.visibleIds.forEach((id, visibleIndex) => {
    const node = layout.nodes[id];
    if (!node) return;
    const firstBucket = Math.floor(node.y / bucketSize);
    const lastBucket = Math.floor((node.y + node.height) / bucketSize);
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const entries = buckets.get(bucket);
      if (entries) entries.push(visibleIndex);
      else buckets.set(bucket, [visibleIndex]);
    }
  });
  return { bucketSize, buckets, visibleIds: layout.visibleIds };
}

export function nodeDropCandidateIds(
  index: NodeDropSpatialIndex,
  probe: NodeDropProbe,
  screenToCanvasScale = 1,
): string[] {
  const reach = shallowNodeDropVerticalReach * screenToCanvasScale;
  const firstBucket = Math.floor((probe.y - reach) / index.bucketSize);
  const lastBucket = Math.floor(
    (probe.y + probe.height + reach) / index.bucketSize,
  );
  const visibleIndexes = new Set<number>();
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
    index.buckets.get(bucket)?.forEach((visibleIndex) => {
      visibleIndexes.add(visibleIndex);
    });
  }
  return [...visibleIndexes]
    .sort((left, right) => left - right)
    .map((visibleIndex) => index.visibleIds[visibleIndex])
    .filter((id): id is string => Boolean(id));
}

/**
 * Resolves the ordered child slot represented by the dragged node's vertical
 * position. The dragged branch is removed from the comparison first so the
 * same calculation works for both reparenting and same-parent reordering.
 */
export function childInsertionPosition(
  document: MindMapDocument,
  layout: LayoutResult,
  parentId: string,
  draggedId: string,
  probe: NodeDropProbe,
): number {
  const parent = document.nodes[parentId];
  if (!parent) return 0;
  const siblings = parent.children.filter((id) => id !== draggedId);
  const visibleSiblings = siblings
    .map((id) => layout.nodes[id])
    .filter((node): node is LayoutNode => Boolean(node));
  const probeCenterY = probe.y + probe.height / 2;

  if (visibleSiblings.length === 0) {
    return 0;
  }

  for (let index = 0; index < visibleSiblings.length; index += 1) {
    const sibling = visibleSiblings[index];
    if (probeCenterY < sibling.y + sibling.height / 2) {
      return index;
    }
  }
  return siblings.length;
}

function axisGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  return Math.max(
    secondStart - firstEnd,
    firstStart - secondEnd,
    0,
  );
}

function squaredDistanceBetweenRects(
  probe: NodeDropProbe,
  node: LayoutResult["nodes"][string],
): number {
  const gapX = axisGap(
    probe.x,
    probe.x + probe.width,
    node.x,
    node.x + node.width,
  );
  const gapY = axisGap(
    probe.y,
    probe.y + probe.height,
    node.y,
    node.y + node.height,
  );
  return gapX * gapX + gapY * gapY;
}

function squaredCenterDistance(
  probe: NodeDropProbe,
  node: LayoutResult["nodes"][string],
): number {
  const deltaX =
    probe.x + probe.width / 2 - (node.x + node.width / 2);
  const deltaY =
    probe.y + probe.height / 2 - (node.y + node.height / 2);
  return deltaX * deltaX + deltaY * deltaY;
}

/**
 * Finds the closest node inside a canvas-space magnetic radius. The dragged
 * subtree participates in the nearest-node decision so a nearby descendant
 * blocks the drop instead of allowing an accidental detach behind it.
 */
export function nodeDropHitTest(
  layout: LayoutResult,
  point: CanvasPoint,
  excludedIds: ReadonlySet<string> = new Set(),
  radius = 0,
): NodeDropHit {
  return nodeDropHitTestForRect(
    layout,
    { x: point.x, y: point.y, width: 0, height: 0 },
    excludedIds,
    radius,
  );
}

export function nodeDropHitTestForRect(
  layout: LayoutResult,
  probe: NodeDropProbe,
  excludedIds: ReadonlySet<string> = new Set(),
  radius = 0,
): NodeDropHit {
  let closestId: string | null = null;
  let closestSquaredDistance = Number.POSITIVE_INFINITY;
  let closestSquaredCenterDistance = Number.POSITIVE_INFINITY;
  const squaredRadius = radius * radius;
  for (let index = layout.visibleIds.length - 1; index >= 0; index -= 1) {
    const id = layout.visibleIds[index];
    const node = layout.nodes[id];
    if (!node) continue;
    const squaredDistance = squaredDistanceBetweenRects(probe, node);
    if (squaredDistance > squaredRadius) continue;
    const squaredDistanceToCenter = squaredCenterDistance(probe, node);
    if (
      squaredDistance > closestSquaredDistance ||
      (squaredDistance === closestSquaredDistance &&
        squaredDistanceToCenter >= closestSquaredCenterDistance)
    ) {
      continue;
    }
    closestId = id;
    closestSquaredDistance = squaredDistance;
    closestSquaredCenterDistance = squaredDistanceToCenter;
  }

  return closestId && excludedIds.has(closestId)
    ? { blockedByDraggedSubtree: true, targetId: null }
    : { blockedByDraggedSubtree: false, targetId: closestId };
}

/**
 * Finds a candidate parent only in the direction where an attached child will
 * actually be laid out. A dragged node behind or substantially overlapping a
 * candidate is intentionally ignored even if the two rectangles are close.
 */
export function nodeDropParentHitTest(
  layout: LayoutResult,
  probe: NodeDropProbe,
  excludedIds: ReadonlySet<string> = new Set(),
  screenToCanvasScale = 1,
  candidateIds: readonly string[] = layout.visibleIds,
): NodeDropHit {
  let closestId: string | null = null;
  let closestSquaredDistance = Number.POSITIVE_INFINITY;
  let closestSquaredCenterDistance = Number.POSITIVE_INFINITY;

  let blockedByDraggedSubtree = false;

  for (let index = candidateIds.length - 1; index >= 0; index -= 1) {
    const id = candidateIds[index];
    const node = layout.nodes[id];
    if (!node) continue;
    if (excludedIds.has(id)) {
      const radius = nodeDropInvalidSubtreeRadius * screenToCanvasScale;
      blockedByDraggedSubtree ||=
        squaredDistanceBetweenRects(probe, node) <= radius * radius;
      continue;
    }
    const shallow = node.depth <= 1;
    const forwardReach =
      (shallow
        ? shallowNodeDropForwardReach
        : nodeDropForwardReach) * screenToCanvasScale;
    const verticalReach =
      (shallow
        ? shallowNodeDropVerticalReach
        : nodeDropVerticalReach) * screenToCanvasScale;
    const forwardGap = probe.x - (node.x + node.width);
    const verticalGap = axisGap(
      probe.y,
      probe.y + probe.height,
      node.y,
      node.y + node.height,
    );
    if (
      forwardGap < -nodeDropOverlapAllowance * screenToCanvasScale ||
      forwardGap > forwardReach ||
      verticalGap > verticalReach
    ) {
      continue;
    }

    const squaredDistance =
      Math.max(0, forwardGap) ** 2 + verticalGap ** 2;
    const squaredDistanceToCenter = squaredCenterDistance(probe, node);
    if (
      squaredDistance > closestSquaredDistance ||
      (squaredDistance === closestSquaredDistance &&
        squaredDistanceToCenter >= closestSquaredCenterDistance)
    ) {
      continue;
    }
    closestId = id;
    closestSquaredDistance = squaredDistance;
    closestSquaredCenterDistance = squaredDistanceToCenter;
  }

  if (closestId) {
    return { blockedByDraggedSubtree: false, targetId: closestId };
  }

  return { blockedByDraggedSubtree, targetId: null };
}

export function layoutNodeAtPoint(
  layout: LayoutResult,
  point: CanvasPoint,
  excludedIds: ReadonlySet<string> = new Set(),
): string | null {
  return nodeDropHitTest(layout, point, excludedIds).targetId;
}

export function floatingPositionFromPointer(
  point: CanvasPoint,
  grabOffset: CanvasPoint,
): CanvasPoint {
  return {
    x: Math.max(32, Math.round(point.x - grabOffset.x)),
    y: Math.max(32, Math.round(point.y - grabOffset.y)),
  };
}

export function dragConnectorPath(
  parent: LayoutNode,
  preview: Pick<LayoutNode, "x" | "y" | "width" | "height">,
): string {
  const parentCenterX = parent.x + parent.width / 2;
  const previewCenterX = preview.x + preview.width / 2;
  const pointsRight = previewCenterX >= parentCenterX;
  const startX = pointsRight ? parent.x + parent.width : parent.x;
  const endX = pointsRight ? preview.x : preview.x + preview.width;
  const startY = parent.y + parent.height / 2;
  const endY = preview.y + preview.height / 2;
  const direction = pointsRight ? 1 : -1;
  const bend = Math.max(24, Math.abs(endX - startX) * 0.52);
  return `M ${startX} ${startY} C ${startX + direction * bend} ${startY}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`;
}
