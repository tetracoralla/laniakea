import type {
  BranchTone,
  LayoutNode,
  LayoutResult,
  MindMapDocument,
} from "../types/mindmap";
import { nodePlaceholder } from "./canvasRender";
import { sizeForSubspacePreview } from "./subspacePreview";

const tones: BranchTone[] = ["violet", "blue", "emerald", "amber"];
const emphasizedNodeHeight = 48;
const secondaryNodeHeight = 44;
const leafNodeHeight = 36;
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

export interface NodeTextStyle {
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
}

export type TextWidthMeasurer = (
  text: string,
  style: NodeTextStyle,
) => number;

function textUnits(text: string): number {
  return Array.from(text).reduce((total, character) => {
    if (character === " ") return total + 0.32;
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(character)) {
      return total + 1.1;
    }
    if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) {
      return total + 1;
    }
    return total + 0.62;
  }, 0);
}

export function estimateTextWidth(
  text: string,
  style: NodeTextStyle,
): number {
  return textUnits(text) * style.fontSize;
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
  measureTextWidth?: TextWidthMeasurer,
) {
  const isMainRoot = rootKind === "main";
  const isFloatingRoot = rootKind === "floating";
  const isSecondary = !isMainRoot && !isFloatingRoot && depth === 2;
  const isLeaf = !isMainRoot && !isFloatingRoot && depth >= 3;
  const fontSize = isMainRoot
    ? 19
    : isFloatingRoot
      ? 17
      : depth === 1
        ? 16
        : isSecondary
          ? 15
          : 13;
  const horizontalPadding = isMainRoot
    ? 50
    : isFloatingRoot
      ? 44
      : depth === 1
        ? 40
        : isSecondary
          ? 36
          : 28;
  const horizontalChrome = horizontalPadding + 4;
  const maximumWidth = isMainRoot
    ? Number.POSITIVE_INFINITY
    : isFloatingRoot
      ? 640
      : depth === 1
        ? 600
        : isSecondary
          ? 560
          : 500;
  const fontWeight = isMainRoot
    ? 580
    : isFloatingRoot
      ? 650
      : depth === 1
        ? 620
        : isSecondary
          ? 530
          : 500;
  const letterSpacing = isMainRoot ? fontSize * 0.01 : 0;
  const measuredText = visibleText(depth, text, rootKind);
  const explicitLines = measuredText.split("\n");
  const lineWidths = explicitLines.map((line) =>
    measureTextWidth
      ? measureTextWidth(line, { fontSize, fontWeight, letterSpacing })
      : textUnits(line) * fontSize,
  );
  const longestLineWidth = lineWidths.reduce(
    (maximum, lineWidth) => Math.max(maximum, lineWidth),
    0,
  );
  const width = Math.min(
    maximumWidth,
    Math.ceil(
      longestLineWidth + horizontalChrome + (measureTextWidth ? 4 : 0),
    ),
  );
  const lineCount = isMainRoot
    ? explicitLines.length
    : lineWidths.reduce((total, lineWidth) => {
        const lineCapacity = Math.max(1, width - horizontalChrome);
        return (
          total +
          Math.max(1, Math.ceil(lineWidth / lineCapacity))
        );
      }, 0);
  const verticalPadding = isLeaf ? 16 : 20;
  const verticalBorders = 2;
  const minimumHeight = isLeaf
    ? leafNodeHeight
    : isSecondary
      ? secondaryNodeHeight
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
  measureTextWidth?: TextWidthMeasurer,
): LayoutResult {
  const result: Record<string, LayoutNode> = {};
  const portals: Record<string, LayoutNode> = {};
  const visibleIds: string[] = [];
  const root = document.nodes[document.rootId];
  if (!root) return { nodes: {}, visibleIds: [], width: 0, height: 0 };

  const subtreeHeights = new Map<string, number>();
  const nodeSizes = new Map<string, { width: number; height: number }>();
  const portalSizes = new Map<string, { width: number; height: number }>();
  const portalForNode = (id: string) => {
    const subspaceId = document.nodes[id]?.subspaceId;
    return subspaceId ? document.spaces?.[subspaceId] : undefined;
  };
  const textForNode = (id: string, text: string) =>
    textOverride?.id === id ? textOverride.text : text;
  interface MeasureFrame {
    depth: number;
    expanded: boolean;
    id: string;
    rootKind: NodeRootKind;
  }
  const measureSubtree = (
    rootId: string,
    rootKind: NodeRootKind,
  ): number => {
    const pending: MeasureFrame[] = [
      { id: rootId, depth: 0, rootKind, expanded: false },
    ];
    while (pending.length > 0) {
      const frame = pending.pop();
      if (!frame) continue;
      const current = document.nodes[frame.id];
      if (!current) continue;
      if (!frame.expanded) {
        const size = sizeForNode(
          frame.depth,
          textForNode(frame.id, current.text),
          frame.rootKind,
          measureTextWidth,
        );
        nodeSizes.set(frame.id, size);
        const portal = portalForNode(frame.id);
        if (portal) {
          portalSizes.set(
            frame.id,
            sizeForSubspacePreview(portal, measureTextWidth),
          );
        }
        if (
          current.collapsed ||
          (current.children.length === 0 && !portal)
        ) {
          subtreeHeights.set(frame.id, size.height);
          continue;
        }
        pending.push({ ...frame, expanded: true });
        for (let index = current.children.length - 1; index >= 0; index -= 1) {
          pending.push({
            id: current.children[index],
            depth: frame.depth + 1,
            rootKind: null,
            expanded: false,
          });
        }
        continue;
      }

      const size = nodeSizes.get(frame.id);
      if (!size) continue;
      const gap = frame.depth === 0 ? branchGap : siblingGap;
      const portalSize = portalSizes.get(frame.id);
      const visibleChildCount =
        current.children.length + (portalSize ? 1 : 0);
      const childrenHeight =
        current.children.reduce(
          (sum, childId) => sum + (subtreeHeights.get(childId) ?? 0),
          0,
        ) +
        (portalSize?.height ?? 0) +
        gap * Math.max(0, visibleChildCount - 1);
      subtreeHeights.set(
        frame.id,
        Math.max(size.height, childrenHeight),
      );
    }
    return subtreeHeights.get(rootId) ?? 0;
  };

  const mainHeight = measureSubtree(document.rootId, "main");
  document.floatingRoots.forEach(({ id }) =>
    measureSubtree(id, "floating"),
  );
  const top = Math.max(56, (900 - mainHeight) / 2);

  interface PlacementFrame {
    depth: number;
    id: string;
    rootKind: NodeRootKind;
    slotTop: number;
    tone: BranchTone;
    x: number;
  }
  const placeAutomaticSubtree = (
    initial: PlacementFrame,
    mainTree: boolean,
  ) => {
    const pending = [initial];
    while (pending.length > 0) {
      const frame = pending.pop();
      if (!frame) continue;
      const current = document.nodes[frame.id];
      if (!current) continue;
      const size =
        nodeSizes.get(frame.id) ??
        sizeForNode(
          frame.depth,
          textForNode(frame.id, current.text),
          frame.rootKind,
          measureTextWidth,
        );
      const subtreeHeight = subtreeHeights.get(frame.id) ?? size.height;
      const tone =
        mainTree && frame.depth === 0 ? "violet" : frame.tone;
      result[frame.id] = {
        id: frame.id,
        x: frame.x,
        y: frame.slotTop + (subtreeHeight - size.height) / 2,
        width: size.width,
        height: size.height,
        depth: frame.depth,
        tone,
        rootKind: frame.rootKind,
      };
      visibleIds.push(frame.id);
      if (current.collapsed) continue;

      const gap = mainTree && frame.depth === 0 ? branchGap : siblingGap;
      const childX = frame.x + size.width + connectorGapAfter(frame.depth);
      let childTop = frame.slotTop;
      const children: PlacementFrame[] = [];
      current.children.forEach((childId, index) => {
        children.push({
          id: childId,
          depth: frame.depth + 1,
          slotTop: childTop,
          x: childX,
          tone:
            mainTree && frame.depth === 0
              ? tones[index % tones.length]
              : tone,
          rootKind: null,
        });
        childTop +=
          (subtreeHeights.get(childId) ??
            (mainTree ? emphasizedNodeHeight : leafNodeHeight)) +
          gap;
      });
      const portalSize = portalSizes.get(frame.id);
      if (portalSize) {
        portals[frame.id] = {
          id: `subspace:${frame.id}`,
          x: childX,
          y: childTop,
          width: portalSize.width,
          height: portalSize.height,
          depth: frame.depth + 1,
          tone:
            mainTree && frame.depth === 0
              ? tones[current.children.length % tones.length]
              : tone,
          rootKind: null,
        };
      }
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push(children[index]);
      }
    }
  };

  placeAutomaticSubtree(
    {
      id: document.rootId,
      depth: 0,
      slotTop: top,
      x: rootX,
      tone: "violet",
      rootKind: "main",
    },
    true,
  );

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
        measureTextWidth,
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
      placeAutomaticSubtree(
        {
          id: childId,
          depth: 1,
          slotTop: childTop,
          x: childX,
          tone,
          rootKind: null,
        },
        false,
      );
      childTop +=
        (subtreeHeights.get(childId) ?? emphasizedNodeHeight) +
        siblingGap;
    });
    const portalSize = portalSizes.get(floatingRoot.id);
    if (portalSize) {
      portals[floatingRoot.id] = {
        id: `subspace:${floatingRoot.id}`,
        x: childX,
        y: childTop,
        width: portalSize.width,
        height: portalSize.height,
        depth: 1,
        tone,
        rootKind: null,
      };
    }
  });

  let width = 1200;
  let height = Math.max(900, mainHeight + top * 2);
  [...Object.values(result), ...Object.values(portals)].forEach((node) => {
    width = Math.max(width, node.x + node.width + 120);
    height = Math.max(height, node.y + node.height + 120);
  });
  return { nodes: result, portals, visibleIds, width, height };
}

