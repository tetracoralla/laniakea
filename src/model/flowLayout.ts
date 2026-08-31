import type {
  FlowPlacementDirection,
  FlowSpace,
} from "../types/mindmap";
import {
  estimateTextWidth,
  type NodeTextStyle,
  type TextWidthMeasurer,
} from "./layout";

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
const terminalNodeWidth = 132;
const terminalNodeHeight = 42;
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
  const ids = Object.keys(space.nodes);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  space.edges.forEach((edge) => {
    if (!space.nodes[edge.from] || !space.nodes[edge.to]) return;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const roots = ids
    .filter((id) => incoming.get(id) === 0)
    .sort((left, right) =>
      Number(space.nodes[right].kind === "start") -
      Number(space.nodes[left].kind === "start"),
    );
  const levels = new Map<string, number>();
  const remainingIncoming = new Map(incoming);
  const queue = roots.length > 0 ? [...roots] : ids.slice(0, 1);
  queue.forEach((id) => levels.set(id, 0));
  let cursor = 0;
  while (cursor < queue.length) {
    const currentId = queue[cursor];
    cursor += 1;
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
    if (!levels.has(id)) {
      levels.set(id, fallbackLevel);
      fallbackLevel += 1;
    }
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
  const minimumX = Math.min(...positionedNodes.map((node) => node.x));
  const minimumY = Math.min(...positionedNodes.map((node) => node.y));
  const shiftX = Math.max(0, canvasPadding - minimumX);
  const shiftY = Math.max(0, canvasPadding - minimumY);
  const normalized = shiftX === 0 && shiftY === 0
    ? positioned
    : Object.fromEntries(
        Object.entries(positioned).map(([id, node]) => [
          id,
          { ...node, x: node.x + shiftX, y: node.y + shiftY },
        ]),
      );
  return {
    nodes: normalized,
    width: Math.max(
      maximumRowWidth + canvasPadding * 2,
      ...Object.values(normalized).map((node) =>
        node.x + node.width + canvasPadding,
      ),
    ),
    height: Math.max(
      y - rowGap + canvasPadding,
      ...Object.values(normalized).map((node) =>
        node.y + node.height + canvasPadding,
      ),
    ),
  };
}

export interface FlowPoint {
  x: number;
  y: number;
}

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

function connectorPorts(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  preferredFromPort?: FlowPlacementDirection,
  preferredToPort?: FlowPlacementDirection,
): {
  fromPort: FlowPlacementDirection;
  toPort: FlowPlacementDirection;
} {
  const fromCenter = {
    x: from.x + from.width / 2,
    y: from.y + from.height / 2,
  };
  const toCenter = {
    x: to.x + to.width / 2,
    y: to.y + to.height / 2,
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const automaticFromPort: FlowPlacementDirection = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? "right" : "left")
    : (dy >= 0 ? "down" : "up");
  const automaticToPort: FlowPlacementDirection = automaticFromPort === "right"
    ? "left"
    : automaticFromPort === "left"
      ? "right"
      : automaticFromPort === "down"
        ? "up"
        : "down";
  const fromPort = preferredFromPort ?? automaticFromPort;
  const toPort = preferredToPort ?? automaticToPort;
  return { fromPort, toPort };
}

function portPoint(
  node: FlowLayoutNode,
  port: FlowPlacementDirection,
): FlowPoint {
  return port === "left"
    ? { x: node.x, y: node.y + node.height / 2 }
    : port === "right"
      ? { x: node.x + node.width, y: node.y + node.height / 2 }
      : port === "up"
        ? { x: node.x + node.width / 2, y: node.y }
        : { x: node.x + node.width / 2, y: node.y + node.height };
}

function portVector(port: FlowPlacementDirection): FlowPoint {
  return port === "left"
    ? { x: -1, y: 0 }
    : port === "right"
      ? { x: 1, y: 0 }
      : port === "up"
        ? { x: 0, y: -1 }
        : { x: 0, y: 1 };
}

function samePoint(left: FlowPoint, right: FlowPoint): boolean {
  return Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01;
}

function compactOrthogonalPoints(points: FlowPoint[]): FlowPoint[] {
  const distinct = points.filter((point, index) =>
    index === 0 || !samePoint(point, points[index - 1]),
  );
  return distinct.filter((point, index) => {
    if (index === 0 || index === distinct.length - 1) return true;
    const previous = distinct[index - 1];
    const next = distinct[index + 1];
    const vertical = previous.x === point.x && point.x === next.x;
    const horizontal = previous.y === point.y && point.y === next.y;
    return !vertical && !horizontal;
  });
}

function pointOutside(
  point: FlowPoint,
  port: FlowPlacementDirection,
  distance: number,
): FlowPoint {
  const vector = portVector(port);
  return {
    x: point.x + vector.x * distance,
    y: point.y + vector.y * distance,
  };
}

function routedPoints(
  start: FlowPoint,
  end: FlowPoint,
  fromPort: FlowPlacementDirection,
  toPort: FlowPlacementDirection,
): FlowPoint[] {
  const stub = 30;
  const detour = 42;
  const startStub = pointOutside(start, fromPort, stub);
  const endStub = pointOutside(end, toPort, stub);
  const fromHorizontal = fromPort === "left" || fromPort === "right";
  const toHorizontal = toPort === "left" || toPort === "right";
  const fromVector = portVector(fromPort);
  const toVector = portVector(toPort);
  const points: FlowPoint[] = [start, startStub];

  if (fromHorizontal && toHorizontal) {
    const facing = fromVector.x > 0
      ? startStub.x <= endStub.x
      : startStub.x >= endStub.x;
    const targetFacing = toVector.x > 0
      ? endStub.x <= startStub.x
      : endStub.x >= startStub.x;
    const middleX = facing && targetFacing
      ? (startStub.x + endStub.x) / 2
      : fromVector.x > 0
        ? Math.max(startStub.x, endStub.x) + detour
        : Math.min(startStub.x, endStub.x) - detour;
    points.push(
      { x: middleX, y: startStub.y },
      { x: middleX, y: endStub.y },
    );
  } else if (!fromHorizontal && !toHorizontal) {
    const facing = fromVector.y > 0
      ? startStub.y <= endStub.y
      : startStub.y >= endStub.y;
    const targetFacing = toVector.y > 0
      ? endStub.y <= startStub.y
      : endStub.y >= startStub.y;
    const middleY = facing && targetFacing
      ? (startStub.y + endStub.y) / 2
      : fromVector.y > 0
        ? Math.max(startStub.y, endStub.y) + detour
        : Math.min(startStub.y, endStub.y) - detour;
    points.push(
      { x: startStub.x, y: middleY },
      { x: endStub.x, y: middleY },
    );
  } else if (fromHorizontal) {
    const wouldReverse = fromVector.x > 0
      ? endStub.x < startStub.x
      : endStub.x > startStub.x;
    if (wouldReverse) {
      const detourX = startStub.x + fromVector.x * detour;
      points.push(
        { x: detourX, y: startStub.y },
        { x: detourX, y: endStub.y },
      );
    } else {
      points.push({ x: endStub.x, y: startStub.y });
    }
  } else {
    const wouldReverse = fromVector.y > 0
      ? endStub.y < startStub.y
      : endStub.y > startStub.y;
    if (wouldReverse) {
      const detourY = startStub.y + fromVector.y * detour;
      points.push(
        { x: startStub.x, y: detourY },
        { x: endStub.x, y: detourY },
      );
    } else {
      points.push({ x: startStub.x, y: endStub.y });
    }
  }

  points.push(endStub, end);
  return compactOrthogonalPoints(points);
}

export function flowConnectorRoute(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  preferredFromPort?: FlowPlacementDirection,
  preferredToPort?: FlowPlacementDirection,
): FlowConnectorRoute {
  const { fromPort, toPort } = connectorPorts(
    from,
    to,
    preferredFromPort,
    preferredToPort,
  );
  const start = portPoint(from, fromPort);
  const end = portPoint(to, toPort);
  return {
    end,
    fromPort,
    points: routedPoints(start, end, fromPort, toPort),
    start,
    toPort,
  };
}

function offsetToward(from: FlowPoint, to: FlowPoint, distance: number): FlowPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return from;
  const ratio = Math.min(1, distance / length);
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

function lineWithJumps(
  from: FlowPoint,
  to: FlowPoint,
  jumps: readonly FlowConnectorJump[],
  segmentIndex: number,
): string {
  if (Math.abs(from.y - to.y) > 0.01) return ` L ${to.x} ${to.y}`;
  const direction = to.x >= from.x ? 1 : -1;
  const radius = 6;
  const candidates = jumps
    .filter((jump) => jump.segmentIndex === segmentIndex)
    .filter((jump) =>
      direction > 0
        ? jump.x > from.x + radius && jump.x < to.x - radius
        : jump.x < from.x - radius && jump.x > to.x + radius,
    )
    .sort((left, right) => direction * (left.x - right.x));
  let path = "";
  candidates.forEach((jump) => {
    path += ` L ${jump.x - direction * radius} ${from.y}`;
    path += ` Q ${jump.x} ${from.y - radius} ${jump.x + direction * radius} ${from.y}`;
  });
  return `${path} L ${to.x} ${to.y}`;
}

function roundedOrthogonalPath(
  points: readonly FlowPoint[],
  jumps: readonly FlowConnectorJump[] = [],
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const cornerRadius = 10;
  const radii = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return 0;
    const incoming = Math.hypot(
      point.x - points[index - 1].x,
      point.y - points[index - 1].y,
    );
    const outgoing = Math.hypot(
      points[index + 1].x - point.x,
      points[index + 1].y - point.y,
    );
    return Math.min(cornerRadius, incoming / 2, outgoing / 2);
  });
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    const segmentStart = segmentIndex === 0
      ? points[0]
      : offsetToward(
          points[segmentIndex],
          points[segmentIndex + 1],
          radii[segmentIndex],
        );
    const segmentEnd = segmentIndex === points.length - 2
      ? points[segmentIndex + 1]
      : offsetToward(
          points[segmentIndex + 1],
          points[segmentIndex],
          radii[segmentIndex + 1],
        );
    if (segmentIndex > 0) {
      const corner = points[segmentIndex];
      path += ` Q ${corner.x} ${corner.y} ${segmentStart.x} ${segmentStart.y}`;
    }
    path += lineWithJumps(segmentStart, segmentEnd, jumps, segmentIndex);
  }
  return path;
}

