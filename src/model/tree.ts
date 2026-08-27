import type {
  FloatingRoot,
  MindMapDocument,
  MindNode,
  SelectionState,
} from "../types/mindmap";
import {
  isProvisionalDocumentTitle,
  topLevelRootIds,
} from "./document";
import {
  createSelection,
  normalizeSelectedRoots,
  singleSelection,
  visibleNodeIds,
} from "./selection";
import { createRuntimeId } from "./runtimeId";

export interface DocumentMutation {
  document: MindMapDocument;
  selection: SelectionState;
}

export function createNodeId(): string {
  return createRuntimeId("node");
}

function reserveUniqueNodeId(reservedIds: Set<string>): string {
  const base = createNodeId();
  let id = base;
  let suffix = 1;
  while (reservedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  reservedIds.add(id);
  return id;
}

function withTimestamp(
  document: MindMapDocument,
  nodes: Record<string, MindNode>,
): MindMapDocument {
  return {
    ...document,
    nodes,
    updatedAt: new Date().toISOString(),
  };
}

function updateNode(
  nodes: Record<string, MindNode>,
  id: string,
  patch: Partial<MindNode>,
): Record<string, MindNode> {
  const current = nodes[id];
  if (!current) return nodes;

  return {
    ...nodes,
    [id]: {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createNode(
  text: string,
  parentId: string,
  id = createNodeId(),
): MindNode {
  const now = new Date().toISOString();
  return {
    id,
    text,
    parentId,
    children: [],
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeNodeText(text: string): string {
  return text.trim();
}

export function setNodeText(
  document: MindMapDocument,
  id: string,
  text: string,
): DocumentMutation {
  const value = normalizeNodeText(text);
  const nodes = updateNode(document.nodes, id, { text: value });
  const documentWithTitle =
    id === document.rootId &&
    value.length > 0 &&
    isProvisionalDocumentTitle(document.title)
      ? { ...document, title: value }
      : document;
  return {
    document: withTimestamp(documentWithTitle, nodes),
    selection: singleSelection(id),
  };
}

export function setDocumentTitle(
  document: MindMapDocument,
  title: string,
  selection: SelectionState,
): DocumentMutation {
  return {
    document: {
      ...document,
      title: title.trim() || "未命名思维",
      updatedAt: new Date().toISOString(),
    },
    selection,
  };
}

export function createChild(
  document: MindMapDocument,
  parentId: string,
  text = "",
  nodeId = createNodeId(),
): DocumentMutation {
  const parent = document.nodes[parentId];
  if (!parent) {
    return { document, selection: singleSelection(document.rootId) };
  }

  const child = createNode(text, parentId, nodeId);
  let nodes = {
    ...document.nodes,
    [child.id]: child,
  };
  nodes = updateNode(nodes, parentId, {
    children: [...parent.children, child.id],
    collapsed: false,
  });

  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(child.id),
  };
}

export function createSibling(
  document: MindMapDocument,
  siblingId: string,
  placement: "above" | "below" = "below",
  text = "",
  nodeId = createNodeId(),
): DocumentMutation {
  const sibling = document.nodes[siblingId];
  if (!sibling?.parentId) {
    return createChild(document, siblingId, text, nodeId);
  }

  const parent = document.nodes[sibling.parentId];
  const created = createNode(text, parent.id, nodeId);
  const siblingIndex = parent.children.indexOf(siblingId);
  const insertAt = siblingIndex + (placement === "below" ? 1 : 0);
  const children = [...parent.children];
  children.splice(insertAt, 0, created.id);

  let nodes = {
    ...document.nodes,
    [created.id]: created,
  };
  nodes = updateNode(nodes, parent.id, { children });

  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(created.id),
  };
}

export function pasteSubtrees(
  document: MindMapDocument,
  parentId: string,
  source: MindMapDocument,
  sourceRootIds: readonly string[],
): DocumentMutation {
  const parent = document.nodes[parentId];
  const roots = sourceRootIds.filter((id) => source.nodes[id]);
  if (!parent || roots.length === 0) {
    return { document, selection: singleSelection(document.rootId) };
  }

  const now = new Date().toISOString();
  let nodes = { ...document.nodes };
  const reservedIds = new Set(Object.keys(nodes));
  const clone = (sourceId: string, cloneParentId: string): string | null => {
    const sourceNode = source.nodes[sourceId];
    if (!sourceNode) return null;
    const id = reserveUniqueNodeId(reservedIds);
    const { subspaceId: _sourceSubspaceId, ...sourceNodeWithoutPortal } =
      sourceNode;
    nodes[id] = {
      ...sourceNodeWithoutPortal,
      id,
      parentId: cloneParentId,
      children: [],
      createdAt: now,
      updatedAt: now,
    };
    const pending = [{ sourceId, cloneId: id }];
    while (pending.length > 0) {
      const frame = pending.pop();
      if (!frame) continue;
      const currentSource = source.nodes[frame.sourceId];
      if (!currentSource) continue;
      const children: Array<{ sourceId: string; cloneId: string }> = [];
      currentSource.children.forEach((childSourceId) => {
        const childSource = source.nodes[childSourceId];
        if (!childSource) return;
        const childCloneId = reserveUniqueNodeId(reservedIds);
        const {
          subspaceId: _childSubspaceId,
          ...childSourceWithoutPortal
        } = childSource;
        nodes[childCloneId] = {
          ...childSourceWithoutPortal,
          id: childCloneId,
          parentId: frame.cloneId,
          children: [],
          createdAt: now,
          updatedAt: now,
        };
        children.push({ sourceId: childSourceId, cloneId: childCloneId });
      });
      nodes[frame.cloneId] = {
        ...nodes[frame.cloneId],
        children: children.map(({ cloneId }) => cloneId),
      };
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push(children[index]);
      }
    }
    return id;
  };

  const pastedRoots = roots
    .map((id) => clone(id, parentId))
    .filter((id): id is string => Boolean(id));
  if (pastedRoots.length === 0) {
    return { document, selection: singleSelection(parentId) };
  }
  nodes = updateNode(nodes, parentId, {
    children: [...parent.children, ...pastedRoots],
    collapsed: false,
  });
  const nextDocument = withTimestamp(document, nodes);
  return {
    document: nextDocument,
    selection: createSelection(
      pastedRoots,
      visibleNodeIds(nextDocument),
      pastedRoots[0],
    ),
  };
}

export function indentNode(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) {
    return { document, selection: singleSelection(id) };
  }

  const parent = document.nodes[current.parentId];
  const index = parent.children.indexOf(id);
  if (index <= 0) {
    return { document, selection: singleSelection(id) };
  }

  const newParentId = parent.children[index - 1];
  const newParent = document.nodes[newParentId];
  let nodes = updateNode(document.nodes, parent.id, {
    children: parent.children.filter((childId) => childId !== id),
  });
  nodes = updateNode(nodes, newParentId, {
    children: [...newParent.children, id],
    collapsed: false,
  });
  nodes = updateNode(nodes, id, { parentId: newParentId });

  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(id),
  };
}

export function outdentNode(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) {
    return { document, selection: singleSelection(id) };
  }

  const parent = document.nodes[current.parentId];
  if (!parent.parentId) {
    return { document, selection: singleSelection(id) };
  }

  const grandParent = document.nodes[parent.parentId];
  const parentIndex = grandParent.children.indexOf(parent.id);
  const grandChildren = [...grandParent.children];
  grandChildren.splice(parentIndex + 1, 0, id);

  let nodes = updateNode(document.nodes, parent.id, {
    children: parent.children.filter((childId) => childId !== id),
  });
  nodes = updateNode(nodes, grandParent.id, { children: grandChildren });
  nodes = updateNode(nodes, id, { parentId: grandParent.id });

  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(id),
  };
}

