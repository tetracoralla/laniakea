import { createRuntimeId } from "./runtimeId";
import type {
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  FlowSpace,
  LaniakeaSpace,
  MapSpace,
  MindMapDocument,
  MindNode,
  SelectionState,
  Viewport,
} from "../types/mindmap";
import { singleSelection } from "./selection";
import type { DocumentMutation } from "./tree";

export const defaultSpaceViewport: Viewport = { x: 96, y: 72, zoom: 1 };

export function documentSpaces(
  document: MindMapDocument,
): Record<string, LaniakeaSpace> {
  return document.spaces ?? {};
}

export function flowSpaceForNode(
  document: MindMapDocument,
  nodeId: string,
): FlowSpace | null {
  const subspaceId = document.nodes[nodeId]?.subspaceId;
  if (!subspaceId) return null;
  const space = documentSpaces(document)[subspaceId];
  return space?.type === "flow" ? space : null;
}

export function spaceForNode(
  document: MindMapDocument,
  nodeId: string,
): LaniakeaSpace | null {
  const subspaceId = document.nodes[nodeId]?.subspaceId;
  return subspaceId ? documentSpaces(document)[subspaceId] ?? null : null;
}

export function mapSpaceForNode(
  document: MindMapDocument,
  nodeId: string,
): MapSpace | null {
  const space = spaceForNode(document, nodeId);
  return space?.type === "map" ? space : null;
}

export function findMindNode(
  document: MindMapDocument,
  nodeId: string,
): MindNode | null {
  const rootNode = document.nodes[nodeId];
  if (rootNode) return rootNode;
  for (const space of Object.values(documentSpaces(document))) {
    if (space.type === "map" && space.nodes[nodeId]) return space.nodes[nodeId];
  }
  return null;
}

export function mapSpaceDocument(
  document: MindMapDocument,
  spaceId: string,
): MindMapDocument | null {
  const space = documentSpaces(document)[spaceId];
  if (!space || space.type !== "map") return null;
  return {
    ...document,
    rootId: space.rootId,
    nodes: space.nodes,
    floatingRoots: space.floatingRoots,
    viewport: space.viewport,
    updatedAt: space.updatedAt,
  };
}

export function mergeMapSpaceDocument(
  document: MindMapDocument,
  spaceId: string,
  scopedDocument: MindMapDocument,
): MindMapDocument {
  const existing = documentSpaces(document)[spaceId];
  if (!existing || existing.type !== "map") return document;
  const nextSpace: MapSpace = {
    ...existing,
    rootId: scopedDocument.rootId,
    nodes: scopedDocument.nodes,
    floatingRoots: scopedDocument.floatingRoots,
    viewport: scopedDocument.viewport,
    updatedAt: scopedDocument.updatedAt,
  };
  return {
    ...document,
    spaces: {
      ...documentSpaces(scopedDocument),
      [spaceId]: nextSpace,
    },
    updatedAt: scopedDocument.updatedAt,
  };
}

