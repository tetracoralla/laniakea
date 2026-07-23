import type {
  BranchTone,
  LayoutNode,
  LayoutResult,
  MindMapDocument,
} from "../types/mindmap";

const tones: BranchTone[] = ["violet", "blue", "emerald", "amber"];
const minimumNodeHeight = 48;
const siblingGap = 14;
const branchGap = 30;
const rootX = 92;

function textUnits(text: string): number {
  return Array.from(text).reduce((total, character) => {
    if (character === " ") return total + 0.32;
    if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) {
      return total + 1;
    }
    return total + 0.56;
  }, 0);
}

function sizeFor(depth: number, text: string) {
  const fontSize = depth === 0 ? 19 : depth === 1 ? 16 : 15;
  const horizontalPadding = depth === 0 ? 50 : depth === 1 ? 40 : 36;
  const minimumWidth = depth === 0 ? 226 : depth === 1 ? 150 : 152;
  const maximumWidth = depth === 0 ? 286 : depth === 1 ? 210 : 230;
  const longestLine = Math.max(
    1,
    ...text.split("\n").map((line) => textUnits(line)),
  );
  const width = Math.max(
    minimumWidth,
    Math.min(
      maximumWidth,
      Math.ceil(longestLine * fontSize + horizontalPadding),
    ),
  );
  const lineCapacity = Math.max(
    1,
    (width - horizontalPadding) / fontSize,
  );
  const lineCount = text.split("\n").reduce(
    (total, line) =>
      total + Math.max(1, Math.ceil(textUnits(line) / lineCapacity)),
    0,
  );
  const verticalPadding = depth === 0 ? 20 : 18;
  return {
    width,
    height: Math.max(
      minimumNodeHeight,
      Math.ceil(lineCount * fontSize * 1.35 + verticalPadding),
    ),
  };
}

function depthX(depth: number): number {
  if (depth === 0) return rootX;
  if (depth === 1) return 532;
  return 856 + (depth - 2) * 286;
}

export function computeLayout(document: MindMapDocument): LayoutResult {
  const result: Record<string, LayoutNode> = {};
  const visibleIds: string[] = [];
  const root = document.nodes[document.rootId];
  if (!root) return { nodes: {}, visibleIds: [], width: 0, height: 0 };

  const subtreeHeights = new Map<string, number>();
  const nodeSizes = new Map<string, { width: number; height: number }>();
  const measure = (id: string, depth: number): number => {
    const current = document.nodes[id];
    if (!current) return 0;
    const size = sizeFor(depth, current.text);
    nodeSizes.set(id, size);
    if (current.collapsed || current.children.length === 0) {
      subtreeHeights.set(id, size.height);
      return size.height;
    }
    const gap = depth === 0 ? branchGap : siblingGap;
    const childrenHeight =
      current.children.reduce(
        (sum, childId) => sum + measure(childId, depth + 1),
        0,
      ) +
      gap * Math.max(0, current.children.length - 1);
    const value = Math.max(size.height, childrenHeight);
    subtreeHeights.set(id, value);
    return value;
  };

  const totalHeight = measure(document.rootId, 0);
  const top = Math.max(56, (900 - totalHeight) / 2);

  const place = (
    id: string,
    depth: number,
    slotTop: number,
    inheritedTone: BranchTone,
    rootChildIndex = 0,
  ) => {
    const current = document.nodes[id];
    if (!current) return;
    const size = nodeSizes.get(id) ?? sizeFor(depth, current.text);
    const subtreeHeight = subtreeHeights.get(id) ?? size.height;
    const y = slotTop + (subtreeHeight - size.height) / 2;
    const tone = depth === 0 ? "violet" : inheritedTone;

    result[id] = {
      id,
      x: depthX(depth),
      y,
      width: size.width,
      height: size.height,
      depth,
      tone,
    };
    visibleIds.push(id);

    if (current.collapsed) return;
    const gap = depth === 0 ? branchGap : siblingGap;
    let childTop = slotTop;
    current.children.forEach((childId, index) => {
      const childTone =
        depth === 0 ? tones[index % tones.length] : inheritedTone;
      place(
        childId,
        depth + 1,
        childTop,
        childTone,
        depth === 0 ? index : rootChildIndex,
      );
      childTop +=
        (subtreeHeights.get(childId) ?? minimumNodeHeight) + gap;
    });
  };

  place(document.rootId, 0, top, "violet");

  const width = Math.max(
    1200,
    ...Object.values(result).map((node) => node.x + node.width + 120),
  );
  const height = Math.max(900, totalHeight + top * 2);
  return { nodes: result, visibleIds, width, height };
}

export function connectorPath(parent: LayoutNode, child: LayoutNode): string {
  const startX = parent.x + parent.width;
  const startY = parent.y + parent.height / 2;
  const endX = child.x;
  const endY = child.y + child.height / 2;
  const bend = Math.max(72, (endX - startX) * 0.52);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}