export function moveNode(
  document: MindMapDocument,
  id: string,
  direction: -1 | 1,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current) {
    return { document, selection: singleSelection(document.rootId) };
  }
  if (!current.parentId) {
    const index = floatingRootIndex(document, id);
    const destination = index + direction;
    if (
      index < 0 ||
      destination < 0 ||
      destination >= document.floatingRoots.length
    ) {
      return { document, selection: singleSelection(id) };
    }
    const floatingRoots = [...document.floatingRoots];
    [floatingRoots[index], floatingRoots[destination]] = [
      floatingRoots[destination],
      floatingRoots[index],
    ];
    return {
      document: {
        ...document,
        floatingRoots,
        updatedAt: new Date().toISOString(),
      },
      selection: singleSelection(id),
    };
  }

  const parent = document.nodes[current.parentId];
  const index = parent.children.indexOf(id);
  const destination = index + direction;
  if (destination < 0 || destination >= parent.children.length) {
    return { document, selection: singleSelection(id) };
  }

  const children = [...parent.children];
  [children[index], children[destination]] = [
    children[destination],
    children[index],
  ];
  const nodes = updateNode(document.nodes, parent.id, { children });
  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(id),
  };
}

function collectSubtree(document: MindMapDocument, id: string): string[] {
  const result: string[] = [];
  const pending = [id];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId) continue;
    const node = document.nodes[nodeId];
    if (!node) continue;
    result.push(nodeId);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push(node.children[index]);
    }
  }
  return result;
}