export function createMapSpace(
  document: MindMapDocument,
  anchorNodeId: string,
): { document: MindMapDocument; spaceId: string; selectedMapNodeId: string } {
  const anchor = document.nodes[anchorNodeId];
  if (!anchor) {
    return { document, spaceId: "", selectedMapNodeId: "" };
  }
  const existing = spaceForNode(document, anchorNodeId);
  if (existing) {
    return existing.type === "map"
      ? {
          document,
          spaceId: existing.id,
          selectedMapNodeId: existing.rootId,
        }
      : { document, spaceId: "", selectedMapNodeId: "" };
  }

  const now = new Date().toISOString();
  const rootId = createRuntimeId("map-node");
  const id = createRuntimeId("map-space");
  const root: MindNode = {
    id: rootId,
    text: anchor.text.trim(),
    parentId: null,
    children: [],
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
  const space: MapSpace = {
    id,
    type: "map",
    anchorNodeId,
    rootId,
    nodes: { [rootId]: root },
    floatingRoots: [],
    viewport: defaultSpaceViewport,
    updatedAt: now,
  };
  return {
    document: {
      ...document,
      nodes: {
        ...document.nodes,
        [anchorNodeId]: { ...anchor, subspaceId: id, updatedAt: now },
      },
      spaces: { ...documentSpaces(document), [id]: space },
      updatedAt: now,
    },
    spaceId: id,
    selectedMapNodeId: rootId,
  };
}

function createFlowNode(
  kind: FlowNodeKind,
  text: string,
  now: string,
): FlowNode {
  const id = createRuntimeId("flow-node");
  return { id, kind, text, createdAt: now, updatedAt: now };
}

function createFlowEdge(
  from: string,
  to: string,
  label = "",
): FlowEdge {
  return {
    id: createRuntimeId("flow-edge"),
    from,
    to,
    label,
  };
}

export function createFlowSpace(
  document: MindMapDocument,
  anchorNodeId: string,
): { document: MindMapDocument; spaceId: string; selectedFlowNodeId: string } {
  const anchor = document.nodes[anchorNodeId];
  if (!anchor) {
    return {
      document,
      spaceId: "",
      selectedFlowNodeId: "",
    };
  }
  const existingSpace = spaceForNode(document, anchorNodeId);
  if (existingSpace && existingSpace.type !== "flow") {
    return { document, spaceId: "", selectedFlowNodeId: "" };
  }
  const existing = existingSpace?.type === "flow" ? existingSpace : null;
  if (existing) {
    const selectedFlowNodeId =
      Object.values(existing.nodes).find(({ kind }) => kind === "step")?.id ??
      Object.keys(existing.nodes)[0] ??
      "";
    return { document, spaceId: existing.id, selectedFlowNodeId };
  }

  const now = new Date().toISOString();
  const start = createFlowNode("start", "开始", now);
  // Empty anchors keep empty step content; the display layer renders the
  // "输入步骤" prompt, and placeholder text must never reach the document.
  const step = createFlowNode("step", anchor.text.trim(), now);
  const end = createFlowNode("end", "完成", now);
  const id = createRuntimeId("flow-space");
  const space: FlowSpace = {
    id,
    type: "flow",
    anchorNodeId,
    nodes: {
      [start.id]: start,
      [step.id]: step,
      [end.id]: end,
    },
    edges: [
      createFlowEdge(start.id, step.id),
      createFlowEdge(step.id, end.id),
    ],
    viewport: defaultSpaceViewport,
    updatedAt: now,
  };
  return {
    document: {
      ...document,
      nodes: {
        ...document.nodes,
        [anchorNodeId]: {
          ...anchor,
          subspaceId: id,
          updatedAt: now,
        },
      },
      spaces: {
        ...documentSpaces(document),
        [id]: space,
      },
      updatedAt: now,
    },
    spaceId: id,
    selectedFlowNodeId: step.id,
  };
}

export function setMapSpaceViewport(
  document: MindMapDocument,
  spaceId: string,
  viewport: Viewport,
): MindMapDocument {
  const space = documentSpaces(document)[spaceId];
  if (!space || space.type !== "map") return document;
  if (
    space.viewport.x === viewport.x &&
    space.viewport.y === viewport.y &&
    space.viewport.zoom === viewport.zoom
  ) {
    return document;
  }
  return {
    ...document,
    spaces: {
      ...documentSpaces(document),
      [spaceId]: { ...space, viewport },
    },
  };
}

/**
 * Viewports are editor state, not content: history never records them, so a
 * restored snapshot carries stale positions. Keep the user's current viewport
 * in the root and in every space that still exists after the restore.
 */
export function preserveDocumentViewports(
  restored: MindMapDocument,
  current: MindMapDocument,
): MindMapDocument {
  const next: MindMapDocument = { ...restored, viewport: current.viewport };
  const restoredSpaces = restored.spaces;
  const currentSpaces = current.spaces;
  if (restoredSpaces && currentSpaces) {
    next.spaces = Object.fromEntries(
      Object.entries(restoredSpaces).map(([spaceId, space]) => {
        const twin = currentSpaces[spaceId];
        return twin && twin.type === space.type
          ? [spaceId, { ...space, viewport: twin.viewport }]
          : [spaceId, space];
      }),
    );
  }
  return next;
}

function spacesAfterDeleting(
  document: MindMapDocument,
  initialSpaceId: string,
): Record<string, LaniakeaSpace> {
  const spaces = documentSpaces(document);
  const removedSpaceIds = new Set([initialSpaceId]);
  const removedAnchorIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const spaceId of removedSpaceIds) {
      const space = spaces[spaceId];
      if (space?.type !== "map") continue;
      Object.keys(space.nodes).forEach((nodeId) => removedAnchorIds.add(nodeId));
    }
    for (const [spaceId, space] of Object.entries(spaces)) {
      if (!removedSpaceIds.has(spaceId) && removedAnchorIds.has(space.anchorNodeId)) {
        removedSpaceIds.add(spaceId);
        changed = true;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(spaces).filter(([spaceId]) => !removedSpaceIds.has(spaceId)),
  );
}

export function deleteSubspaceForNode(
  document: MindMapDocument,
  nodeId: string,
): MindMapDocument {
  const anchor = document.nodes[nodeId];
  if (!anchor?.subspaceId) return document;
  const now = new Date().toISOString();
  const { subspaceId: _removedSubspaceId, ...nodeWithoutSubspace } = anchor;
  return {
    ...document,
    nodes: {
      ...document.nodes,
      [nodeId]: { ...nodeWithoutSubspace, updatedAt: now },
    },
    spaces: spacesAfterDeleting(document, anchor.subspaceId),
    updatedAt: now,
  };
}

export function updateFlowSpace(
  document: MindMapDocument,
  space: FlowSpace,
  selection: SelectionState,
): DocumentMutation {
  const existing = documentSpaces(document)[space.id];
  if (!existing) return { document, selection };
  return {
    document: {
      ...document,
      spaces: {
        ...documentSpaces(document),
        [space.id]: space,
      },
      updatedAt: new Date().toISOString(),
    },
    selection,
  };
}

export function setFlowViewport(
  document: MindMapDocument,
  spaceId: string,
  viewport: Viewport,
): MindMapDocument {
  const space = documentSpaces(document)[spaceId];
  if (!space || space.type !== "flow") return document;
  if (
    space.viewport.x === viewport.x &&
    space.viewport.y === viewport.y &&
    space.viewport.zoom === viewport.zoom
  ) {
    return document;
  }
  return {
    ...document,
    spaces: {
      ...documentSpaces(document),
      [spaceId]: { ...space, viewport },
    },
  };
}

function withFlowTimestamp(space: FlowSpace, patch: Partial<FlowSpace>): FlowSpace {
  return { ...space, ...patch, updatedAt: new Date().toISOString() };
}

export function setFlowNodeText(
  space: FlowSpace,
  nodeId: string,
  text: string,
): FlowSpace {
  const node = space.nodes[nodeId];
  if (!node) return space;
  const value = text.trim();
  return withFlowTimestamp(space, {
    nodes: {
      ...space.nodes,
      [nodeId]: {
        ...node,
        text: value,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

export function setFlowNodeKind(
  space: FlowSpace,
  nodeId: string,
  kind: FlowNodeKind,
): FlowSpace {
  const node = space.nodes[nodeId];
  if (!node || node.kind === kind) return space;
  return withFlowTimestamp(space, {
    nodes: {
      ...space.nodes,
      [nodeId]: {
        ...node,
        kind,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

export function setFlowEdgeLabel(
  space: FlowSpace,
  edgeId: string,
  label: string,
): FlowSpace {
  const edge = space.edges.find((candidate) => candidate.id === edgeId);
  const value = label.trim();
  if (!edge || edge.label === value) return space;
  return withFlowTimestamp(space, {
    edges: space.edges.map((candidate) =>
      candidate.id === edgeId ? { ...candidate, label: value } : candidate,
    ),
  });
}

export function connectableFlowNodeIds(
  space: FlowSpace,
  fromId: string,
): Set<string> {
  const from = space.nodes[fromId];
  if (!from || from.kind === "end") return new Set();

  const incoming = new Map<string, string[]>();
  const existingTargets = new Set<string>();
  space.edges.forEach((edge) => {
    const sources = incoming.get(edge.to) ?? [];
    sources.push(edge.from);
    incoming.set(edge.to, sources);
    if (edge.from === fromId) existingTargets.add(edge.to);
  });

  const ancestors = new Set<string>();
  const pending = [fromId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || ancestors.has(current)) continue;
    ancestors.add(current);
    incoming.get(current)?.forEach((source) => pending.push(source));
  }

  const connectable = new Set<string>();
  Object.values(space.nodes).forEach((candidate) => {
    if (
      candidate.kind !== "start" &&
      !ancestors.has(candidate.id) &&
      !existingTargets.has(candidate.id)
    ) {
      connectable.add(candidate.id);
    }
  });
  return connectable;
}

export function canConnectFlowNodes(
  space: FlowSpace,
  fromId: string,
  toId: string,
): boolean {
  return connectableFlowNodeIds(space, fromId).has(toId);
}

export function connectFlowNodes(
  space: FlowSpace,
  fromId: string,
  toId: string,
): FlowSpace {
  if (!canConnectFlowNodes(space, fromId, toId)) return space;
  const now = new Date().toISOString();
  const outgoing = space.edges.filter((edge) => edge.from === fromId);
  const source = space.nodes[fromId];
  const becomesDecision = outgoing.length > 0 && source.kind !== "decision";
  const label = outgoing.length === 0 ? "" : `分支 ${outgoing.length + 1}`;
  return withFlowTimestamp(space, {
    nodes: becomesDecision
      ? {
          ...space.nodes,
          [fromId]: { ...source, kind: "decision", updatedAt: now },
        }
      : space.nodes,
    edges: [
      ...space.edges.map((edge) =>
        edge.from === fromId && becomesDecision && !edge.label
          ? { ...edge, label: "主线" }
          : edge,
      ),
      createFlowEdge(fromId, toId, label),
    ],
  });
}

export function addFlowStepAfter(
  space: FlowSpace,
  nodeId: string,
): { space: FlowSpace; nodeId: string } {
  const current = space.nodes[nodeId];
  if (!current) return { space, nodeId };
  if (current.kind === "end") return { space, nodeId };
  if (current.kind === "decision") return addFlowBranch(space, nodeId);
  const now = new Date().toISOString();
  const created = createFlowNode("step", "", now);
  const outgoing = space.edges.filter((edge) => edge.from === nodeId);
  const retained = space.edges.filter((edge) => edge.from !== nodeId);
  const edges = [
    ...retained,
    createFlowEdge(nodeId, created.id),
    ...outgoing.map((edge) => ({ ...edge, from: created.id })),
  ];
  return {
    nodeId: created.id,
    space: withFlowTimestamp(space, {
      nodes: { ...space.nodes, [created.id]: created },
      edges,
    }),
  };
}

export function addFlowBranch(
  space: FlowSpace,
  nodeId: string,
): { space: FlowSpace; nodeId: string } {
  const current = space.nodes[nodeId];
  if (!current) return { space, nodeId };
  if (current.kind === "end") return { space, nodeId };
  const now = new Date().toISOString();
  const branch = createFlowNode("step", "", now);
  const outgoingCount = space.edges.filter((edge) => edge.from === nodeId).length;
  const alternative =
    outgoingCount === 0 ? createFlowNode("step", "", now) : null;
  const decision = current.kind === "decision"
    ? current
    : { ...current, kind: "decision" as const, updatedAt: now };
  return {
    nodeId: branch.id,
    space: withFlowTimestamp(space, {
      nodes: {
        ...space.nodes,
        [nodeId]: decision,
        [branch.id]: branch,
        ...(alternative ? { [alternative.id]: alternative } : {}),
      },
      edges: [
        ...space.edges.map((edge) =>
          edge.from === nodeId && !edge.label
            ? { ...edge, label: "主线" }
            : edge,
        ),
        createFlowEdge(
          nodeId,
          branch.id,
          outgoingCount === 0 ? "是" : `分支 ${outgoingCount + 1}`,
        ),
        ...(alternative
          ? [createFlowEdge(nodeId, alternative.id, "否")]
          : []),
      ],
    }),
  };
}

export function deleteFlowNode(
  space: FlowSpace,
  nodeId: string,
): { space: FlowSpace; nextSelectedId: string | null } {
  const node = space.nodes[nodeId];
  if (!node || node.kind === "start") {
    return { space, nextSelectedId: nodeId };
  }
  const incoming = space.edges.filter((edge) => edge.to === nodeId);
  const outgoing = space.edges.filter((edge) => edge.from === nodeId);
  const remaining = space.edges.filter(
    (edge) => edge.from !== nodeId && edge.to !== nodeId,
  );
  const bridgeTarget = outgoing[0]?.to;
  const remainingPairs = new Set(
    remaining.map((edge) => `${edge.from}\u0000${edge.to}`),
  );
  const bridges = bridgeTarget
    ? incoming
        .filter((edge) => {
          const endpointPair = `${edge.from}\u0000${bridgeTarget}`;
          if (edge.from === bridgeTarget || remainingPairs.has(endpointPair)) {
            return false;
          }
          remainingPairs.add(endpointPair);
          return true;
        })
        .map((edge) => createFlowEdge(edge.from, bridgeTarget, edge.label))
    : [];
  const nodes = { ...space.nodes };
  delete nodes[nodeId];
  return {
    nextSelectedId: incoming[0]?.from ?? bridgeTarget ?? Object.keys(nodes)[0] ?? null,
    space: withFlowTimestamp(space, { nodes, edges: [...remaining, ...bridges] }),
  };
}

export function flowNodeSelection(id: string): SelectionState {
  return singleSelection(id);
}