export interface CanvasContentBounds {
  height: number;
  minX: number;
  minY: number;
  width: number;
}

// 可见节点的联合包围盒：fit 用它对齐真实内容，而不是把 1200×900 的
// 布局地板一起居中（空文档时那会把唯一的主原点推到角落）。
export function canvasContentBounds(
  layout: LayoutResult,
): CanvasContentBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  [
    ...Object.values(layout.nodes),
    ...Object.values(layout.portals ?? {}),
  ].forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });
  if (!Number.isFinite(minX)) {
    return { height: layout.height, minX: 0, minY: 0, width: layout.width };
  }
  return {
    height: Math.max(1, maxY - minY),
    minX,
    minY,
    width: Math.max(1, maxX - minX),
  };
}

function sameOrderedIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * Returns the first-level main branch that should stay visually anchored for
 * a single collapse/expand transition. Structural edits deliberately return
 * null so ordinary reparenting and ordering continue to use compact layout.
 */
export interface MainBranchCollapseTransition {
  anchorId: string;
  collapsed: boolean;
}

export function mainBranchAnchorForCollapseTransition(
  previous: MindMapDocument | null,
  next: MindMapDocument,
): MainBranchCollapseTransition | null {
  if (
    !previous ||
    previous.rootId !== next.rootId ||
    !sameOrderedIds(
      previous.floatingRoots.map(({ id }) => id),
      next.floatingRoots.map(({ id }) => id),
    ) ||
    Object.keys(previous.nodes).length !== Object.keys(next.nodes).length
  ) {
    return null;
  }

  let changedId: string | null = null;
  for (const [id, node] of Object.entries(next.nodes)) {
    const before = previous.nodes[id];
    if (
      !before ||
      before.parentId !== node.parentId ||
      !sameOrderedIds(before.children, node.children)
    ) {
      return null;
    }
    if (before.collapsed !== node.collapsed) {
      if (changedId) return null;
      changedId = id;
    }
  }
  if (!changedId) return null;

  let branchId = changedId;
  let parentId = next.nodes[branchId]?.parentId ?? null;
  while (parentId && parentId !== next.rootId) {
    branchId = parentId;
    parentId = next.nodes[branchId]?.parentId ?? null;
  }
  return parentId === next.rootId
    ? {
        anchorId: branchId,
        collapsed: next.nodes[changedId].collapsed,
      }
    : null;
}