function spacesAfterRemovingAnchors(
  document: MindMapDocument,
  removedNodeIds: ReadonlySet<string>,
): MindMapDocument["spaces"] {
  if (!document.spaces) return undefined;
  const removedSpaceIds = new Set<string>();
  const removedAnchorIds = new Set(removedNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    Object.entries(document.spaces).forEach(([spaceId, space]) => {
      if (removedSpaceIds.has(spaceId) || !removedAnchorIds.has(space.anchorNodeId)) {
        return;
      }
      removedSpaceIds.add(spaceId);
      if (space.type === "map") {
        Object.keys(space.nodes).forEach((nodeId) => removedAnchorIds.add(nodeId));
      }
      changed = true;
    });
  }
  return Object.fromEntries(
    Object.entries(document.spaces).filter(
      ([spaceId]) => !removedSpaceIds.has(spaceId),
    ),
  );
}

function floatingRootIndex(
  document: MindMapDocument,
  id: string,
): number {
  return document.floatingRoots.findIndex((root) => root.id === id);
}

export function detachSubtree(
  document: MindMapDocument,
  id: string,
  position: Pick<FloatingRoot, "x" | "y">,
): DocumentMutation {
  return detachSubtrees(
    document,
    [{ id, ...position }],
    singleSelection(id),
  );
}

export interface PositionedSubtreeRoot
  extends Pick<FloatingRoot, "id" | "x" | "y"> {}

export function detachSubtrees(
  document: MindMapDocument,
  positions: readonly PositionedSubtreeRoot[],
  selection: SelectionState,
): DocumentMutation {
  const requested = positions
    .filter(({ id }) => id !== document.rootId && document.nodes[id])
    .map(({ id, x, y }) => ({
      id,
      x: Math.max(32, Math.round(x)),
      y: Math.max(32, Math.round(y)),
    }));
  const rootIds = normalizeSelectedRoots(
    document,
    requested.map(({ id }) => id),
  );
  const rootIdSet = new Set(rootIds);
  const roots = requested.filter(({ id }) => rootIdSet.has(id));
  if (roots.length === 0) return { document, selection };

  let nodes = document.nodes;
  const affectedParents = new Set(
    roots
      .map(({ id }) => document.nodes[id]?.parentId)
      .filter((id): id is string => Boolean(id)),
  );
  affectedParents.forEach((parentId) => {
    const parent = nodes[parentId];
    if (!parent) return;
    nodes = updateNode(nodes, parentId, {
      children: parent.children.filter((id) => !rootIdSet.has(id)),
    });
  });
  roots.forEach(({ id }) => {
    if (nodes[id]?.parentId !== null) {
      nodes = updateNode(nodes, id, { parentId: null });
    }
  });

  const floatingRoots = document.floatingRoots
    .filter(({ id }) => !rootIdSet.has(id))
    .concat(roots.map(({ id, x, y }) => ({ id, x, y })));
  const unchanged =
    nodes === document.nodes &&
    document.floatingRoots.length === floatingRoots.length &&
    document.floatingRoots.every((root, index) => {
      const next = floatingRoots[index];
      return root.id === next.id && root.x === next.x && root.y === next.y;
    });
  if (unchanged) return { document, selection };

  const nextDocument = {
    ...withTimestamp(document, nodes),
    floatingRoots,
  };
  return {
    document: nextDocument,
    selection: createSelection(
      selection.selectedIds,
      visibleNodeIds(nextDocument),
      selection.primaryId,
    ),
  };
}

export function attachSubtree(
  document: MindMapDocument,
  id: string,
  parentId: string,
  position?: number,
): DocumentMutation {
  return attachSubtrees(
    document,
    [id],
    parentId,
    position,
    singleSelection(id),
  );
}

