import type {
  FlowConnectorKind,
  FlowEdgeRouteOverride,
  FlowPlacementDirection,
  FlowSpace,
} from "../types/mindmap";
import {
  pointOnRoute as projectionPointOnRoute,
  applyOrthogonalRouteConstraint,
  routeOrthogonalBetweenPorts,
  roundedOrthogonalPath as projectionRoundedOrthogonalPath,
  routeCrossings as projectionRouteCrossings,
  routeOrthogonal as projectionRouteOrthogonal,
  type OrthogonalRoute,
  type Point as ProjectionPoint,
  type PortSide,
  type RouteJump,
} from "@openadam/graph-view-compiler";
import { compileGraphView } from "@openadam/graph-view-compiler/compiler";
import {
  estimateTextWidth,
  type NodeTextStyle,
  type TextWidthMeasurer,
} from "./layout";
import { flowSpaceToSemanticGraph } from "./flowGraphAdapter";
import {
  FLOW_CANVAS_PADDING as canvasPadding,
  FLOW_STEP_NODE_HEIGHT as stepNodeHeight,
  FLOW_STEP_NODE_WIDTH as stepNodeWidth,
  flowNodeSize,
  type FlowDirectionalPlacement,
} from "./flowPlacement";
export {
  flowNodeSize,
  resolveFlowDirectionalPlacement,
  type FlowDirectionalPlacement,
} from "./flowPlacement";

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

const columnGap = 72;
const rowGap = 92;

const flowEdgeLabelFontStyle: NodeTextStyle = {
  fontSize: 13,
  fontWeight: 570,
  letterSpacing: 0,
};

export function flowEdgeLabelSize(text: string, measureTextWidth?: TextWidthMeasurer) {
  const widths = text.split("\n").map((line) => measureTextWidth
    ? measureTextWidth(line, flowEdgeLabelFontStyle)
    : estimateTextWidth(line, flowEdgeLabelFontStyle));
  return {
    width: Math.ceil(Math.min(280, Math.max(32, ...widths.map((width) => width + 16)))),
    height: 6 + 20 * widths.reduce((lines, width) => lines + Math.max(1, Math.ceil(width / 264)), 0),
  };
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
  jumps?: readonly FlowConnectorJump[];
  points: FlowPoint[];
  start: FlowPoint;
  toPort: FlowPlacementDirection;
}

export interface FlowConnectorJump extends FlowPoint {
  segmentIndex: number;
}

export interface FlowRouteAdjustmentHandle extends FlowPoint {
  axis: FlowEdgeRouteOverride["axis"];
  coordinate: number;
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
    ...(route.jumps === undefined
      ? {}
      : { jumps: route.jumps.map((jump) => ({ ...jump })) }),
  };
}

export interface CompiledFlowConnector {
  edgeId: string;
  fromId: string;
  route: FlowConnectorRoute;
  toId: string;
}

export function compileFlowConnectors(
  space: Pick<FlowSpace, "nodes" | "edges" | "edgeRoutes">,
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
    edgeRouteConstraints: Object.fromEntries(
      Object.entries(space.edgeRoutes ?? {}).map(([edgeId, route]) => [edgeId, {
        type: "orthogonal-corridor" as const,
        axis: route.axis,
        coordinate: route.coordinate,
      }]),
    ),
  });
  const compiled = plan.edges.map((edge) => ({
    edgeId: edge.id,
    fromId: edge.source,
    route: fromProjectionRoute(space.edgeRoutes?.[edge.id] ? edge.route :
      avoidFlowEndpointBodies(edge.route, layout.nodes[edge.source], layout.nodes[edge.target], Object.values(layout.nodes))),
    toId: edge.target,
  }));
  const groups = new Map<string, number>();
  const separated = compiled.map((connector) => {
    const route = connector.route;
    const key = JSON.stringify([connector.fromId, connector.toId, route.fromPort, route.toPort]);
    const lane = groups.get(key) ?? 0;
    groups.set(key, lane + 1);
    if (!lane || space.edgeRoutes?.[connector.edgeId]) return connector;
    const handle = flowRouteAdjustmentHandle(route);
    if (!handle) return connector;
    const direction = handle.axis === "y"
      ? route.fromPort === "up" || route.toPort === "up" ? -1 : 1
      : route.fromPort === "left" || route.toPort === "left" ? -1 : 1;
    const boxes = Object.values(layout.nodes);
    const starts = boxes.map((box) => handle.axis === "x" ? box.x : box.y);
    const ends = boxes.map((box) => handle.axis === "x" ? box.x + box.width : box.y + box.height);
    // A parallel lane must satisfy the same obstacle rule as the first line.
    // Try both sides, then the outer corridors; an inward offset can otherwise
    // put a reverse approach back through either endpoint's body.
    const coordinates = [
      handle.coordinate + lane * 32 * direction,
      handle.coordinate - lane * 32 * direction,
      Math.min(...starts) - lane * 32,
      Math.max(...ends) + lane * 32,
    ];
    for (const coordinate of coordinates) {
      const candidate = flowRouteWithCorridor(route, { axis: handle.axis, coordinate });
      if (!boxes.some((box) => flowRouteIntersectsNode(candidate.points, box))) {
        return { ...connector, route: candidate };
      }
    }
    return connector;
  });
  const crossings = flowConnectorCrossings(separated);
  return separated.map((edge) => ({ ...edge, route: { ...edge.route, jumps: crossings[edge.edgeId] ?? [] } }));
}

