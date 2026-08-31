import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  addFlowBranch,
  addFlowNodeAfter,
  addFlowNodeAtPosition,
  addFlowNodeInDirection,
  addFlowStepAfter,
  canConnectFlowNodes,
  connectableFlowNodeIds,
  connectFlowNodes,
  createMapSpace,
  createFlowSpace,
  deleteSubspaceForNode,
  deleteFlowNode,
  flowSpaceForNode,
  mapSpaceDocument,
  mapSpaceForNode,
  mergeMapSpaceDocument,
  preserveDocumentViewports,
  reconnectFlowEdge,
  setFlowNodeText,
  setFlowEdgeLabel,
  setFlowViewport,
} from "./spaces";
import { isMindMapDocument } from "./document";

describe("typed Laniakea spaces", () => {
  it("creates one anchored flow without changing the parent map tree", () => {
    const source = createSeedDocument();
    const originalChildren = [...source.nodes.root.children];
    const created = createFlowSpace(source, "path");
    const flow = flowSpaceForNode(created.document, "path");

    expect(flow?.id).toBe(created.spaceId);
    expect(source.spaces).toBeUndefined();
    expect(created.document.nodes.root.children).toEqual(originalChildren);
    expect(isMindMapDocument(created.document)).toBe(true);
  });

  it("keeps placeholder prompts out of flow content for an empty anchor", () => {
    const source = createSeedDocument();
    const blankAnchor = {
      ...source,
      nodes: {
        ...source.nodes,
        path: { ...source.nodes.path, text: "" },
      },
    };

    const created = createFlowSpace(blankAnchor, "path");
    const flow = flowSpaceForNode(created.document, "path");
    const step = Object.values(flow?.nodes ?? {}).find(
      (node) => node.kind === "step",
    );

    expect(step?.text).toBe("");
    expect(JSON.stringify(created.document)).not.toContain("输入步骤");
  });

  it("creates an independent permanent map space and never changes its type", () => {
    const source = createSeedDocument();
    const created = createMapSpace(source, "path");
    const map = mapSpaceForNode(created.document, "path");
    const rejectedConversion = createFlowSpace(created.document, "path");

    expect(map?.rootId).toBe(created.selectedMapNodeId);
    expect(map?.nodes[map.rootId].text).toBe("实现路径");
    expect(mapSpaceDocument(created.document, map!.id)?.rootId).toBe(map?.rootId);
    expect(rejectedConversion.spaceId).toBe("");
    expect(mapSpaceForNode(rejectedConversion.document, "path")?.id).toBe(map?.id);
    expect(isMindMapDocument(created.document)).toBe(true);
  });

  it("deletes a map space and every nested space as one undoable object", () => {
    const parent = createMapSpace(createSeedDocument(), "path");
    const scoped = mapSpaceDocument(parent.document, parent.spaceId)!;
    const child = createFlowSpace(scoped, scoped.rootId);
    const nested = mergeMapSpaceDocument(
      parent.document,
      parent.spaceId,
      child.document,
    );
    const deleted = deleteSubspaceForNode(nested, "path");

    expect(Object.keys(nested.spaces ?? {})).toHaveLength(2);
    expect(deleted.nodes.path.subspaceId).toBeUndefined();
    expect(Object.keys(deleted.spaces ?? {})).toHaveLength(0);
    expect(isMindMapDocument(deleted)).toBe(true);
  });

  it("keeps keyboard next and branch operations semantic before manual placement", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const stepId = created.selectedFlowNodeId;
    const added = addFlowStepAfter(initial, stepId);
    const branched = addFlowBranch(added.space, added.nodeId);

    expect(added.space.edges.some(
      (edge) => edge.from === stepId && edge.to === added.nodeId,
    )).toBe(true);
    expect(branched.space.nodes[added.nodeId].kind).toBe("decision");
    expect(
      branched.space.edges.filter((edge) => edge.from === added.nodeId),
    ).toHaveLength(2);
  });

  it("creates a decision directly and preserves the existing continuation", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const stepId = created.selectedFlowNodeId;
    const continuation = addFlowStepAfter(initial, stepId);
    const added = addFlowNodeAfter(continuation.space, stepId, "decision");

    expect(added.space.nodes[added.nodeId].kind).toBe("decision");
    expect(added.space.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: stepId, to: added.nodeId }),
      expect.objectContaining({ from: added.nodeId, to: continuation.nodeId }),
    ]));
    expect(added.space.edges.some(
      (edge) => edge.from === stepId && edge.to === continuation.nodeId,
    )).toBe(false);
  });

  it("rewires a deleted step and preserves an editable selection target", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowStepAfter(initial, created.selectedFlowNodeId);
    const renamed = setFlowNodeText(added.space, added.nodeId, "确认订单");
    const removed = deleteFlowNode(renamed, added.nodeId);

    expect(removed.space.nodes[added.nodeId]).toBeUndefined();
    expect(removed.nextSelectedId).toBe(created.selectedFlowNodeId);
    expect(removed.space.edges).toHaveLength(0);
  });

  it("does not duplicate an existing connection while bridging a deleted step", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const startId = created.selectedFlowNodeId;
    const middle = addFlowStepAfter(initial, startId);
    const ending = addFlowStepAfter(middle.space, middle.nodeId);
    const endId = ending.nodeId;
    const withDirectBranch = connectFlowNodes(ending.space, startId, endId);

    const removed = deleteFlowNode(
      withDirectBranch,
      middle.nodeId,
    );

    expect(
      removed.space.edges.filter(
        (edge) => edge.from === startId && edge.to === endId,
      ),
    ).toHaveLength(1);
    expect(isMindMapDocument({
      ...created.document,
      spaces: { [created.spaceId]: removed.space },
    })).toBe(true);
  });

  it("edits branch language and merges branches without creating cycles", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const decisionId = created.selectedFlowNodeId;
    const branched = addFlowBranch(initial, decisionId).space;
    const branchEdges = branched.edges.filter((edge) => edge.from === decisionId);
    const target = addFlowNodeAfter(branched, branchEdges[0].to, "step");
    const branchEdge = branchEdges[1];
    const renamed = setFlowEdgeLabel(target.space, branchEdge.id, "  已通过  ");
    const merged = connectFlowNodes(renamed, branchEdge.to, target.nodeId);

    expect(renamed.edges.find(({ id }) => id === branchEdge.id)?.label).toBe("已通过");
    expect(merged.edges.some((edge) => edge.from === branchEdge.to && edge.to === target.nodeId))
      .toBe(true);
    expect(canConnectFlowNodes(merged, branchEdge.to, target.nodeId)).toBe(false);
    expect(canConnectFlowNodes(merged, target.nodeId, decisionId)).toBe(false);
    expect(connectableFlowNodeIds(merged, branchEdge.to)).not.toContain(target.nodeId);
  });

  it("creates in a chosen direction and keeps connector ports as portable semantics", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const originId = created.selectedFlowNodeId;
    const placed = addFlowNodeInDirection(
      initial,
      originId,
      "decision",
      "left",
      { [originId]: { x: 140, y: 140 } },
    );
    const branched = addFlowBranch(placed.space, placed.nodeId).space;
    const branchTargets = branched.edges
      .filter((edge) => edge.from === placed.nodeId)
      .map((edge) => edge.to);
    const connected = connectFlowNodes(
      branched,
      branchTargets[0],
      branchTargets[1],
      { fromPort: "down", toPort: "up" },
    );

    expect(placed.space.positions?.[placed.nodeId].x).toBeLessThan(
      placed.space.positions?.[originId].x ?? 0,
    );
    expect(connected.edges).toContainEqual(expect.objectContaining({
      from: branchTargets[0],
      to: branchTargets[1],
      fromPort: "down",
      toPort: "up",
    }));
    expect(placed.space.edges[0]).toEqual(expect.objectContaining({
      from: originId,
      fromPort: "left",
      to: placed.nodeId,
      toPort: "right",
    }));
  });

  it("adds a free-standing palette shape and lets a terminal participate like any node", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const terminal = addFlowNodeAtPosition(
      initial,
      "start",
      { x: 420, y: 240 },
      { [created.selectedFlowNodeId]: { x: 140, y: 140 } },
    );
    const connected = connectFlowNodes(
      terminal.space,
      created.selectedFlowNodeId,
      terminal.nodeId,
      { fromPort: "right", toPort: "left" },
    );
    const next = addFlowNodeAtPosition(
      connected,
      "step",
      { x: 420, y: 420 },
      connected.positions ?? {},
    );
    const continued = connectFlowNodes(
      next.space,
      terminal.nodeId,
      next.nodeId,
      { fromPort: "down", toPort: "up" },
    );

    expect(terminal.space.positions?.[terminal.nodeId]).toEqual({ x: 420, y: 240 });
    expect(connected.edges).toContainEqual(expect.objectContaining({
      from: created.selectedFlowNodeId,
      to: terminal.nodeId,
    }));
    expect(continued.edges).toContainEqual(expect.objectContaining({
      from: terminal.nodeId,
      fromPort: "down",
      to: next.nodeId,
      toPort: "up",
    }));
    expect(deleteFlowNode(continued, terminal.nodeId).space.nodes[terminal.nodeId])
      .toBeUndefined();
  });

  it("reconnects either end of an existing edge to a chosen node side", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const middle = addFlowStepAfter(initial, created.selectedFlowNodeId);
    const target = addFlowNodeAtPosition(
      middle.space,
      "step",
      { x: 520, y: 320 },
      middle.space.positions ?? {},
    );
    const edgeId = middle.space.edges[0].id;
    const movedTarget = reconnectFlowEdge(
      target.space,
      edgeId,
      "to",
      target.nodeId,
      "right",
    );
    const movedSourcePort = reconnectFlowEdge(
      movedTarget,
      edgeId,
      "from",
      created.selectedFlowNodeId,
      "left",
    );

    expect(movedSourcePort.edges.find(({ id }) => id === edgeId)).toMatchObject({
      from: created.selectedFlowNodeId,
      fromPort: "left",
      to: target.nodeId,
      toPort: "right",
    });
  });

  it("carries editor viewports across an undo restore", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const historical = created.document;
    const pannedCurrent = setFlowViewport(
      { ...historical, viewport: { x: 30, y: 50, zoom: 1.4 } },
      created.spaceId,
      { x: 11, y: 22, zoom: 0.9 },
    );

    const restored = preserveDocumentViewports(pannedCurrent, {
      ...pannedCurrent,
      title: "撤销后的内容变化",
    });

    expect(restored.viewport).toEqual({ x: 30, y: 50, zoom: 1.4 });
    expect(flowSpaceForNode(restored, "path")?.viewport).toEqual({
      x: 11,
      y: 22,
      zoom: 0.9,
    });
    expect(isMindMapDocument(restored)).toBe(true);
  });

  it("keeps a restored space's own viewport when it no longer exists currently", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const historical = created.document;
    const currentWithoutSpace = deleteSubspaceForNode(
      { ...historical, viewport: { x: 5, y: 6, zoom: 1 } },
      "path",
    );

    const restored = preserveDocumentViewports(historical, currentWithoutSpace);

    expect(restored.viewport).toEqual({ x: 5, y: 6, zoom: 1 });
    expect(flowSpaceForNode(restored, "path")?.viewport).toEqual(
      flowSpaceForNode(historical, "path")?.viewport,
    );
    expect(isMindMapDocument(restored)).toBe(true);
  });
});
