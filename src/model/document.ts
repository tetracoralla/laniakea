import type { MindMapDocument, MindNode } from "../types/mindmap";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNode(value: unknown, id: string): value is MindNode {
  if (!isRecord(value)) return false;
  return (
    value.id === id &&
    typeof value.text === "string" &&
    (typeof value.parentId === "string" || value.parentId === null) &&
    Array.isArray(value.children) &&
    value.children.every((childId) => typeof childId === "string") &&
    typeof value.collapsed === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isMindMapDocument(
  value: unknown,
): value is MindMapDocument {
  if (!isRecord(value) || !isRecord(value.nodes)) return false;
  if (
    value.formatVersion !== 1 ||
    typeof value.title !== "string" ||
    typeof value.rootId !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.viewport) ||
    typeof value.viewport.x !== "number" ||
    !Number.isFinite(value.viewport.x) ||
    typeof value.viewport.y !== "number" ||
    !Number.isFinite(value.viewport.y) ||
    typeof value.viewport.zoom !== "number" ||
    !Number.isFinite(value.viewport.zoom)
  ) {
    return false;
  }

  const nodes = value.nodes;
  const root = nodes[value.rootId];
  if (!isNode(root, value.rootId) || root.parentId !== null) return false;

  for (const [id, candidate] of Object.entries(nodes)) {
    if (!isNode(candidate, id)) return false;
    for (const childId of candidate.children) {
      const child = nodes[childId];
      if (!isNode(child, childId) || child.parentId !== id) return false;
    }
    if (
      candidate.parentId !== null &&
      !isNode(nodes[candidate.parentId], candidate.parentId)
    ) {
      return false;
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const node = nodes[id];
    if (!isNode(node, id)) return false;
    visiting.add(id);
    if (!node.children.every(visit)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };

  return visit(value.rootId) && visited.size === Object.keys(nodes).length;
}

export function parseMindMapDocument(value: string): MindMapDocument {
  const parsed = JSON.parse(value) as unknown;
  if (!isMindMapDocument(parsed)) {
    throw new Error("思维导图文件结构无效");
  }
  return parsed;
}
