import type {
  FlowNodeKind,
  FlowNodePosition,
  FlowPlacementDirection,
  FlowSpace,
} from "../types/mindmap";
import {
  estimateTextWidth,
  type NodeTextStyle,
  type TextWidthMeasurer,
} from "./textMetrics";

export const FLOW_STEP_NODE_WIDTH = 196;
export const FLOW_STEP_NODE_HEIGHT = 54;
export const FLOW_CANVAS_PADDING = 140;

const stepContentWidth = 160;
const decisionNodeWidth = 172;
const decisionNodeHeight = 76;
const decisionContentWidth = 116;
const decisionVerticalInset = 24;
const terminalNodeWidth = 152;
const terminalNodeHeight = 46;
const directionalGap = 96;
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
    const block = wrappedTextBlock(text, terminalNodeWidth - 36, measureTextWidth);
    return { width: terminalNodeWidth, height: Math.max(terminalNodeHeight, block.height + flowVerticalPadding) };
  }
  if (kind !== "decision") {
    const block = wrappedTextBlock(text, stepContentWidth, measureTextWidth);
    return {
      width: FLOW_STEP_NODE_WIDTH,
      height: Math.max(
        FLOW_STEP_NODE_HEIGHT,
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

export interface FlowDirectionalPlacement extends FlowNodePosition {
  height: number;
  width: number;
}

/**
 * Resolve the one direction-placement policy shared by hover previews and
 * committed mutations. Callers provide current positions for the visible
 * nodes; an occupied direction becomes the nearest open side lane.
 */
export function resolveFlowDirectionalPlacement(
  space: Pick<FlowSpace, "nodes" | "positions">,
  sourceId: string,
  kind: Extract<FlowNodeKind, "step" | "decision">,
  direction: FlowPlacementDirection,
  currentPositions: Record<string, FlowNodePosition>,
  measureTextWidth?: TextWidthMeasurer,
): FlowDirectionalPlacement | null {
  const positioned = Object.values(space.nodes).flatMap((node) => {
    const position = currentPositions[node.id] ?? space.positions?.[node.id];
    if (!position) return [];
    return [{
      id: node.id,
      ...position,
      ...flowNodeSize(node.kind, node.text, measureTextWidth),
    }];
  });
  const source = positioned.find(({ id }) => id === sourceId);
  if (!source) return null;
  const size = flowNodeSize(kind, "", measureTextWidth);
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const primary = direction === "right"
    ? { x: source.x + source.width + directionalGap, y: sourceCenterY - size.height / 2 }
    : direction === "left"
      ? { x: source.x - size.width - directionalGap, y: sourceCenterY - size.height / 2 }
      : direction === "down"
        ? { x: sourceCenterX - size.width / 2, y: source.y + source.height + directionalGap }
        : { x: sourceCenterX - size.width / 2, y: source.y - size.height - directionalGap };
  const horizontal = direction === "left" || direction === "right";
  const laneStep = (horizontal ? size.height : size.width) + 48;
  const overlaps = (x: number, y: number) => positioned.some((node) =>
    x < node.x + node.width + 24 &&
    x + size.width + 24 > node.x &&
    y < node.y + node.height + 24 &&
    y + size.height + 24 > node.y
  );
  const laneOffset = (index: number) => index === 0
    ? 0
    : (index % 2 === 1 ? 1 : -1) * Math.ceil(index / 2) * laneStep;
  const attempts = Math.max(5, positioned.length * 2 + 3);
  for (let index = 0; index < attempts; index += 1) {
    const offset = laneOffset(index);
    const x = primary.x + (horizontal ? 0 : offset);
    const y = primary.y + (horizontal ? offset : 0);
    if (!overlaps(x, y)) return { x, y, ...size };
  }
  return { ...primary, ...size };
}