/** A route may touch a box boundary but must never travel through its interior. */
export function flowRouteIntersectsNode(points: readonly FlowPoint[], box: FlowLayoutNode): boolean {
  const inset = 0.01;
  return points.slice(1).some((end, index) => {
    const start = points[index];
    if (Math.abs(start.y - end.y) < inset) {
      return start.y > box.y + inset && start.y < box.y + box.height - inset &&
        Math.max(start.x, end.x) > box.x + inset && Math.min(start.x, end.x) < box.x + box.width - inset;
    }
    return start.x > box.x + inset && start.x < box.x + box.width - inset &&
      Math.max(start.y, end.y) > box.y + inset && Math.min(start.y, end.y) < box.y + box.height - inset;
  });
}

function avoidFlowEndpointBodies(
  route: OrthogonalRoute, from: FlowLayoutNode, to: FlowLayoutNode, obstacles: FlowLayoutNode[],
): OrthogonalRoute {
  if (!flowRouteIntersectsNode(route.points, from) && !flowRouteIntersectsNode(route.points, to)) return route;
  const sourceNormal = portVector(fromProjectionPort(route.sourcePort));
  const targetNormal = portVector(fromProjectionPort(route.targetPort));
  // The geometry kernel excludes endpoint identities from obstacles. Body-only
  // obstacle identities make their interiors explicit while preserving the
  // allocated boundary ports. This fixes reverse approaches without changing
  // graph semantics or implementing a second path finder.
  return routeOrthogonalBetweenPorts(from, to,
    { ...route.source, side: route.sourcePort, normalX: sourceNormal.x, normalY: sourceNormal.y },
    { ...route.target, side: route.targetPort, normalX: targetNormal.x, normalY: targetNormal.y },
    { obstacles: [
      ...obstacles,
      { ...from, id: `${from.id}\u0000body` },
      { ...to, id: `${to.id}\u0000body` },
    ] },
  );
}

/** Gesture preview uses the same geometry kernel, without a whole graph compile. */
export function flowRouteWithCorridor(route: FlowConnectorRoute, override: FlowEdgeRouteOverride): FlowConnectorRoute {
  return fromProjectionRoute(applyOrthogonalRouteConstraint(toProjectionRoute(route), {
    type: "orthogonal-corridor", ...override,
  }));
}

function portVector(direction: FlowPlacementDirection): FlowPoint {
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "up") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