export function attachSubtrees(
  document: MindMapDocument,
  ids: readonly string[],
  parentId: string,
  position: number | undefined,
  selection: SelectionState,
): DocumentMutation {
  const parent = document.nodes[parentId];
  const rootIds = normalizeSelectedRoots(
    document,
    ids.filter((id) => id !== document.rootId),
  );
  if (
    !parent ||
    rootIds.length === 0 ||
    rootIds.includes(parentId) ||
    rootIds.some((id) => collectSubtree(document, id).includes(parentId))
  ) {
    return { document, selection };
  }

  const rootIdSet = new Set(rootIds);
  const nextChildren = parent.children.filter((id) => !rootIdSet.has(id));
  const insertAt = Math.max(
    0,
    Math.min(
      Number.isInteger(position) ? position! : nextChildren.length,
      nextChildren.length,
    ),
  );
  nextChildren.splice(insertAt, 0, ...rootIds);
  const unchanged =
    !parent.collapsed &&
    rootIds.every((id) => document.nodes[id]?.parentId === parentId) &&
    nextChildren.length === parent.children.length &&
    nextChildren.every((id, index) => parent.children[index] === id);
  if (unchanged) return { document, selection };

  let nodes = document.nodes;
  const affectedParents = new Set(
    rootIds
      .map((id) => document.nodes[id]?.parentId)
      .filter((id): id is string => Boolean(id) && id !== parentId),
  );
  affectedParents.forEach((oldParentId) => {
    const oldParent = nodes[oldParentId];
    if (!oldParent) return;
    nodes = updateNode(nodes, oldParentId, {
      children: oldParent.children.filter((id) => !rootIdSet.has(id)),
    });
  });
  rootIds.forEach((id) => {
    nodes = updateNode(nodes, id, { parentId });
  });
  nodes = updateNode(nodes, parentId, {
    children: nextChildren,
    collapsed: false,
  });
  const nextDocument = {
    ...withTimestamp(document, nodes),
    floatingRoots: document.floatingRoots.filter(
      ({ id }) => !rootIdSet.has(id),
    ),
  };
  return {
    document: nextDocument,
    selection: createSelection(
      selection.selectedIds,
      visibleNodeIds(nextDocument),
      selection.primaryId,
    ),
  };
}

export function deleteSubtree(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current || id === document.rootId) {
    return { document, selection: singleSelection(id) };
  }

  const removed = new Set(collectSubtree(document, id));
  const nodes = Object.fromEntries(
    Object.entries(document.nodes).filter(([nodeId]) => !removed.has(nodeId)),
  );
  const parent = current.parentId
    ? document.nodes[current.parentId]
    : null;
  const nextNodes = parent
    ? updateNode(nodes, parent.id, {
        children: parent.children.filter((childId) => childId !== id),
      })
    : nodes;

  return {
    document: {
      ...withTimestamp(document, nextNodes),
      floatingRoots: document.floatingRoots.filter(
        (root) => !removed.has(root.id),
      ),
      spaces: spacesAfterRemovingAnchors(document, removed),
    },
    selection: singleSelection(parent?.id ?? document.rootId),
  };
}

export function deleteSelectedSubtrees(
  document: MindMapDocument,
  selection: SelectionState,
): DocumentMutation {
  const selectedRoots = normalizeSelectedRoots(
    document,
    selection.selectedIds.filter((id) => id !== document.rootId),
  );
  if (selectedRoots.length === 0) return { document, selection };

  const removed = new Set(
    selectedRoots.flatMap((id) => collectSubtree(document, id)),
  );
  let nextPrimaryId = selection.primaryId;
  while (nextPrimaryId && removed.has(nextPrimaryId)) {
    nextPrimaryId = document.nodes[nextPrimaryId]?.parentId ?? null;
  }
  nextPrimaryId ??= document.rootId;

  let nodes = Object.fromEntries(
    Object.entries(document.nodes).filter(([id]) => !removed.has(id)),
  );
  const affectedParents = new Set(
    selectedRoots
      .map((id) => document.nodes[id]?.parentId)
      .filter((id): id is string => Boolean(id)),
  );
  affectedParents.forEach((parentId) => {
    const parent = nodes[parentId];
    if (!parent) return;
    nodes = updateNode(nodes, parentId, {
      children: parent.children.filter((id) => !removed.has(id)),
    });
  });

  return {
    document: {
      ...withTimestamp(document, nodes),
      floatingRoots: document.floatingRoots.filter(
        (root) => !removed.has(root.id),
      ),
      spaces: spacesAfterRemovingAnchors(document, removed),
    },
    selection: singleSelection(nextPrimaryId),
  };
}

