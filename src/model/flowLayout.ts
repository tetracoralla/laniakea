import type { FlowSpace } from "../types/mindmap";
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

function flowNodeSize(
  kind: string,
  text: string,
  measureTextWidth?: TextWidthMeasurer,
): { width: number; height: number } {
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

  return {
    nodes,
    width: maximumRowWidth + canvasPadding * 2,
    height: y - rowGap + canvasPadding,
  };
}

export function flowConnectorPath(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
): string {
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height;
  const endX = to.x + to.width / 2;
  const endY = to.y;
  if (to.level - from.level > 1) {
    const direction = endX < startX ? -1 : 1;
    const laneX = (direction > 0 ? Math.max(startX, endX) : Math.min(startX, endX))
      + direction * 150;
    return `M ${startX} ${startY} C ${startX} ${startY + 30}, ${laneX} ${startY + 30}, ${laneX} ${startY + 64} L ${laneX} ${endY - 42} C ${laneX} ${endY - 18}, ${endX} ${endY - 18}, ${endX} ${endY}`;
  }
  const middleY = startY + Math.max(24, (endY - startY) / 2);
  return `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`;
}

/**
 * Return a point on the same cubic curve used by flowConnectorPath.
 * Labels sit near the source instead of at the geometric midpoint so a
 * long edge that skips a row cannot cover an intermediate node.
 */
export function flowConnectorPoint(
  from: FlowLayoutNode,
  to: FlowLayoutNode,
  progress = 0.34,
): { x: number; y: number } {
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height;
  const endX = to.x + to.width / 2;
  const endY = to.y;
  if (to.level - from.level > 1) {
    const direction = endX < startX ? -1 : 1;
    return {
      x: (direction > 0 ? Math.max(startX, endX) : Math.min(startX, endX))
        + direction * 150,
      y: startY + 64,
    };
  }
  const middleY = startY + Math.max(24, (endY - startY) / 2);
  const t = Math.max(0, Math.min(1, progress));
  const inverse = 1 - t;
  const cubic = (start: number, controlA: number, controlB: number, end: number) =>
    inverse ** 3 * start
    + 3 * inverse ** 2 * t * controlA
    + 3 * inverse * t ** 2 * controlB
    + t ** 3 * end;
  return {
    x: cubic(startX, startX, endX, endX),
    y: cubic(startY, middleY, middleY, endY),
  };
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
