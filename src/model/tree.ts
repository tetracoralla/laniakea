import type { MindMapDocument, MindNode } from "../types/mindmap";

export interface DocumentMutation {
  document: MindMapDocument;
  selectedId: string;
}

function uid(): string {
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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

function createNode(text: string, parentId: string): MindNode {
  const now = new Date().toISOString();
  return {
    id: uid(),
    text,
    parentId,
    children: [],
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function setNodeText(
  document: MindMapDocument,
  id: string,
  text: string,
): DocumentMutation {
  const value = text.trim() || "未命名节点";
  const nodes = updateNode(document.nodes, id, { text: value });
  return { document: withTimestamp(document, nodes), selectedId: id };
}

export function setDocumentTitle(
  document: MindMapDocument,
  title: string,
  selectedId: string,
): DocumentMutation {
  return {
    document: {
      ...document,
      title: title.trim() || "未命名思维",
      updatedAt: new Date().toISOString(),
    },
    selectedId,
  };
}

export function createChild(
  document: MindMapDocument,
  parentId: string,
  text = "新节点",
): DocumentMutation {
  const parent = document.nodes[parentId];
  if (!parent) return { document, selectedId: document.rootId };

  const child = createNode(text, parentId);
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
    selectedId: child.id,
  };
}

export function createSibling(
  document: MindMapDocument,
  siblingId: string,
  placement: "above" | "below" = "below",
  text = "新节点",
): DocumentMutation {
  const sibling = document.nodes[siblingId];
  if (!sibling?.parentId) {
    return createChild(document, siblingId, text);
  }

  const parent = document.nodes[sibling.parentId];
  const created = createNode(text, parent.id);
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
    selectedId: created.id,
  };
}

export function indentNode(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) return { document, selectedId: id };

  const parent = document.nodes[current.parentId];
  const index = parent.children.indexOf(id);
  if (index <= 0) return { document, selectedId: id };

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

  return { document: withTimestamp(document, nodes), selectedId: id };
}

export function outdentNode(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) return { document, selectedId: id };

  const parent = document.nodes[current.parentId];
  if (!parent.parentId) return { document, selectedId: id };

  const grandParent = document.nodes[parent.parentId];
  const parentIndex = grandParent.children.indexOf(parent.id);
  const grandChildren = [...grandParent.children];
  grandChildren.splice(parentIndex + 1, 0, id);

  let nodes = updateNode(document.nodes, parent.id, {
    children: parent.children.filter((childId) => childId !== id),
  });
  nodes = updateNode(nodes, grandParent.id, { children: grandChildren });
  nodes = updateNode(nodes, id, { parentId: grandParent.id });

  return { document: withTimestamp(document, nodes), selectedId: id };
}

export function moveNode(
  document: MindMapDocument,
  id: string,
  direction: -1 | 1,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) return { document, selectedId: id };

  const parent = document.nodes[current.parentId];
  const index = parent.children.indexOf(id);
  const destination = index + direction;
  if (destination < 0 || destination >= parent.children.length) {
    return { document, selectedId: id };
  }

  const children = [...parent.children];
  [children[index], children[destination]] = [
    children[destination],
    children[index],
  ];
  const nodes = updateNode(document.nodes, parent.id, { children });
  return { document: withTimestamp(document, nodes), selectedId: id };
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

export function deleteSubtree(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) return { document, selectedId: id };

  const parent = document.nodes[current.parentId];
  const removed = new Set(collectSubtree(document, id));
  const nodes = Object.fromEntries(
    Object.entries(document.nodes).filter(([nodeId]) => !removed.has(nodeId)),
  );
  const nextNodes = updateNode(nodes, parent.id, {
    children: parent.children.filter((childId) => childId !== id),
  });

  return {
    document: withTimestamp(document, nextNodes),
    selectedId: parent.id,
  };
}

export function deleteNodePreserveChildren(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current?.parentId) return { document, selectedId: id };

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
    selectedId: parent.id,
  };
}

export function toggleCollapsed(
  document: MindMapDocument,
  id: string,
): DocumentMutation {
  const current = document.nodes[id];
  if (!current || current.children.length === 0) {
    return { document, selectedId: id };
  }
  const nodes = updateNode(document.nodes, id, {
    collapsed: !current.collapsed,
  });
  return { document: withTimestamp(document, nodes), selectedId: id };
}

export function setAllCollapsed(
  document: MindMapDocument,
  collapsed: boolean,
  selectedId: string,
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
  return { document: withTimestamp(document, nodes), selectedId };
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
  if (!current?.parentId) return null;
  const siblings = document.nodes[current.parentId].children;
  const index = siblings.indexOf(id);
  return siblings[index + direction] ?? null;
}
