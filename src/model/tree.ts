import type {
  FloatingRoot,
  MindMapDocument,
  MindNode,
  SelectionState,
} from "../types/mindmap";
import { topLevelRootIds } from "./document";
import {
  createSelection,
  normalizeSelectedRoots,
  singleSelection,
  visibleNodeIds,
} from "./selection";

export interface DocumentMutation {
  document: MindMapDocument;
  selection: SelectionState;
}

export function createNodeId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `node-${uuid}`;
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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
  return {
    document: withTimestamp(document, nodes),
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
    nodes[id] = {
      ...sourceNode,
      id,
      parentId: cloneParentId,
      children: [],
      createdAt: now,
      updatedAt: now,
    };
    const children = sourceNode.children
      .map((childId) => clone(childId, id))
      .filter((childId): childId is string => Boolean(childId));
    nodes[id] = { ...nodes[id], children };
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
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId];
    if (!node) return;
    result.push(nodeId);
    node.children.forEach(visit);
  };
  visit(id);
  return result;
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
  const current = document.nodes[id];
  if (!current || id === document.rootId) {
    return { document, selection: singleSelection(document.rootId) };
  }

  const x = Math.max(32, Math.round(position.x));
  const y = Math.max(32, Math.round(position.y));
  const existingIndex = floatingRootIndex(document, id);
  if (existingIndex >= 0) {
    const existing = document.floatingRoots[existingIndex];
    if (existing.x === x && existing.y === y) {
      return { document, selection: singleSelection(id) };
    }
    const floatingRoots = [...document.floatingRoots];
    floatingRoots[existingIndex] = { id, x, y };
    return {
      document: {
        ...document,
        floatingRoots,
      },
      selection: singleSelection(id),
    };
  }

  if (!current.parentId) {
    return { document, selection: singleSelection(id) };
  }
  const parent = document.nodes[current.parentId];
  let nodes = updateNode(document.nodes, parent.id, {
    children: parent.children.filter((childId) => childId !== id),
  });
  nodes = updateNode(nodes, id, { parentId: null });
  return {
    document: {
      ...withTimestamp(document, nodes),
      floatingRoots: [...document.floatingRoots, { id, x, y }],
    },
    selection: singleSelection(id),
  };
}

export function attachSubtree(
  document: MindMapDocument,
  id: string,
  parentId: string,
): DocumentMutation {
  const current = document.nodes[id];
  const parent = document.nodes[parentId];
  if (
    !current ||
    !parent ||
    id === document.rootId ||
    id === parentId ||
    collectSubtree(document, id).includes(parentId)
  ) {
    return {
      document,
      selection: singleSelection(current ? id : document.rootId),
    };
  }
  if (current.parentId === parentId) {
    return { document, selection: singleSelection(id) };
  }

  let nodes = document.nodes;
  if (current.parentId) {
    const oldParent = document.nodes[current.parentId];
    nodes = updateNode(nodes, oldParent.id, {
      children: oldParent.children.filter((childId) => childId !== id),
    });
  }
  nodes = updateNode(nodes, id, { parentId });
  nodes = updateNode(nodes, parentId, {
    children: [...parent.children, id],
    collapsed: false,
  });
  return {
    document: {
      ...withTimestamp(document, nodes),
      floatingRoots: document.floatingRoots.filter(
        (root) => root.id !== id,
      ),
    },
    selection: singleSelection(id),
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
    document: withTimestamp(document, nodes),
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
