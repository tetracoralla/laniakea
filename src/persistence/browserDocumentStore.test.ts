import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBlankDocument, createSeedDocument } from "../data/seed";
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

    const token = await saveBrowserDocumentViewState(
      pannedDocument,
      created.documentPath,
    );

    // The revision token stays valid for the panning tab's next content save.
    expect(token).toBe(firstTab.sourceHash);
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

    // Panning after that still only lifts the viewport.
    await saveBrowserDocumentViewState(
      { ...pannedDocument, viewport: { x: 7, y: 9, zoom: 0.5 } },
      created.documentPath,
    );
    const final = await openBrowserDocument(created.documentPath);
    expect(final.document.title).toBe("标签页 B 的较新内容");
    expect(final.document.viewport).toEqual({ x: 7, y: 9, zoom: 0.5 });
  });

  it("skips view state for a record that no longer exists", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    await discardBrowserDocument(created.documentPath);

    const token = await saveBrowserDocumentViewState(
      createSeedDocument(),
      created.documentPath,
    );

    expect(token).toBeNull();
    expect(await listBrowserDocuments()).toHaveLength(0);
  });
});
