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
});
