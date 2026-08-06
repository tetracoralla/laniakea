import type {
  BranchTone,
  LayoutNode,
  LayoutResult,
  MindMapDocument,
} from "../types/mindmap";
import { nodePlaceholder } from "./canvasRender";

const tones: BranchTone[] = ["violet", "blue", "emerald", "amber"];
const emphasizedNodeHeight = 48;
const leafNodeHeight = 44;
const siblingGap = 14;
const branchGap = 30;
const rootX = 92;
const rootConnectorGap = 168;
const descendantConnectorGap = 150;

type NodeRootKind = LayoutNode["rootKind"];

export interface LayoutTextOverride {
  id: string;
  text: string;
}

function textUnits(text: string): number {
  return Array.from(text).reduce((total, character) => {
    if (character === " ") return total + 0.32;
    if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) {
      return total + 1;
    }
    return total + 0.62;
  }, 0);
}

function connectorGapAfter(depth: number): number {
  return depth === 0 ? rootConnectorGap : descendantConnectorGap;
}

function visibleText(
  depth: number,
  text: string,
  rootKind: NodeRootKind,
): string {
  return text || nodePlaceholder({ depth, rootKind });
}

export function sizeForNode(
  depth: number,
  text: string,
  rootKind: NodeRootKind = null,
) {
  const isMainRoot = rootKind === "main";
  const isFloatingRoot = rootKind === "floating";
  const isLeaf = !isMainRoot && !isFloatingRoot && depth >= 2;
  const fontSize = isMainRoot
    ? 19
    : isFloatingRoot
      ? 17
      : depth === 1
        ? 16
        : 15;
  const horizontalPadding = isMainRoot
    ? 50
    : isFloatingRoot
      ? 44
      : depth === 1
        ? 40
        : 36;
  const horizontalChrome = horizontalPadding + 4;
  const maximumWidth = isMainRoot
    ? Number.POSITIVE_INFINITY
    : isFloatingRoot
      ? 480
      : depth === 1
        ? 440
        : 400;
  const measuredText = visibleText(depth, text, rootKind);
  const explicitLines = measuredText.split("\n");
  const longestLine = Math.max(
    0,
    ...explicitLines.map((line) => textUnits(line)),
  );
  const width = Math.min(
    maximumWidth,
    Math.ceil(longestLine * fontSize + horizontalChrome),
  );
  const lineCount = isMainRoot
    ? explicitLines.length
    : explicitLines.reduce((total, line) => {
        const lineCapacity = Math.max(
          1,
          (width - horizontalChrome) / fontSize,
        );
        return (
          total +
          Math.max(1, Math.ceil(textUnits(line) / lineCapacity))
        );
      }, 0);
  const verticalPadding = 20;
  const verticalBorders = 2;
  const minimumHeight = isLeaf
    ? leafNodeHeight
    : emphasizedNodeHeight;
  return {
    width,
    height: Math.max(
      minimumHeight,
      Math.ceil(
        lineCount * fontSize * 1.35 +
          verticalPadding +
          verticalBorders,
      ),
    ),
  };
}

