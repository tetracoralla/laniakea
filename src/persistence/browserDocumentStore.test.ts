import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBlankDocument, createSeedDocument } from "../data/seed";
import {
  activateBrowserDocument,
  BrowserDocumentConflictError,
  createBrowserDocument,
  exportBrowserLibrary,
  loadActiveBrowserDocument,
  openBrowserDocument,
  resetBrowserDocumentStoreForTests,
  restoreBrowserLibrary,
  saveBrowserDocument,
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
});