export function includeFlowConnectorBounds(
  space: Pick<FlowSpace, "nodes" | "edges" | "edgeRoutes" | "edgeLabelOffsets">,
  layout: FlowLayoutResult,
  measureTextWidth?: TextWidthMeasurer,
  compiled = compileFlowConnectors(space, layout, measureTextWidth),
): FlowLayoutResult {
  const edgeById = new Map(space.edges.map((edge) => [edge.id, edge]));
  const points = compiled.flatMap((connector) => {
    const kind = edgeById.get(connector.edgeId)?.style?.kind ?? "rounded";
    if (kind !== "curved") return connector.route.points;
    const curve = flowCurvedConnectorGeometry(connector.route);
    // A cubic Bézier stays inside the convex hull of these four points, so
    // including both controls keeps fit bounds honest without sampling.
    return [
      connector.route.start,
      curve.control1,
      curve.control2,
      connector.route.end,
    ];
  });
  for (const connector of compiled) {
    const edge = edgeById.get(connector.edgeId);
    if (!edge?.label) continue;
    const point = flowConnectorPointOnRoute(connector.route, 0.5, edge.style?.kind ?? "rounded");
    const offset = space.edgeLabelOffsets?.[edge.id] ?? { x: 0, y: 0 };
    const size = flowEdgeLabelSize(edge.label, measureTextWidth);
    points.push(
      { x: point.x + offset.x - size.width / 2, y: point.y + offset.y - size.height / 2 },
      { x: point.x + offset.x + size.width / 2, y: point.y + offset.y + size.height / 2 },
    );
  }
  if (points.length === 0) return layout;
  const minX = Math.min(layout.minX, ...points.map((point) => point.x - canvasPadding));
  const minY = Math.min(layout.minY, ...points.map((point) => point.y - canvasPadding));
  const maxX = Math.max(
    layout.minX + layout.width,
    ...points.map((point) => point.x + canvasPadding),
  );
  const maxY = Math.max(
    layout.minY + layout.height,
    ...points.map((point) => point.y + canvasPadding),
  );
  return { ...layout, minX, minY, width: maxX - minX, height: maxY - minY };
}

function oppositeFlowPort(
  direction: FlowPlacementDirection,
): FlowPlacementDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "up") return "down";
  return "up";
}

export function compileFlowQuickCreateRoute(
  space: Pick<FlowSpace, "nodes" | "edges" | "edgeRoutes">,
  layout: FlowLayoutResult,
  sourceId: string,
  direction: FlowPlacementDirection,
  placement: FlowDirectionalPlacement,
  measureTextWidth?: TextWidthMeasurer,
): FlowConnectorRoute | null {
  const source = space.nodes[sourceId];
  if (!source) return null;
  let suffix = 0;
  let previewNodeId = "__quick-create-preview__";
  while (space.nodes[previewNodeId]) {
    suffix += 1;
    previewNodeId = `__quick-create-preview-${suffix}__`;
  }
  let previewEdgeId = "__quick-create-edge__";
  while (space.edges.some((edge) => edge.id === previewEdgeId)) {
    suffix += 1;
    previewEdgeId = `__quick-create-edge-${suffix}__`;
  }
  const previewSpace = {
    nodes: {
      ...space.nodes,
      [previewNodeId]: {
        id: previewNodeId,
        text: "",
        kind: "step" as const,
        createdAt: source.updatedAt,
        updatedAt: source.updatedAt,
      },
    },
    edges: [
      ...space.edges,
      {
        id: previewEdgeId,
        from: sourceId,
        to: previewNodeId,
        label: "",
        fromPort: direction,
        toPort: oppositeFlowPort(direction),
      },
    ],
    edgeRoutes: space.edgeRoutes,
  };
  const previewLayout: FlowLayoutResult = {
    ...layout,
    nodes: {
      ...layout.nodes,
      [previewNodeId]: {
        id: previewNodeId,
        level: layout.nodes[sourceId]?.level ?? 0,
        ...placement,
      },
    },
  };
  return compileFlowConnectors(previewSpace, previewLayout, measureTextWidth)
    .find((connector) => connector.edgeId === previewEdgeId)?.route ?? null;
}

export function flowRouteAdjustmentHandle(
  route: FlowConnectorRoute,
  preferred?: FlowEdgeRouteOverride,
): FlowRouteAdjustmentHandle | null {
  const segments = route.points.slice(0, -1).flatMap((start, segmentIndex) => {
    const end = route.points[segmentIndex + 1];
    if (!end) return [];
    const horizontal = Math.abs(end.y - start.y) < 0.01;
    const vertical = Math.abs(end.x - start.x) < 0.01;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if ((!horizontal && !vertical) || length < 2) return [];
    return [{
      axis: horizontal ? "y" as const : "x" as const,
      coordinate: horizontal ? start.y : start.x,
      length,
      segmentIndex,
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }];
  });
  if (preferred) {
    const preferredSegments = segments.filter((segment) =>
      segment.axis === preferred.axis &&
      Math.abs(segment.coordinate - preferred.coordinate) < 0.01
    );
    const preferredSegment = preferredSegments.sort((left, right) =>
      right.length - left.length
    )[0];
    if (preferredSegment) return preferredSegment;
  }
  const candidates = segments.filter(({ length }) => length >= 28);
  return candidates.sort((left, right) =>
    Number(left.segmentIndex === 0 || left.segmentIndex === route.points.length - 2) -
      Number(right.segmentIndex === 0 || right.segmentIndex === route.points.length - 2) ||
    right.length - left.length
  )[0] ?? null;
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
  jumps: readonly FlowConnectorJump[] = route.jumps ?? [],
  kind: FlowConnectorKind = "rounded",
): string {
  if (kind === "straight") {
    return `M ${route.start.x} ${route.start.y} L ${route.end.x} ${route.end.y}`;
  }
  if (kind === "curved") {
    const { control1, control2 } = flowCurvedConnectorGeometry(route);
    return `M ${route.start.x} ${route.start.y} C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${route.end.x} ${route.end.y}`;
  }
  if (kind === "orthogonal") {
    return route.points.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
    ).join(" ");
  }
  return projectionRoundedOrthogonalPath(
    route.points,
    jumps.map((jump): RouteJump => ({ ...jump })),
    10,
  );
}