export function flowPreviewConnectorPath(
  start: FlowPoint,
  end: FlowPoint,
  fromPort: FlowPlacementDirection,
  toPort?: FlowPlacementDirection,
): string {
  const resolvedToPort = toPort ?? (fromPort === "right"
    ? "left"
    : fromPort === "left"
      ? "right"
      : fromPort === "down"
        ? "up"
        : "down");
  return roundedOrthogonalPath(
    routedPoints(start, end, fromPort, resolvedToPort),
  );
}

export function flowConnectorPath(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  fromPort?: FlowPlacementDirection,
  toPort?: FlowPlacementDirection,
  jumps: readonly FlowConnectorJump[] = [],
): string {
  return roundedOrthogonalPath(
    flowConnectorRoute(from, to, fromPort, toPort).points,
    jumps,
  );
}

/**
 * Return a point on the same orthogonal polyline used by flowConnectorPath.
 * Labels sit near the source instead of at the midpoint so a long edge does
 * not cover an intermediate node.
 */
export function flowConnectorPoint(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  progress = 0.34,
  fromPort?: FlowPlacementDirection,
  toPort?: FlowPlacementDirection,
): { x: number; y: number } {
  const points = flowConnectorRoute(from, to, fromPort, toPort).points;
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    return { end, length: Math.hypot(end.x - start.x, end.y - start.y), start };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = total * Math.max(0, Math.min(1, progress));
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
        y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
      };
    }
    remaining -= segment.length;
  }
  return points[points.length - 1];
}

