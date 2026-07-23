import type {
  BranchTone,
  LayoutNode,
  LayoutResult,
  MindMapDocument,
} from "../types/mindmap";

const tones: BranchTone[] = ["violet", "blue", "emerald", "amber"];
const nodeHeight = 48;
const siblingGap = 14;
const branchGap = 30;
const rootX = 92;

function widthFor(depth: number, text: string): number {
  if (depth === 0) return Math.max(226, Math.min(286, text.length * 19 + 48));
  if (depth === 1) return Math.max(150, Math.min(210, text.length * 17 + 40));
  return Math.max(152, Math.min(230, text.length * 16 + 36));
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
  const measure = (id: string, depth: number): number => {
    const current = document.nodes[id];
    if (!current) return 0;
    if (current.collapsed || current.children.length === 0) {
      subtreeHeights.set(id, nodeHeight);
      return nodeHeight;
    }
    const gap = depth === 0 ? branchGap : siblingGap;
    const childrenHeight =
      current.children.reduce(
        (sum, childId) => sum + measure(childId, depth + 1),
        0,
      ) +
      gap * Math.max(0, current.children.length - 1);
    const value = Math.max(nodeHeight, childrenHeight);
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
    const subtreeHeight = subtreeHeights.get(id) ?? nodeHeight;
    const width = widthFor(depth, current.text);
    const y = slotTop + (subtreeHeight - nodeHeight) / 2;
    const tone = depth === 0 ? "violet" : inheritedTone;

    result[id] = {
      id,
      x: depthX(depth),
      y,
      width,
      height: nodeHeight,
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
      childTop += (subtreeHeights.get(childId) ?? nodeHeight) + gap;
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