function flowCurvedConnectorGeometry(route: FlowConnectorRoute): {
  control1: FlowPoint;
  control2: FlowPoint;
} {
  const sourceVector = portVector(route.fromPort);
  const targetVector = portVector(route.toPort);
  const distance = Math.max(
    48,
    Math.min(180, Math.hypot(
      route.end.x - route.start.x,
      route.end.y - route.start.y,
    ) * 0.42),
  );
  return {
    control1: {
      x: route.start.x + sourceVector.x * distance,
      y: route.start.y + sourceVector.y * distance,
    },
    control2: {
      x: route.end.x + targetVector.x * distance,
      y: route.end.y + targetVector.y * distance,
    },
  };
}

export function flowConnectorPointOnRoute(
  route: FlowConnectorRoute,
  progress = 0.34,
  kind: FlowConnectorKind = "rounded",
): FlowPoint {
  const t = Math.max(0, Math.min(1, progress));
  if (kind === "straight") {
    return {
      x: route.start.x + (route.end.x - route.start.x) * t,
      y: route.start.y + (route.end.y - route.start.y) * t,
    };
  }
  if (kind === "curved") {
    const { control1, control2 } = flowCurvedConnectorGeometry(route);
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * route.start.x +
        3 * inverse ** 2 * t * control1.x +
        3 * inverse * t ** 2 * control2.x +
        t ** 3 * route.end.x,
      y: inverse ** 3 * route.start.y +
        3 * inverse ** 2 * t * control1.y +
        3 * inverse * t ** 2 * control2.y +
        t ** 3 * route.end.y,
    };
  }
  return projectionPointOnRoute(toProjectionRoute(route), progress);
}

// The delete control remains a Laniakea interaction concern. Geometry of the
// route itself is shared with Graph View Compiler.
export function flowConnectorDeleteAnchor(
  route: FlowConnectorRoute,
  obstacles: readonly FlowLayoutNode[],
  offset = 24,
  kind: FlowConnectorKind = "rounded",
): FlowPoint {
  const point = flowConnectorPointOnRoute(route, 0.5, kind);
  let normal: FlowPoint | undefined;
  if (kind === "straight") {
    const dx = route.end.x - route.start.x;
    const dy = route.end.y - route.start.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) normal = { x: -dy / length, y: dx / length };
  } else if (kind === "curved") {
    const { control1, control2 } = flowCurvedConnectorGeometry(route);
    // Cubic derivative at t=.5; its perpendicular follows the visible curve
    // instead of the hidden orthogonal route.
    const dx = 0.75 * (control1.x - route.start.x) +
      1.5 * (control2.x - control1.x) +
      0.75 * (route.end.x - control2.x);
    const dy = 0.75 * (control1.y - route.start.y) +
      1.5 * (control2.y - control1.y) +
      0.75 * (route.end.y - control2.y);
    const length = Math.hypot(dx, dy);
    if (length > 0) normal = { x: -dy / length, y: dx / length };
  }
  const segments = route.points.slice(0, -1).map((start, index) => {
    const end = route.points[index + 1]!;
    return {
      dx: end.x - start.x,
      dy: end.y - start.y,
      length: Math.hypot(end.x - start.x, end.y - start.y),
    };
  });
  if (!normal) {
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    let remaining = total * 0.5;
    for (const segment of segments) {
      if (segment.length === 0) continue;
      if (remaining <= segment.length) {
        normal = { x: -segment.dy / segment.length, y: segment.dx / segment.length };
        break;
      }
      remaining -= segment.length;
    }
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