interface BranchBounds {
  ids: string[];
  portalAnchorIds: string[];
  minY: number;
  maxY: number;
}

function visibleBranchBounds(
  document: MindMapDocument,
  layout: LayoutResult,
  branchId: string,
): BranchBounds | null {
  const ids: string[] = [];
  const portalAnchorIds: string[] = [];
  const pending = [branchId];
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id) continue;
    const current = document.nodes[id];
    const node = layout.nodes[id];
    if (!current || !node) continue;
    ids.push(id);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y + node.height);
    const portal = layout.portals?.[id];
    if (!current.collapsed && portal) {
      portalAnchorIds.push(id);
      minY = Math.min(minY, portal.y);
      maxY = Math.max(maxY, portal.y + portal.height);
    }
    if (!current.collapsed) pending.push(...current.children);
  }
  return ids.length > 0 ? { ids, portalAnchorIds, minY, maxY } : null;
}

/**
 * Keeps the affected first-level branch at its previous canvas y coordinate,
 * then packs neighboring branches around that anchor. This preserves spatial
 * continuity without reserving the entire hidden subtree as permanent space.
 */
export function stabilizeMainBranchAnchor(
  previous: LayoutResult | null,
  next: LayoutResult,
  document: MindMapDocument,
  transition: MainBranchCollapseTransition | null,
): LayoutResult {
  const anchorId = transition?.anchorId ?? null;
  const beforeAnchor = anchorId ? previous?.nodes[anchorId] : null;
  const afterAnchor = anchorId ? next.nodes[anchorId] : null;
  const beforeRoot = previous?.nodes[document.rootId];
  const afterRoot = next.nodes[document.rootId];
  const root = document.nodes[document.rootId];
  if (!beforeAnchor || !afterAnchor || !beforeRoot || !afterRoot || !root) {
    return next;
  }

  const groups = root.children
    .map((id) => visibleBranchBounds(document, next, id))
    .filter((group): group is BranchBounds => Boolean(group));
  const anchorIndex = groups.findIndex(({ ids }) => ids[0] === anchorId);
  if (anchorIndex < 0) return next;

  const shifts = new Map<number, number>();
  if (transition?.collapsed) {
    groups.forEach((group, index) => {
      const branchId = group.ids[0];
      const before = previous?.nodes[branchId];
      const after = next.nodes[branchId];
      if (before && after) shifts.set(index, before.y - after.y);
    });
  }
  const anchorGroup = groups[anchorIndex];
  if (!transition?.collapsed) {
    let anchorShift = beforeAnchor.y - afterAnchor.y;
    const requiredTop =
      32 +
      groups
        .slice(0, anchorIndex)
        .reduce(
          (height, group) => height + group.maxY - group.minY + branchGap,
          0,
        );
    if (anchorGroup.minY + anchorShift < requiredTop) {
      anchorShift += requiredTop - (anchorGroup.minY + anchorShift);
    }
    shifts.set(anchorIndex, anchorShift);

    let nextTop = anchorGroup.minY + anchorShift;
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const shift = nextTop - branchGap - group.maxY;
      shifts.set(index, shift);
      nextTop = group.minY + shift;
    }

    let previousBottom = anchorGroup.maxY + anchorShift;
    for (let index = anchorIndex + 1; index < groups.length; index += 1) {
      const group = groups[index];
      const shift = previousBottom + branchGap - group.minY;
      shifts.set(index, shift);
      previousBottom = group.maxY + shift;
    }
  }

  let nodes = next.nodes;
  let portals = next.portals;
  groups.forEach((group, index) => {
    const shift = shifts.get(index) ?? 0;
    if (shift === 0) return;
    if (nodes === next.nodes) nodes = { ...next.nodes };
    group.ids.forEach((id) => {
      nodes[id] = { ...nodes[id], y: nodes[id].y + shift };
    });
    group.portalAnchorIds.forEach((id) => {
      const portal = portals?.[id];
      if (!portal) return;
      if (portals === next.portals) portals = { ...next.portals };
      portals![id] = { ...portal, y: portal.y + shift };
    });
  });
  if (afterRoot.y !== beforeRoot.y) {
    if (nodes === next.nodes) nodes = { ...next.nodes };
    nodes[document.rootId] = { ...afterRoot, y: beforeRoot.y };
  }
  if (nodes === next.nodes && portals === next.portals) return next;
  let height = 900;
  [
    ...Object.values(nodes),
    ...Object.values(portals ?? {}),
  ].forEach((node) => {
    height = Math.max(height, node.y + node.height + 120);
  });
  return {
    ...next,
    nodes,
    portals,
    height,
  };
}

