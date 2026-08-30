import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  addFlowBranch,
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

  it("uses semantic next and branch operations instead of free coordinates", () => {
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

  it("rewires a deleted step and preserves an editable selection target", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowStepAfter(initial, created.selectedFlowNodeId);
    const renamed = setFlowNodeText(added.space, added.nodeId, "确认订单");
    const removed = deleteFlowNode(renamed, added.nodeId);

    expect(removed.space.nodes[added.nodeId]).toBeUndefined();
    expect(removed.nextSelectedId).toBe(created.selectedFlowNodeId);
    expect(removed.space.edges).toHaveLength(2);
  });

  it("does not duplicate an existing connection while bridging a deleted step", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const startId = Object.values(initial.nodes).find(
      ({ kind }) => kind === "start",
    )!.id;
    const endId = Object.values(initial.nodes).find(
      ({ kind }) => kind === "end",
    )!.id;
    const withDirectBranch = connectFlowNodes(initial, startId, endId);

    const removed = deleteFlowNode(
      withDirectBranch,
      created.selectedFlowNodeId,
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
    const endId = Object.values(branched.nodes).find(({ kind }) => kind === "end")!.id;
    const branchEdge = branched.edges.find(
      (edge) => edge.from === decisionId && edge.label !== "主线",
    )!;
    const renamed = setFlowEdgeLabel(branched, branchEdge.id, "  已通过  ");
    const merged = connectFlowNodes(renamed, branchEdge.to, endId);

    expect(renamed.edges.find(({ id }) => id === branchEdge.id)?.label).toBe("已通过");
    expect(merged.edges.some((edge) => edge.from === branchEdge.to && edge.to === endId))
      .toBe(true);
    expect(canConnectFlowNodes(merged, branchEdge.to, endId)).toBe(false);
    expect(canConnectFlowNodes(merged, endId, decisionId)).toBe(false);
    expect(connectableFlowNodeIds(merged, branchEdge.to)).not.toContain(endId);
    expect(connectableFlowNodeIds(merged, endId).size).toBe(0);
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