export function deleteNodePreserveChildren(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) {
    return { document, selection: singleSelection(id) };
  }

  const parent = document.nodes[current.parentId];
  const index = parent.children.indexOf(id);
  const children = [...parent.children];
  children.splice(index, 1, ...current.children);

  let nodes = { ...document.nodes };
  delete nodes[id];
  nodes = updateNode(nodes, parent.id, { children });
  current.children.forEach((childId) => {
    nodes = updateNode(nodes, childId, { parentId: parent.id });
  });

  return {
    document: {
      ...withTimestamp(document, nodes),
      spaces: spacesAfterRemovingAnchors(document, new Set([id])),
    },
    selection: singleSelection(parent.id),
  };
}

export function toggleCollapsed(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current || current.children.length === 0) {
    return { document, selection: singleSelection(id) };
  }
  const nodes = updateNode(document.nodes, id, {
    collapsed: !current.collapsed,
  });
  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(id),
  };
}

export function revealNode(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const target = document.nodes[id];
  if (!target) {
    return {
      document,
      selection: singleSelection(document.rootId),
    };
  }

  const ancestors: string[] = [];
  let parentId = target.parentId;
  while (parentId) {
    ancestors.push(parentId);
    parentId = document.nodes[parentId]?.parentId ?? null;
  }
  const collapsedAncestors = ancestors.filter(
    (ancestorId) => document.nodes[ancestorId]?.collapsed,
  );
  if (collapsedAncestors.length === 0) {
    return { document, selection: singleSelection(id) };
  }

  let nodes = document.nodes;
  collapsedAncestors.forEach((ancestorId) => {
    nodes = updateNode(nodes, ancestorId, { collapsed: false });
  });
  return {
    document: withTimestamp(document, nodes),
    selection: singleSelection(id),
  };
}

export function toggleCollapsedMany(
  document: MindMapDocument,
  selection: SelectionState,
): DocumentMutation {
  const branchIds = selection.selectedIds.filter(
    (id) => document.nodes[id]?.children.length,
  );
  if (branchIds.length === 0) return { document, selection };

  let nodes = document.nodes;
  branchIds.forEach((id) => {
    nodes = updateNode(nodes, id, {
      collapsed: !nodes[id].collapsed,
    });
  });
  const nextDocument = withTimestamp(document, nodes);
  const visible = visibleNodeIds(nextDocument);
  return {
    document: nextDocument,
    selection: createSelection(
      selection.selectedIds,
      visible,
      selection.primaryId,
    ),
  };
}

export function setAllCollapsed(
  document: MindMapDocument,
  collapsed: boolean,
  selection: SelectionState,
): DocumentMutation {
  const now = new Date().toISOString();
  const nodes = Object.fromEntries(
    Object.entries(document.nodes).map(([id, current]) => [
      id,
      {
        ...current,
        collapsed:
          id === document.rootId || current.children.length === 0
            ? false
            : collapsed,
        updatedAt:
          current.children.length > 0 && id !== document.rootId
            ? now
            : current.updatedAt,
      },
    ]),
  );
  const nextDocument = withTimestamp(document, nodes);
  const visible = visibleNodeIds(nextDocument);
  return {
    document: nextDocument,
    selection: createSelection(
      selection.selectedIds,
      visible,
      selection.primaryId,
    ),
  };
}

export function parentOf(
  document: MindMapDocument,
  id: string,
): string | null {
  return document.nodes[id]?.parentId ?? null;
}

export function firstChildOf(
  document: MindMapDocument,
  id: string,
): string | null {
  const current = document.nodes[id];
  if (!current || current.collapsed) return null;
  return current.children[0] ?? null;
}

export function adjacentSibling(
  document: MindMapDocument,
  id: string,
  direction: -1 | 1,
): string | null {
  const current = document.nodes[id];
  if (!current) return null;
  const siblings = current.parentId
    ? document.nodes[current.parentId].children
    : topLevelRootIds(document);
  const index = siblings.indexOf(id);
  return siblings[index + direction] ?? null;
}
