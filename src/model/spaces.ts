import { createRuntimeId } from "./runtimeId";
import type {
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  FlowNodePosition,
  FlowPlacementDirection,
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
  ports?: {
    fromPort?: FlowPlacementDirection;
    toPort?: FlowPlacementDirection;
  },
): FlowEdge {
  return {
    id: createRuntimeId("flow-edge"),
    from,
    to,
    label,
    ...ports,
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
  // Empty anchors keep empty step content; the display layer renders the
  // "输入步骤" prompt, and placeholder text must never reach the document.
  const step = createFlowNode("step", anchor.text.trim(), now);
  const id = createRuntimeId("flow-space");
  const space: FlowSpace = {
    id,
    type: "flow",
    anchorNodeId,
    nodes: { [step.id]: step },
    edges: [],
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
          ? [
              spaceId,
              space.type === "flow" && twin.type === "flow"
                ? {
                    ...space,
                    viewport: twin.viewport,
                    positions: twin.positions,
                  }
                : { ...space, viewport: twin.viewport },
            ]
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

export function moveSubspaceToNode(
  document: MindMapDocument,
  sourceNodeId: string,
  targetNodeId: string,
): MindMapDocument {
  if (sourceNodeId === targetNodeId) return document;
  const source = document.nodes[sourceNodeId];
  const target = document.nodes[targetNodeId];
  const spaceId = source?.subspaceId;
  const space = spaceId ? documentSpaces(document)[spaceId] : undefined;
  if (!source || !target || !spaceId || !space || target.subspaceId) {
    return document;
  }
  const now = new Date().toISOString();
  const { subspaceId: _removedSubspaceId, ...sourceWithoutSubspace } = source;
  return {
    ...document,
    nodes: {
      ...document.nodes,
      [sourceNodeId]: { ...sourceWithoutSubspace, updatedAt: now },
      [targetNodeId]: { ...target, subspaceId: spaceId, updatedAt: now },
    },
    spaces: {
      ...documentSpaces(document),
      [spaceId]: { ...space, anchorNodeId: targetNodeId, updatedAt: now },
    },
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

function sameFlowPositions(
  left: Record<string, FlowNodePosition> | undefined,
  right: Record<string, FlowNodePosition>,
): boolean {
  const leftIds = Object.keys(left ?? {});
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length && rightIds.every((id) =>
    left?.[id]?.x === right[id].x && left?.[id]?.y === right[id].y,
  );
}

export function setFlowPositions(
  document: MindMapDocument,
  spaceId: string,
  positions: Record<string, FlowNodePosition>,
): MindMapDocument {
  const space = documentSpaces(document)[spaceId];
  if (space?.type !== "flow") return document;
  const valid = Object.fromEntries(
    Object.entries(positions).filter(([nodeId, position]) =>
      Boolean(space.nodes[nodeId]) &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y),
    ),
  );
  if (sameFlowPositions(space.positions, valid)) return document;
  return {
    ...document,
    spaces: {
      ...documentSpaces(document),
      [spaceId]: { ...space, positions: valid },
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

export function deleteFlowEdge(space: FlowSpace, edgeId: string): FlowSpace {
  if (!space.edges.some((edge) => edge.id === edgeId)) return space;
  return withFlowTimestamp(space, {
    edges: space.edges.filter((edge) => edge.id !== edgeId),
  });
}

export function connectableFlowNodeIds(
  space: FlowSpace,
  fromId: string,
): Set<string> {
  const from = space.nodes[fromId];
  if (!from) return new Set();

  const existingTargets = new Set<string>();
  space.edges.forEach((edge) => {
    if (edge.from === fromId) existingTargets.add(edge.to);
  });

  const connectable = new Set<string>();
  Object.values(space.nodes).forEach((candidate) => {
    if (candidate.id !== fromId && !existingTargets.has(candidate.id)) {
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
  ports?: {
    fromPort?: FlowPlacementDirection;
    toPort?: FlowPlacementDirection;
  },
): FlowSpace {
  if (!canConnectFlowNodes(space, fromId, toId)) return space;
  return withFlowTimestamp(space, {
    edges: [...space.edges, createFlowEdge(fromId, toId, "", ports)],
  });
}

export function reconnectFlowEdge(
  space: FlowSpace,
  edgeId: string,
  endpoint: "from" | "to",
  nodeId: string,
  port: FlowPlacementDirection,
): FlowSpace {
  const edge = space.edges.find((candidate) => candidate.id === edgeId);
  if (!edge || !space.nodes[nodeId]) return space;
  const from = endpoint === "from" ? nodeId : edge.from;
  const to = endpoint === "to" ? nodeId : edge.to;
  const withoutCurrent = {
    ...space,
    edges: space.edges.filter((candidate) => candidate.id !== edgeId),
  };
  if (!canConnectFlowNodes(withoutCurrent, from, to)) return space;
  return withFlowTimestamp(space, {
    edges: space.edges.map((candidate) =>
      candidate.id === edgeId
        ? endpoint === "from"
          ? { ...candidate, from, fromPort: port }
          : { ...candidate, to, toPort: port }
        : candidate,
    ),
  });
}

/**
 * Create one explicitly typed node from a visible quick-create affordance.
 * A linear source inserts the node before its current continuation. A source
 * that already branches keeps those branches and adds the new node as one
 * more outgoing path instead of silently moving the whole branch set.
 */
export function addFlowNodeAfter(
  space: FlowSpace,
  nodeId: string,
  kind: "step" | "decision",
): { space: FlowSpace; nodeId: string } {
  const current = space.nodes[nodeId];
  if (!current) return { space, nodeId };

  const now = new Date().toISOString();
  const created = createFlowNode(kind, "", now);
  const outgoing = space.edges.filter((edge) => edge.from === nodeId);
  const isBranchingSource = current.kind === "decision" || outgoing.length > 1;

  if (isBranchingSource) {
    const branchLabel = outgoing.length === 0
      ? ""
      : `分支 ${outgoing.length + 1}`;
    return {
      nodeId: created.id,
      space: withFlowTimestamp(space, {
        nodes: { ...space.nodes, [created.id]: created },
        edges: [
          ...space.edges.map((edge) =>
            edge.from === nodeId && !edge.label
              ? { ...edge, label: "主线" }
              : edge,
          ),
          createFlowEdge(nodeId, created.id, branchLabel),
        ],
      }),
    };
  }

  const retained = space.edges.filter((edge) => edge.from !== nodeId);
  return {
    nodeId: created.id,
    space: withFlowTimestamp(space, {
      nodes: { ...space.nodes, [created.id]: created },
      edges: [
        ...retained,
        createFlowEdge(nodeId, created.id),
        ...outgoing.map((edge) => ({ ...edge, from: created.id })),
      ],
    }),
  };
}

export function positionFlowNode(
  space: FlowSpace,
  nodeId: string,
  position: FlowNodePosition,
  currentPositions: Record<string, FlowNodePosition>,
): FlowSpace {
  if (!space.nodes[nodeId] || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return space;
  }
  const positions = {
    ...Object.fromEntries(
      Object.entries(currentPositions).filter(([id]) => Boolean(space.nodes[id])),
    ),
    [nodeId]: position,
  };
  if (sameFlowPositions(space.positions, positions)) return space;
  return { ...space, positions };
}

export function addFlowNodeInDirection(
  space: FlowSpace,
  nodeId: string,
  kind: "step" | "decision",
  direction: FlowPlacementDirection,
  currentPositions: Record<string, FlowNodePosition>,
): { space: FlowSpace; nodeId: string } {
  if (!space.nodes[nodeId]) return { space, nodeId };
  const now = new Date().toISOString();
  const node = createFlowNode(kind, "", now);
  const oppositeDirection: FlowPlacementDirection = direction === "left"
    ? "right"
    : direction === "right"
      ? "left"
      : direction === "up"
        ? "down"
        : "up";
  const created = {
    nodeId: node.id,
    space: withFlowTimestamp(space, {
      nodes: { ...space.nodes, [node.id]: node },
      edges: [
        ...space.edges,
        createFlowEdge(nodeId, node.id, "", {
          fromPort: direction,
          toPort: oppositeDirection,
        }),
      ],
    }),
  };
  const origin = currentPositions[nodeId] ?? space.positions?.[nodeId];
  if (!origin) return created;
  const offset = direction === "left"
    ? { x: -268, y: 0 }
    : direction === "right"
      ? { x: 268, y: 0 }
      : direction === "up"
        ? { x: 0, y: -168 }
        : { x: 0, y: 168 };
  const positions = {
    ...Object.fromEntries(
      Object.entries(currentPositions).filter(([id]) =>
        Boolean(created.space.nodes[id]),
      ),
    ),
    [created.nodeId]: {
      x: origin.x + offset.x,
      y: origin.y + offset.y,
    },
  };
  return {
    nodeId: created.nodeId,
    space: { ...created.space, positions },
  };
}

export function addFlowNodeAtPosition(
  space: FlowSpace,
  kind: FlowNodeKind,
  position: FlowNodePosition,
  currentPositions: Record<string, FlowNodePosition>,
): { space: FlowSpace; nodeId: string } {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return { space, nodeId: "" };
  }
  const now = new Date().toISOString();
  const created = createFlowNode(kind, "", now);
  const positions = {
    ...Object.fromEntries(
      Object.entries(currentPositions).filter(([id]) => Boolean(space.nodes[id])),
    ),
    [created.id]: position,
  };
  return {
    nodeId: created.id,
    space: withFlowTimestamp(space, {
      nodes: { ...space.nodes, [created.id]: created },
      positions,
    }),
  };
}

export function addFlowStepAfter(
  space: FlowSpace,
  nodeId: string,
): { space: FlowSpace; nodeId: string } {
  const current = space.nodes[nodeId];
  if (!current) return { space, nodeId };
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
  const origin = space.positions?.[nodeId];
  const positions = origin
    ? {
        ...space.positions,
        [created.id]: { x: origin.x + 268, y: origin.y },
      }
    : space.positions;
  return {
    nodeId: created.id,
    space: withFlowTimestamp(space, {
      nodes: { ...space.nodes, [created.id]: created },
      edges,
      positions,
    }),
  };
}

export function addFlowBranch(
  space: FlowSpace,
  nodeId: string,
): { space: FlowSpace; nodeId: string } {
  const current = space.nodes[nodeId];
  if (!current) return { space, nodeId };
  const now = new Date().toISOString();
  const branch = createFlowNode("step", "", now);
  const outgoingCount = space.edges.filter((edge) => edge.from === nodeId).length;
  const alternative =
    outgoingCount === 0 ? createFlowNode("step", "", now) : null;
  const decision = current.kind === "decision"
    ? current
    : { ...current, kind: "decision" as const, updatedAt: now };
  const origin = space.positions?.[nodeId];
  const positions = origin
    ? {
        ...space.positions,
        [branch.id]: {
          x: origin.x + 268,
          y: origin.y + (alternative ? -84 : outgoingCount * 112),
        },
        ...(alternative
          ? {
              [alternative.id]: {
                x: origin.x + 268,
                y: origin.y + 84,
              },
            }
          : {}),
      }
    : space.positions;
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
      positions,
    }),
  };
}

export function deleteFlowNode(
  space: FlowSpace,
  nodeId: string,
): { space: FlowSpace; nextSelectedId: string | null } {
  const node = space.nodes[nodeId];
  if (!node) {
    return { space, nextSelectedId: nodeId };
  }
  const incoming = space.edges.filter((edge) => edge.to === nodeId);
  const outgoing = space.edges.filter((edge) => edge.from === nodeId);
  const remaining = space.edges.filter(
    (edge) => edge.from !== nodeId && edge.to !== nodeId,
  );
  const nodes = { ...space.nodes };
  delete nodes[nodeId];
  const positions = space.positions
    ? Object.fromEntries(
        Object.entries(space.positions).filter(([id]) => id !== nodeId),
      )
    : undefined;
  return {
    nextSelectedId:
      incoming[0]?.from ?? outgoing[0]?.to ?? Object.keys(nodes)[0] ?? null,
    space: withFlowTimestamp(space, {
      nodes,
      edges: remaining,
      positions,
    }),
  };
}

export function flowNodeSelection(id: string): SelectionState {
  return singleSelection(id);
}