export function applyDraftWidth(
  layout: LayoutResult,
  document: MindMapDocument,
  editingId: string | null,
  draft: string,
  measureTextWidth?: TextWidthMeasurer,
): LayoutResult {
  if (!editingId) return layout;
  const current = layout.nodes[editingId];
  if (!current) return layout;
  const width = sizeForNode(
    current.depth,
    draft,
    current.rootKind,
    measureTextWidth,
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
  let portals = layout.portals;
  Object.entries(layout.portals ?? {}).forEach(([anchorId, portal]) => {
    if (anchorId !== editingId && !descendantIds.has(anchorId)) return;
    if (portals === layout.portals) portals = { ...layout.portals };
    portals![anchorId] = { ...portal, x: portal.x + delta };
  });
  return {
    ...layout,
    nodes,
    portals,
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
  let allPortalsStable = true;
  const portals: Record<string, LayoutNode> = {};
  const nextPortals = next.portals ?? {};
  const previousPortals = previous.portals ?? {};
  const nextPortalIds = Object.keys(nextPortals);
  if (nextPortalIds.length !== Object.keys(previousPortals).length) {
    allPortalsStable = false;
  }
  nextPortalIds.forEach((id) => {
    const previousPortal = previousPortals[id];
    const nextPortal = nextPortals[id];
    if (previousPortal && sameLayoutNode(previousPortal, nextPortal)) {
      portals[id] = previousPortal;
    } else {
      portals[id] = nextPortal;
      allPortalsStable = false;
    }
  });
  const sameOrder =
    previous.visibleIds.length === next.visibleIds.length &&
    previous.visibleIds.every((id, index) => id === next.visibleIds[index]);
  if (
    allNodesStable &&
    allPortalsStable &&
    sameOrder &&
    previous.width === next.width &&
    previous.height === next.height
  ) {
    return previous;
  }

  return {
    nodes,
    portals,
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
