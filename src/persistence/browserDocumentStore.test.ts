import { createFlowWithStep } from "../test/flowFixture";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBlankDocument, createSeedDocument } from "../data/seed";
import { isMindMapDocument } from "../model/document";
import { addFlowStepAfter, deleteFlowNode, flowSpaceForNode, updateFlowSpace } from "../model/spaces";
import {
  activateBrowserDocument,
  BrowserDocumentConflictError,
  createBrowserDocument,
  discardBrowserDocument,
  exportBrowserLibrary,
  loadActiveBrowserDocument,
  listBrowserDocuments,
  openBrowserDocument,
  resetBrowserDocumentStoreForTests,
  restoreBrowserLibrary,
  saveBrowserDocument,
  saveBrowserDocumentViewState,
} from "./browserDocumentStore";

describe("browser document library", () => {
  beforeEach(async () => {
    await resetBrowserDocumentStoreForTests();
  });

  it("keeps multiple documents and restores the active one", async () => {
    const first = await createBrowserDocument(createSeedDocument());
    const secondDocument = createBlankDocument();
    secondDocument.title = "第二张图";
    const second = await createBrowserDocument(secondDocument, false);

    expect((await loadActiveBrowserDocument())?.documentPath).toBe(
      first.documentPath,
    );

    await activateBrowserDocument(second.documentPath);

    expect((await loadActiveBrowserDocument())?.document.title).toBe(
      "第二张图",
    );
    expect((await openBrowserDocument(first.documentPath)).document.title)
      .toBe("思维导图工具");
  });

  it("rejects a stale tab without overwriting the newer revision", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const firstTab = await openBrowserDocument(created.documentPath);
    const secondTab = await openBrowserDocument(created.documentPath);
    const newer = { ...firstTab.document, title: "标签页 A" };
    const stale = { ...secondTab.document, title: "标签页 B" };

    await saveBrowserDocument(
      newer,
      firstTab.documentPath,
      firstTab.sourceHash,
    );

    await expect(
      saveBrowserDocument(
        stale,
        secondTab.documentPath,
        secondTab.sourceHash,
      ),
    ).rejects.toBeInstanceOf(BrowserDocumentConflictError);
    expect((await openBrowserDocument(created.documentPath)).document.title)
      .toBe("标签页 A");
  });

  it("restores a complete backup as safe new copies", async () => {
    await createBrowserDocument(createSeedDocument());
    const second = createBlankDocument();
    second.title = "备份中的第二张图";
    await createBrowserDocument(second);
    const backup = await exportBrowserLibrary();

    const restored = await restoreBrowserLibrary(backup);
    const after = await exportBrowserLibrary();

    expect(restored.count).toBe(2);
    expect(after.documents).toHaveLength(4);
    expect(restored.activeDocument?.document.title).toBe(
      "备份中的第二张图",
    );
    expect(
      new Set(after.documents.map((document) => document.id)).size,
    ).toBe(4);
  });

  it("keeps protected source identity and every document accessible", async () => {
    const paths: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const document = createBlankDocument();
      document.title = `文档 ${index + 1}`;
      const created = await createBrowserDocument(
        document,
        index === 6,
        index === 0 ? "富内容.md" : null,
      );
      paths.push(created.documentPath);
    }

    const library = await listBrowserDocuments();
    expect(library).toHaveLength(7);
    expect((await openBrowserDocument(paths[0])).protectedSourceName).toBe(
      "富内容.md",
    );

    await discardBrowserDocument(paths[1]);
    expect(await listBrowserDocuments()).toHaveLength(6);
    await expect(openBrowserDocument(paths[1])).rejects.toThrow(
      "已不在此浏览器",
    );
  });

  it("saves view state without bumping the revision or touching newer content", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const firstTab = await openBrowserDocument(created.documentPath);
    const pannedDocument = {
      ...firstTab.document,
      title: "过期的标题",
      viewport: { x: 40, y: 80, zoom: 1.25 },
    };

    const savedViewState = await saveBrowserDocumentViewState(
      pannedDocument,
      created.documentPath,
    );

    expect(savedViewState).toBe(true);
    const secondTab = await openBrowserDocument(created.documentPath);
    expect(secondTab.sourceHash).toBe(firstTab.sourceHash);
    expect(secondTab.document.viewport).toEqual({ x: 40, y: 80, zoom: 1.25 });
    // Content never travels through the view-state path.
    expect(secondTab.document.title).toBe(firstTab.document.title);

    // A content save from another tab keeps working without a conflict, and
    // the stored content is not the stale body the panning tab held.
    const newer = {
      ...secondTab.document,
      title: "标签页 B 的较新内容",
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const saved = await saveBrowserDocument(
      newer,
      created.documentPath,
      secondTab.sourceHash,
    );
    expect(saved.sourceHash).not.toBe(firstTab.sourceHash);
    const after = await openBrowserDocument(created.documentPath);
    expect(after.document.title).toBe("标签页 B 的较新内容");
    expect(after.sourceHash).not.toBe(firstTab.sourceHash);

    // Panning from the stale tab still only lifts the viewport and cannot
    // acquire the newer tab's content revision.
    expect(await saveBrowserDocumentViewState(
      { ...pannedDocument, viewport: { x: 7, y: 9, zoom: 0.5 } },
      created.documentPath,
    )).toBe(true);
    const final = await openBrowserDocument(created.documentPath);
    expect(final.document.title).toBe("标签页 B 的较新内容");
    expect(final.document.viewport).toEqual({ x: 7, y: 9, zoom: 0.5 });

    await expect(saveBrowserDocument(
      { ...pannedDocument, title: "标签页 A 的过期内容" },
      created.documentPath,
      firstTab.sourceHash,
    )).rejects.toThrow("另一个标签页");
    expect((await openBrowserDocument(created.documentPath)).document.title)
      .toBe("标签页 B 的较新内容");
  });

  it("skips view state for a record that no longer exists", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    await discardBrowserDocument(created.documentPath);

    const savedViewState = await saveBrowserDocumentViewState(
      createSeedDocument(),
      created.documentPath,
    );

    expect(savedViewState).toBe(false);
    expect(await listBrowserDocuments()).toHaveLength(0);
  });

  it("carries flow canvas arrangement through a view-state save", async () => {
    const spaceId = "flow-view-state-space";
    const stamp = "2026-09-06T08:00:00.000Z";
    const seed = createSeedDocument();
    const document = {
      ...seed,
      nodes: {
        ...seed.nodes,
        root: { ...seed.nodes.root, subspaceId: spaceId },
      },
      spaces: {
        [spaceId]: {
          id: spaceId,
          type: "flow" as const,
          anchorNodeId: "root",
          nodes: {
            "flow-a": {
              id: "flow-a", text: "第一步骤", kind: "step" as const,
              createdAt: stamp, updatedAt: stamp,
            },
            "flow-b": {
              id: "flow-b", text: "第二步骤", kind: "step" as const,
              createdAt: stamp, updatedAt: stamp,
            },
          },
          edges: [{ id: "edge-1", from: "flow-a", to: "flow-b", label: "" }],
          viewport: { x: 0, y: 0, zoom: 1 },
          updatedAt: stamp,
        },
      },
    };
    const created = await createBrowserDocument(document);
    const firstTab = await openBrowserDocument(created.documentPath);
    const storedSpace = firstTab.document.spaces![spaceId];
    if (storedSpace.type !== "flow") throw new Error("expected flow space");

    // The user dragged a label, a manual corridor, and a node locally, then
    // panned. The superseding silent save must lift this arrangement into the
    // record without touching content or the revision lease.
    const arranged = {
      ...firstTab.document,
      title: "不应写入的标题",
      viewport: { x: 30, y: 60, zoom: 1.5 },
      spaces: {
        ...firstTab.document.spaces,
        [spaceId]: {
          ...storedSpace,
          viewport: { x: 4, y: 8, zoom: 1.25 },
          positions: { "flow-a": { x: 100, y: 40 } },
          edgeRoutes: { "edge-1": { axis: "x" as const, coordinate: 320 } },
          edgeLabelOffsets: { "edge-1": { x: 12, y: -28 } },
        },
      },
    };

    expect(
      await saveBrowserDocumentViewState(arranged, created.documentPath),
    ).toBe(true);

    const reloaded = await openBrowserDocument(created.documentPath);
    expect(reloaded.sourceHash).toBe(firstTab.sourceHash);
    expect(reloaded.document.title).toBe(firstTab.document.title);
    expect(reloaded.document.viewport).toEqual({ x: 30, y: 60, zoom: 1.5 });
    const savedSpace = reloaded.document.spaces![spaceId];
    if (savedSpace.type !== "flow") throw new Error("expected flow space");
    expect(savedSpace.viewport).toEqual({ x: 4, y: 8, zoom: 1.25 });
    expect(savedSpace.positions).toEqual({ "flow-a": { x: 100, y: 40 } });
    expect(savedSpace.edgeRoutes).toEqual({
      "edge-1": { axis: "x", coordinate: 320 },
    });
    expect(savedSpace.edgeLabelOffsets).toEqual({
      "edge-1": { x: 12, y: -28 },
    });
  });

  it("keeps a newer flow readable when a stale tab pans after a node deletion", async () => {
    const flow = createFlowWithStep(createSeedDocument(), "path");
    const added = addFlowStepAfter(flowSpaceForNode(flow.document, "path")!, flow.selectedFlowNodeId);
    const edgeId = added.space.edges[0].id;
    const arranged = {
      ...added.space,
      edgeRoutes: { [edgeId]: { axis: "x" as const, coordinate: 320 } },
      edgeLabelOffsets: { [edgeId]: { x: 20, y: 10 } },
    };
    const document = updateFlowSpace(flow.document, arranged, { primaryId: "path", selectedIds: ["path"] }).document;
    const created = await createBrowserDocument(document);
    const stale = await openBrowserDocument(created.documentPath);
    const newer = updateFlowSpace(document, deleteFlowNode(arranged, added.nodeId).space, { primaryId: "path", selectedIds: ["path"] }).document;
    const saved = await saveBrowserDocument(newer, created.documentPath, created.sourceHash);
    await saveBrowserDocumentViewState(stale.document, created.documentPath);
    const reloaded = await openBrowserDocument(created.documentPath);
    expect(isMindMapDocument(reloaded.document)).toBe(true);
    expect(reloaded.sourceHash).toBe(saved.sourceHash);
    expect(flowSpaceForNode(reloaded.document, "path")?.nodes[added.nodeId]).toBeUndefined();
  });
});
