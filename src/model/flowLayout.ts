import type {
  FlowPlacementDirection,
  FlowSpace,
} from "../types/mindmap";
import {
  pointOnRoute as projectionPointOnRoute,
  roundedOrthogonalPath as projectionRoundedOrthogonalPath,
  routeCrossings as projectionRouteCrossings,
  routeOrthogonal as projectionRouteOrthogonal,
  type OrthogonalRoute,
  type Point as ProjectionPoint,
  type PortSide,
  type RouteJump,
} from "@openadam/graph-projection";
import { compileGraphView } from "@openadam/graph-projection/compiler";
import {
  estimateTextWidth,
  type NodeTextStyle,
  type TextWidthMeasurer,
} from "./layout";
import { flowSpaceToSemanticGraph } from "./flowGraphAdapter";

export interface FlowLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
}

export interface FlowLayoutResult {
  nodes: Record<string, FlowLayoutNode>;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export type FlowNavigationDirection = "up" | "down" | "left" | "right";

const stepNodeWidth = 196;
const stepNodeHeight = 54;
const stepContentWidth = 160;
const decisionNodeWidth = 172;
const decisionNodeHeight = 76;
const decisionContentWidth = 116;
const decisionVerticalInset = 24;
const terminalNodeWidth = 152;
const terminalNodeHeight = 46;
const columnGap = 72;
const rowGap = 92;
const canvasPadding = 140;
const flowLineHeight = 20;
const flowVerticalPadding = 20;
const emptyStepPlaceholder = "输入步骤";

const flowFontStyle: NodeTextStyle = {
  fontSize: 14,
  fontWeight: 570,
  letterSpacing: 0,
};

const flowEdgeLabelFontStyle: NodeTextStyle = {
  fontSize: 10,
  fontWeight: 570,
  letterSpacing: 0,
};

function measureLine(
  line: string,
  measureTextWidth?: TextWidthMeasurer,
): number {
  return measureTextWidth
    ? measureTextWidth(line, flowFontStyle)
    : estimateTextWidth(line, flowFontStyle);
}

function wrappedTextBlock(
  text: string,
  maxWidth: number,
  measureTextWidth?: TextWidthMeasurer,
): { width: number; height: number } {
  const visible = text.trim() ? text : emptyStepPlaceholder;
  const explicitLines = visible.split("\n");
  let longestLine = 0;
  const lineCount = explicitLines.reduce((total, line) => {
    const lineWidth = measureLine(line, measureTextWidth);
    longestLine = Math.max(longestLine, lineWidth);
    return total + Math.max(1, Math.ceil(lineWidth / maxWidth));
  }, 0);
  return {
    width: Math.min(maxWidth, Math.ceil(longestLine)),
    height: lineCount * flowLineHeight,
  };
}

export function flowNodeSize(
  kind: string,
  text: string,
  measureTextWidth?: TextWidthMeasurer,
): { width: number; height: number } {
  if (kind === "start" || kind === "end") {
    return { width: terminalNodeWidth, height: terminalNodeHeight };
  }
  if (kind !== "decision") {
    const block = wrappedTextBlock(text, stepContentWidth, measureTextWidth);
    return {
      width: stepNodeWidth,
      height: Math.max(
        stepNodeHeight,
        block.height + flowVerticalPadding,
      ),
    };
  }
  const block = wrappedTextBlock(
    text,
    decisionContentWidth,
    measureTextWidth,
  );
  const halfTextHeight = block.height / 2;
  const halfHeight = Math.max(
    decisionNodeHeight / 2,
    halfTextHeight + decisionVerticalInset,
  );
  const halfWidth = Math.max(
    decisionNodeWidth / 2,
    Math.ceil(
      (block.width / 2) * (halfHeight / (halfHeight - halfTextHeight)) + 8,
    ),
  );
  return { width: halfWidth * 2, height: Math.ceil(halfHeight * 2) };
}

export function computeFlowLayout(
  space: FlowSpace,
  measureTextWidth?: TextWidthMeasurer,
): FlowLayoutResult {
  const semanticGraph = flowSpaceToSemanticGraph(space);
  const ids = semanticGraph.nodes.map((node) => node.id);
  if (ids.length === 0) {
    return {
      nodes: {},
      minX: 0,
      minY: 0,
      width: canvasPadding * 2,
      height: canvasPadding * 2,
    };
  }
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  semanticGraph.relations.forEach((relation) => {
    if (!space.nodes[relation.source] || !space.nodes[relation.target]) return;
    incoming.set(relation.target, (incoming.get(relation.target) ?? 0) + 1);
    outgoing.get(relation.source)?.push(relation.target);
  });

  const roots = ids
    .filter((id) => incoming.get(id) === 0)
    .sort((left, right) =>
      Number(space.nodes[right].kind === "start") -
      Number(space.nodes[left].kind === "start"),
    );
  const levels = new Map<string, number>();
  const remainingIncoming = new Map(incoming);
  const queue = [...roots];
  queue.forEach((id) => levels.set(id, 0));
  const processed = new Set<string>();
  let cursor = 0;
  while (cursor < queue.length) {
    const currentId = queue[cursor];
    cursor += 1;
    processed.add(currentId);
    const nextLevel = (levels.get(currentId) ?? 0) + 1;
    outgoing.get(currentId)?.forEach((target) => {
      levels.set(target, Math.max(levels.get(target) ?? 0, nextLevel));
      const remaining = Math.max(0, (remainingIncoming.get(target) ?? 0) - 1);
      remainingIncoming.set(target, remaining);
      if (remaining === 0) queue.push(target);
    });
  }
  let fallbackLevel = 0;
  levels.forEach((level) => {
    fallbackLevel = Math.max(fallbackLevel, level + 1);
  });
  ids.forEach((id) => {
    if (processed.has(id)) return;
    const componentQueue = [id];
    const componentSeen = new Set([id]);
    levels.set(id, Math.max(levels.get(id) ?? 0, fallbackLevel));
    let componentCursor = 0;
    while (componentCursor < componentQueue.length) {
      const current = componentQueue[componentCursor++];
      processed.add(current);
      const nextLevel = (levels.get(current) ?? fallbackLevel) + 1;
      outgoing.get(current)?.forEach((target) => {
        if (processed.has(target) || componentSeen.has(target)) return;
        componentSeen.add(target);
        levels.set(target, nextLevel);
        componentQueue.push(target);
      });
    }
    fallbackLevel = Math.max(
      fallbackLevel + 1,
      ...componentQueue.map((nodeId) => (levels.get(nodeId) ?? 0) + 1),
    );
  });

  const grouped = new Map<number, string[]>();
  ids.forEach((id) => {
    const level = levels.get(id) ?? 0;
    const group = grouped.get(level) ?? [];
    group.push(id);
    grouped.set(level, group);
  });
  const orderedLevels = [...grouped.keys()].sort((left, right) => left - right);
  const sizes = new Map(
    ids.map((id) => [
      id,
      flowNodeSize(space.nodes[id].kind, space.nodes[id].text, measureTextWidth),
    ]),
  );
  const slotWidth = (id: string) =>
    Math.max(stepNodeWidth, sizes.get(id)?.width ?? stepNodeWidth);
  const maximumRowWidth = orderedLevels.reduce((maximum, level) => {
      const group = grouped.get(level) ?? [];
      const rowWidth =
        group.reduce((total, id) => total + slotWidth(id), 0) +
        Math.max(0, group.length - 1) * columnGap;
      return Math.max(maximum, rowWidth);
    }, stepNodeWidth);
  const nodes: Record<string, FlowLayoutNode> = {};
  let y = canvasPadding;
  orderedLevels.forEach((level) => {
    const group = grouped.get(level) ?? [];
    const rowWidth =
      group.reduce((total, id) => total + slotWidth(id), 0) +
      Math.max(0, group.length - 1) * columnGap;
    let x = canvasPadding + (maximumRowWidth - rowWidth) / 2;
    const rowHeight = group.reduce(
      (maximum, id) =>
        Math.max(maximum, sizes.get(id)?.height ?? stepNodeHeight),
      stepNodeHeight,
    );
    group.forEach((id) => {
      const size = sizes.get(id) ?? { width: stepNodeWidth, height: stepNodeHeight };
      const slot = Math.max(stepNodeWidth, size.width);
      nodes[id] = {
        id,
        x: x + (slot - size.width) / 2,
        y: y + (rowHeight - size.height) / 2,
        width: size.width,
        height: size.height,
        level,
      };
      x += slot + columnGap;
    });
    y += rowHeight + rowGap;
  });

  const positioned = space.positions
    ? Object.fromEntries(
        Object.entries(nodes).map(([id, node]) => {
          const position = space.positions?.[id];
          return [
            id,
            position
              ? { ...node, x: position.x, y: position.y }
              : node,
          ];
        }),
      )
    : nodes;
  const positionedNodes = Object.values(positioned);
  const minX = Math.min(0, ...positionedNodes.map((node) => node.x - canvasPadding));
  const minY = Math.min(0, ...positionedNodes.map((node) => node.y - canvasPadding));
  const maxX = Math.max(
    maximumRowWidth + canvasPadding * 2,
    ...positionedNodes.map((node) => node.x + node.width + canvasPadding),
  );
  const maxY = Math.max(
    y - rowGap + canvasPadding,
    ...positionedNodes.map((node) => node.y + node.height + canvasPadding),
  );
  return {
    nodes: positioned,
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export interface FlowPoint extends ProjectionPoint {}

export interface FlowConnectorRoute {
  end: FlowPoint;
  fromPort: FlowPlacementDirection;
  points: FlowPoint[];
  start: FlowPoint;
  toPort: FlowPlacementDirection;
}

export interface FlowConnectorJump extends FlowPoint {
  segmentIndex: number;
}

function toProjectionPort(direction: FlowPlacementDirection): PortSide {
  return direction === "up"
    ? "top"
    : direction === "down"
      ? "bottom"
      : direction;
}

function fromProjectionPort(side: PortSide): FlowPlacementDirection {
  return side === "top"
    ? "up"
    : side === "bottom"
      ? "down"
      : side;
}

function toProjectionRoute(route: FlowConnectorRoute): OrthogonalRoute {
  return {
    source: route.start,
    target: route.end,
    sourcePort: toProjectionPort(route.fromPort),
    targetPort: toProjectionPort(route.toPort),
    points: route.points,
  };
}

function fromProjectionRoute(route: OrthogonalRoute): FlowConnectorRoute {
  return {
    start: route.source,
    end: route.target,
    fromPort: fromProjectionPort(route.sourcePort),
    toPort: fromProjectionPort(route.targetPort),
    points: route.points,
  };
}

export interface CompiledFlowConnector {
  edgeId: string;
  fromId: string;
  route: FlowConnectorRoute;
  toId: string;
}

export function compileFlowConnectors(
  space: FlowSpace,
  layout: FlowLayoutResult,
  measureTextWidth?: TextWidthMeasurer,
): CompiledFlowConnector[] {
  const semanticGraph = flowSpaceToSemanticGraph(space);
  const plan = compileGraphView({
    graph: semanticGraph,
    nodeSizes: Object.fromEntries(
      semanticGraph.nodes.map((node) => {
        const positioned = layout.nodes[node.id];
        return [node.id, {
          width: positioned?.width ?? stepNodeWidth,
          height: positioned?.height ?? stepNodeHeight,
        }];
      }),
    ),
    labelSizes: Object.fromEntries(
      semanticGraph.relations.flatMap((relation) => relation.label === undefined
        ? []
        : [[relation.id, {
            width: Math.max(32, Math.ceil(
              (measureTextWidth
                ? measureTextWidth(relation.label, flowEdgeLabelFontStyle)
                : estimateTextWidth(relation.label, flowEdgeLabelFontStyle)) + 16,
            )),
            height: 24,
          }] as const]),
    ),
    profile: {
      type: "fixed",
      positions: Object.fromEntries(
        semanticGraph.nodes.map((node) => [node.id, {
          x: layout.nodes[node.id]?.x ?? 0,
          y: layout.nodes[node.id]?.y ?? 0,
        }]),
      ),
    },
  });
  return plan.edges.map((edge) => ({
    edgeId: edge.id,
    fromId: edge.source,
    route: fromProjectionRoute(edge.route),
    toId: edge.target,
  }));
}

export function flowConnectorRoute(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  preferredFromPort?: FlowPlacementDirection,
  preferredToPort?: FlowPlacementDirection,
  obstacles: readonly FlowLayoutNode[] = [],
): FlowConnectorRoute {
  return fromProjectionRoute(projectionRouteOrthogonal(from, to, {
    ...(preferredFromPort === undefined
      ? {}
      : { sourcePort: toProjectionPort(preferredFromPort) }),
    ...(preferredToPort === undefined
      ? {}
      : { targetPort: toProjectionPort(preferredToPort) }),
    obstacles,
  }));
}

export function flowConnectorPathFromRoute(
  route: FlowConnectorRoute,
  jumps: readonly FlowConnectorJump[] = [],
): string {
  return projectionRoundedOrthogonalPath(
    route.points,
    jumps.map((jump): RouteJump => ({ ...jump })),
    10,
  );
}

export function flowConnectorPointOnRoute(
  route: FlowConnectorRoute,
  progress = 0.34,
): FlowPoint {
  return projectionPointOnRoute(toProjectionRoute(route), progress);
}

// The delete control remains a Laniakea interaction concern. Geometry of the
// route itself is shared with Graph Projection.
export function flowConnectorDeleteAnchor(
  route: FlowConnectorRoute,
  obstacles: readonly FlowLayoutNode[],
  offset = 24,
): FlowPoint {
  const point = flowConnectorPointOnRoute(route, 0.5);
  const segments = route.points.slice(0, -1).map((start, index) => {
    const end = route.points[index + 1]!;
    return {
      dx: end.x - start.x,
      dy: end.y - start.y,
      length: Math.hypot(end.x - start.x, end.y - start.y),
    };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total * 0.5;
  let normal: FlowPoint | undefined;
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (remaining <= segment.length) {
      normal = { x: -segment.dy / segment.length, y: segment.dx / segment.length };
      break;
    }
    remaining -= segment.length;
  }
  if (!normal) return point;
  const occupied = (x: number, y: number) =>
    obstacles.some((node) =>
      x > node.x - 2 && x < node.x + node.width + 2 &&
      y > node.y - 2 && y < node.y + node.height + 2,
    );
  const candidates = [
    { x: point.x + normal.x * offset, y: point.y + normal.y * offset },
    { x: point.x - normal.x * offset, y: point.y - normal.y * offset },
  ];
  return candidates.find((candidate) => !occupied(candidate.x, candidate.y)) ?? point;
}

export function flowPreviewConnectorPath(
  start: FlowPoint,
  end: FlowPoint,
  fromPort: FlowPlacementDirection,
  toPort?: FlowPlacementDirection,
): string {
  const source = { id: "preview-source", x: start.x, y: start.y, width: 0, height: 0 };
  const target = { id: "preview-target", x: end.x, y: end.y, width: 0, height: 0 };
  const route = projectionRouteOrthogonal(source, target, {
    sourcePort: toProjectionPort(fromPort),
    ...(toPort === undefined ? {} : { targetPort: toProjectionPort(toPort) }),
  });
  return projectionRoundedOrthogonalPath(route.points, [], 10);
}

export function flowConnectorPath(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  fromPort?: FlowPlacementDirection,
  toPort?: FlowPlacementDirection,
  jumps: readonly FlowConnectorJump[] = [],
  obstacles: readonly FlowLayoutNode[] = [],
): string {
  return flowConnectorPathFromRoute(
    flowConnectorRoute(from, to, fromPort, toPort, obstacles),
    jumps,
  );
}

export function flowConnectorPoint(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  progress = 0.34,
  fromPort?: FlowPlacementDirection,
  toPort?: FlowPlacementDirection,
): FlowPoint {
  return flowConnectorPointOnRoute(
    flowConnectorRoute(from, to, fromPort, toPort),
    progress,
  );
}

export function flowConnectorCrossings(
  routes: readonly {
    edgeId: string;
    fromId: string;
    route: FlowConnectorRoute;
    toId: string;
  }[],
): Record<string, FlowConnectorJump[]> {
  const projected = projectionRouteCrossings(routes.map((edge) => ({
    id: edge.edgeId,
    sourceId: edge.fromId,
    targetId: edge.toId,
    route: toProjectionRoute(edge.route),
  })));
  return Object.fromEntries(routes.map((edge) => [
    edge.edgeId,
    (projected[edge.edgeId] ?? []).map((jump) => ({ ...jump })),
  ]));
}

export function flowNavigationTarget(
  space: FlowSpace,
  nodeId: string,
  direction: FlowNavigationDirection,
): string | null {
  const layout = computeFlowLayout(space);
  const origin = layout.nodes[nodeId];
  if (!origin) return null;
  const originX = origin.x + origin.width / 2;
  const originY = origin.y + origin.height / 2;
  const candidates = Object.values(layout.nodes)
    .filter((candidate) => candidate.id !== nodeId)
    .map((candidate) => {
      const dx = candidate.x + candidate.width / 2 - originX;
      const dy = candidate.y + candidate.height / 2 - originY;
      const primary = direction === "left" || direction === "right"
        ? Math.abs(dx)
        : Math.abs(dy);
      const cross = direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
      return { candidate, cross, dx, dy, primary };
    })
    .filter(({ dx, dy }) => {
      if (direction === "left") return dx < -1;
      if (direction === "right") return dx > 1;
      if (direction === "up") return dy < -1;
      return dy > 1;
    })
    .sort((left, right) => {
      const crossWeight = direction === "left" || direction === "right" ? 2 : 0.42;
      return left.primary + left.cross * crossWeight
        - (right.primary + right.cross * crossWeight);
    });
  return candidates[0]?.candidate.id ?? null;
}
