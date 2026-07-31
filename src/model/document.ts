import type {
  FloatingRoot,
  MindMapDocument,
  MindNode,
} from "../types/mindmap";

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

function isFloatingRoot(value: unknown): value is FloatingRoot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

export function topLevelRootIds(document: MindMapDocument): string[] {
  return [
    document.rootId,
    ...document.floatingRoots.map((root) => root.id),
  ];
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
    !Array.isArray(value.floatingRoots) ||
    !value.floatingRoots.every(isFloatingRoot) ||
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
  const floatingIds = value.floatingRoots.map((floating) => floating.id);
  const rootIds = [value.rootId, ...floatingIds];
  if (new Set(rootIds).size !== rootIds.length) return false;
  if (
    floatingIds.some((id) => {
      const node = nodes[id];
      return !isNode(node, id) || node.parentId !== null;
    })
  ) {
    return false;
  }

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

  return (
    rootIds.every(visit) &&
    visited.size === Object.keys(nodes).length
  );
}

export function parseMindMapDocument(value: string): MindMapDocument {
  const parsed = JSON.parse(value) as unknown;
  const migrated =
    isRecord(parsed) && !("floatingRoots" in parsed)
      ? { ...parsed, floatingRoots: [] }
      : parsed;
  if (!isMindMapDocument(migrated)) {
    throw new Error("思维导图文件结构无效");
  }
  return migrated;
}

export function isBlankMindMapDocument(
  document: MindMapDocument,
): boolean {
  const root = document.nodes[document.rootId];
  return (
    Object.keys(document.nodes).length === 1 &&
    document.floatingRoots.length === 0 &&
    root.children.length === 0 &&
    root.text.trim() === ""
  );
}