function interiorCrossing(
  horizontalStart: FlowPoint,
  horizontalEnd: FlowPoint,
  verticalStart: FlowPoint,
  verticalEnd: FlowPoint,
): FlowPoint | null {
  const inset = 12;
  const minX = Math.min(horizontalStart.x, horizontalEnd.x) + inset;
  const maxX = Math.max(horizontalStart.x, horizontalEnd.x) - inset;
  const minY = Math.min(verticalStart.y, verticalEnd.y) + inset;
  const maxY = Math.max(verticalStart.y, verticalEnd.y) - inset;
  if (
    verticalStart.x <= minX ||
    verticalStart.x >= maxX ||
    horizontalStart.y <= minY ||
    horizontalStart.y >= maxY
  ) {
    return null;
  }
  return { x: verticalStart.x, y: horizontalStart.y };
}

export function flowConnectorCrossings(
  routes: readonly {
    edgeId: string;
    fromId: string;
    route: FlowConnectorRoute;
    toId: string;
  }[],
): Record<string, FlowConnectorJump[]> {
  const result: Record<string, FlowConnectorJump[]> = {};
  const addJump = (edgeId: string, jump: FlowConnectorJump) => {
    const current = result[edgeId] ?? [];
    if (!current.some((candidate) =>
      candidate.segmentIndex === jump.segmentIndex &&
      Math.abs(candidate.x - jump.x) < 0.1 &&
      Math.abs(candidate.y - jump.y) < 0.1,
    )) {
      current.push(jump);
      result[edgeId] = current;
    }
  };
  routes.forEach((left, leftIndex) => {
    routes.slice(leftIndex + 1).forEach((right) => {
      if (
        left.fromId === right.fromId ||
        left.fromId === right.toId ||
        left.toId === right.fromId ||
        left.toId === right.toId
      ) return;
      left.route.points.slice(0, -1).forEach((leftStart, leftSegmentIndex) => {
        const leftEnd = left.route.points[leftSegmentIndex + 1];
        right.route.points.slice(0, -1).forEach((rightStart, rightSegmentIndex) => {
          const rightEnd = right.route.points[rightSegmentIndex + 1];
          const leftHorizontal = Math.abs(leftStart.y - leftEnd.y) < 0.01;
          const rightHorizontal = Math.abs(rightStart.y - rightEnd.y) < 0.01;
          if (leftHorizontal === rightHorizontal) return;
          const crossing = leftHorizontal
            ? interiorCrossing(leftStart, leftEnd, rightStart, rightEnd)
            : interiorCrossing(rightStart, rightEnd, leftStart, leftEnd);
          if (!crossing) return;
          addJump(leftHorizontal ? left.edgeId : right.edgeId, {
            ...crossing,
            segmentIndex: leftHorizontal ? leftSegmentIndex : rightSegmentIndex,
          });
        });
      });
    });
  });
  return result;
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