export function computeLayout(
  document: MindMapDocument,
  textOverride?: LayoutTextOverride,
): LayoutResult {
  const result: Record<string, LayoutNode> = {};
  const visibleIds: string[] = [];
  const root = document.nodes[document.rootId];
  if (!root) return { nodes: {}, visibleIds: [], width: 0, height: 0 };

  const subtreeHeights = new Map<string, number>();
  const nodeSizes = new Map<string, { width: number; height: number }>();
  const textForNode = (id: string, text: string) =>
    textOverride?.id === id ? textOverride.text : text;
  const measure = (
    id: string,
    depth: number,
    rootKind: NodeRootKind = null,
  ): number => {
    const current = document.nodes[id];
    if (!current) return 0;
    const size = sizeForNode(
      depth,
      textForNode(id, current.text),
      rootKind,
    );
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

  const mainHeight = measure(document.rootId, 0, "main");
  document.floatingRoots.forEach(({ id }) =>
    measure(id, 0, "floating"),
  );
  const top = Math.max(56, (900 - mainHeight) / 2);

  const placeMain = (
    id: string,
    depth: number,
    slotTop: number,
    x: number,
    inheritedTone: BranchTone,
  ) => {
    const current = document.nodes[id];
    if (!current) return;
    const rootKind = depth === 0 ? "main" : null;
    const size =
      nodeSizes.get(id) ??
      sizeForNode(
        depth,
        textForNode(id, current.text),
        rootKind,
      );
    const subtreeHeight = subtreeHeights.get(id) ?? size.height;
    const y = slotTop + (subtreeHeight - size.height) / 2;
    const tone = depth === 0 ? "violet" : inheritedTone;

    result[id] = {
      id,
      x,
      y,
      width: size.width,
      height: size.height,
      depth,
      tone,
      rootKind,
    };
    visibleIds.push(id);

    if (current.collapsed) return;
    const gap = depth === 0 ? branchGap : siblingGap;
    const childX = x + size.width + connectorGapAfter(depth);
    let childTop = slotTop;
    current.children.forEach((childId, index) => {
      const childTone =
        depth === 0 ? tones[index % tones.length] : inheritedTone;
      placeMain(
        childId,
        depth + 1,
        childTop,
        childX,
        childTone,
      );
      childTop +=
        (subtreeHeights.get(childId) ?? emphasizedNodeHeight) + gap;
    });
  };

  placeMain(document.rootId, 0, top, rootX, "violet");

  const placeFloatingDescendant = (
    id: string,
    depth: number,
    slotTop: number,
    x: number,
    tone: BranchTone,
  ) => {
    const current = document.nodes[id];
    if (!current) return;
    const size =
      nodeSizes.get(id) ??
      sizeForNode(depth, textForNode(id, current.text));
    const subtreeHeight = subtreeHeights.get(id) ?? size.height;
    const y = slotTop + (subtreeHeight - size.height) / 2;
    result[id] = {
      id,
      x,
      y,
      width: size.width,
      height: size.height,
      depth,
      tone,
      rootKind: null,
    };
    visibleIds.push(id);
    if (current.collapsed) return;
    const gap = siblingGap;
    const childX = x + size.width + connectorGapAfter(depth);
    let childTop = slotTop;
    current.children.forEach((childId) => {
      placeFloatingDescendant(
        childId,
        depth + 1,
        childTop,
        childX,
        tone,
      );
      childTop +=
        (subtreeHeights.get(childId) ?? leafNodeHeight) + gap;
    });
  };

  document.floatingRoots.forEach((floatingRoot, index) => {
    const current = document.nodes[floatingRoot.id];
    if (!current) return;
    const tone = tones[index % tones.length];
    const size =
      nodeSizes.get(floatingRoot.id) ??
      sizeForNode(
        0,
        textForNode(floatingRoot.id, current.text),
        "floating",
      );
    result[floatingRoot.id] = {
      id: floatingRoot.id,
      x: floatingRoot.x,
      y: floatingRoot.y,
      width: size.width,
      height: size.height,
      depth: 0,
      tone,
      rootKind: "floating",
    };
    visibleIds.push(floatingRoot.id);
    if (current.collapsed) return;
    const childX =
      floatingRoot.x + size.width + connectorGapAfter(0);
    let childTop = floatingRoot.y;
    current.children.forEach((childId) => {
      placeFloatingDescendant(
        childId,
        1,
        childTop,
        childX,
        tone,
      );
      childTop +=
        (subtreeHeights.get(childId) ?? emphasizedNodeHeight) +
        siblingGap;
    });
  });

  const width = Math.max(
    1200,
    ...Object.values(result).map((node) => node.x + node.width + 120),
  );
  const height = Math.max(
    900,
    mainHeight + top * 2,
    ...Object.values(result).map(
      (node) => node.y + node.height + 120,
    ),
  );
  return { nodes: result, visibleIds, width, height };
}

export function applyDraftWidth(
  layout: LayoutResult,
  document: MindMapDocument,
  editingId: string | null,
  draft: string,
): LayoutResult {
  if (!editingId) return layout;
  const current = layout.nodes[editingId];
  if (!current) return layout;
  const width = sizeForNode(
    current.depth,
    draft,
    current.rootKind,
  ).width;
  if (width === current.width) return layout;
  const delta = width - current.width;
  const descendantIds = new Set<string>();
  const pending = [...(document.nodes[editingId]?.children ?? [])];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || descendantIds.has(id)) continue;
    descendantIds.add(id);
    pending.push(...(document.nodes[id]?.children ?? []));
  }
  const nodes = { ...layout.nodes };
  nodes[editingId] = {
    ...current,
    width,
  };
  descendantIds.forEach((id) => {
    const descendant = nodes[id];
    if (!descendant) return;
    nodes[id] = {
      ...descendant,
      x: descendant.x + delta,
    };
  });
  return {
    ...layout,
    nodes,
    width: Math.max(layout.width, current.x + width + 120),
  };
}

function sameLayoutNode(left: LayoutNode, right: LayoutNode): boolean {
  return (
    left.id === right.id &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.depth === right.depth &&
    left.tone === right.tone &&
    left.rootKind === right.rootKind
  );
}

export function shareStableLayout(
  previous: LayoutResult | null,
  next: LayoutResult,
): LayoutResult {
  if (!previous) return next;

  let allNodesStable =
    previous.visibleIds.length === next.visibleIds.length;
  const nodes: Record<string, LayoutNode> = {};
  next.visibleIds.forEach((id) => {
    const previousNode = previous.nodes[id];
    const nextNode = next.nodes[id];
    if (previousNode && sameLayoutNode(previousNode, nextNode)) {
      nodes[id] = previousNode;
    } else {
      nodes[id] = nextNode;
      allNodesStable = false;
    }
  });
  const sameOrder =
    previous.visibleIds.length === next.visibleIds.length &&
    previous.visibleIds.every((id, index) => id === next.visibleIds[index]);
  if (
    allNodesStable &&
    sameOrder &&
    previous.width === next.width &&
    previous.height === next.height
  ) {
    return previous;
  }

  return {
    nodes,
    visibleIds: sameOrder ? previous.visibleIds : next.visibleIds,
    width: next.width,
    height: next.height,
  };
}

export function connectorPath(parent: LayoutNode, child: LayoutNode): string {
  const startX = parent.x + parent.width;
  const startY = parent.y + parent.height / 2;
  const endX = child.x;
  const endY = child.y + child.height / 2;
  const bend = Math.max(72, (endX - startX) * 0.52);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}
