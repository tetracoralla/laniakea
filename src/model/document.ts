import type {
  FlowEdge,
  FlowNode,
  FlowSpace,
  FloatingRoot,
  LaniakeaSpace,
  MapSpace,
  MindMapDocument,
  MindNode,
} from "../types/mindmap";

export const provisionalDocumentTitle = "未命名思维";

export function isProvisionalDocumentTitle(title: string): boolean {
  const normalized = title.trim();
  return normalized.length === 0 || normalized === provisionalDocumentTitle;
}

export function resolveProvisionalDocumentTitle(
  document: MindMapDocument,
  titleHint?: string | null,
): MindMapDocument {
  if (!isProvisionalDocumentTitle(document.title)) return document;

  const normalizedHint = titleHint?.trim() ?? "";
  const rootText = document.nodes[document.rootId]?.text.trim() ?? "";
  const title = !isProvisionalDocumentTitle(normalizedHint)
    ? normalizedHint
    : !isProvisionalDocumentTitle(rootText)
      ? rootText
      : provisionalDocumentTitle;

  return title === document.title ? document : { ...document, title };
}

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
    (value.subspaceId === undefined || typeof value.subspaceId === "string") &&
    typeof value.collapsed === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isFlowNode(value: unknown, id: string): value is FlowNode {
  return (
    isRecord(value) &&
    value.id === id &&
    typeof value.text === "string" &&
    ["start", "step", "decision", "end"].includes(String(value.kind)) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isFlowEdge(value: unknown): value is FlowEdge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    typeof value.label === "string"
  );
}

function isViewport(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.zoom) &&
    value.zoom > 0
  );
}

function isFlowSpace(value: unknown, id: string): value is FlowSpace {
  if (
    !isRecord(value) ||
    value.id !== id ||
    value.type !== "flow" ||
    typeof value.anchorNodeId !== "string" ||
    !isRecord(value.nodes) ||
    !Array.isArray(value.edges) ||
    !value.edges.every(isFlowEdge) ||
    !isViewport(value.viewport) ||
    typeof value.updatedAt !== "string"
  ) {
    return false;
  }
  const nodes = value.nodes;
  if (
    Object.keys(nodes).length === 0 ||
    Object.entries(nodes).some(([nodeId, node]) => !isFlowNode(node, nodeId))
  ) {
    return false;
  }
  const nodeIds = Object.keys(nodes);
  const edgeIds = new Set<string>();
  const endpointPairs = new Set<string>();
  const outgoing = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  for (const edge of value.edges) {
    const endpointPair = `${edge.from}\u0000${edge.to}`;
    if (
      edgeIds.has(edge.id) ||
      endpointPairs.has(endpointPair) ||
      edge.from === edge.to ||
      !nodes[edge.from] ||
      !nodes[edge.to]
    ) {
      return false;
    }
    edgeIds.add(edge.id);
    endpointPairs.add(endpointPair);
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const pending = nodeIds.filter((nodeId) => indegree.get(nodeId) === 0);
  let visited = 0;
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    visited += 1;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const remaining = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, remaining);
      if (remaining === 0) pending.push(targetId);
    }
  }
  return visited === nodeIds.length;
}

function isMapSpace(value: unknown, id: string): value is MapSpace {
  return (
    isRecord(value) &&
    value.id === id &&
    value.type === "map" &&
    typeof value.anchorNodeId === "string" &&
    typeof value.rootId === "string" &&
    isRecord(value.nodes) &&
    Array.isArray(value.floatingRoots) &&
    value.floatingRoots.every(isFloatingRoot) &&
    isViewport(value.viewport) &&
    typeof value.updatedAt === "string" &&
    isMindTree(value.rootId, value.nodes, value.floatingRoots)
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

function isMindTree(
  rootId: string,
  nodes: Record<string, unknown>,
  floatingRoots: FloatingRoot[],
): boolean {
  const root = nodes[rootId];
  if (!isNode(root, rootId) || root.parentId !== null) return false;
  const floatingIds = floatingRoots.map((floating) => floating.id);
  const rootIds = [rootId, ...floatingIds];
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

  const visited = new Set<string>();
  const pending = [...rootIds].reverse();
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    const node = nodes[id];
    if (!isNode(node, id)) return false;
    visited.add(id);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push(node.children[index]);
    }
  }
  return visited.size === Object.keys(nodes).length;
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
    !isViewport(value.viewport) ||
    (value.spaces !== undefined && !isRecord(value.spaces))
  ) {
    return false;
  }

  const nodes = value.nodes;
  if (!isMindTree(value.rootId, nodes, value.floatingRoots)) return false;

  const spaces = value.spaces ?? {};
  const validatedSpaces: Record<string, LaniakeaSpace> = {};
  const nodeById = new Map<string, MindNode>();
  const ownerSpaceByNodeId = new Map<string, string | null>();
  for (const [nodeId, candidate] of Object.entries(nodes)) {
    if (!isNode(candidate, nodeId)) return false;
    nodeById.set(nodeId, candidate);
    ownerSpaceByNodeId.set(nodeId, null);
  }
  for (const [spaceId, candidate] of Object.entries(spaces)) {
    if (!isFlowSpace(candidate, spaceId) && !isMapSpace(candidate, spaceId)) {
      return false;
    }
    validatedSpaces[spaceId] = candidate;
    if (candidate.type === "map") {
      for (const [nodeId, node] of Object.entries(candidate.nodes)) {
        if (nodeById.has(nodeId) || !isNode(node, nodeId)) return false;
        nodeById.set(nodeId, node);
        ownerSpaceByNodeId.set(nodeId, spaceId);
      }
    }
  }

  const referencedSpaceIds = new Set<string>();
  for (const node of nodeById.values()) {
    if (!node.subspaceId) continue;
    if (!validatedSpaces[node.subspaceId] || referencedSpaceIds.has(node.subspaceId)) {
      return false;
    }
    referencedSpaceIds.add(node.subspaceId);
  }
  for (const [spaceId, space] of Object.entries(validatedSpaces)) {
    const anchor = nodeById.get(space.anchorNodeId);
    if (!anchor || anchor.subspaceId !== spaceId) return false;
  }

  const parentSpaceByMapSpace = new Map<string, string | null>();
  for (const [spaceId, space] of Object.entries(validatedSpaces)) {
    if (space.type !== "map") continue;
    const parentSpaceId = ownerSpaceByNodeId.get(space.anchorNodeId);
    if (parentSpaceId === undefined || parentSpaceId === spaceId) return false;
    parentSpaceByMapSpace.set(spaceId, parentSpaceId);
  }
  for (const spaceId of parentSpaceByMapSpace.keys()) {
    const visited = new Set<string>();
    let current: string | null | undefined = spaceId;
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      current = parentSpaceByMapSpace.get(current);
    }
  }
  return true;
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
