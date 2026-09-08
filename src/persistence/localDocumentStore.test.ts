import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  isDesktopRuntime,
  loadLocalDocument,
  resetBrowserRecoveryTabForTests,
  saveBrowserDocumentSynchronously,
  saveLocalDocument,
} from "./localDocumentStore";
import {
  createBrowserDocument,
  listBrowserDocuments,
  saveBrowserDocument,
  openBrowserDocument,
  resetBrowserDocumentStoreForTests,
} from "./browserDocumentStore";

const values = new Map<string, string>();
const storage = {
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() {
    return values.size;
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
} satisfies Storage;

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

describe("local document persistence errors", () => {
  beforeEach(async () => {
    await resetBrowserDocumentStoreForTests();
    resetBrowserRecoveryTabForTests();
    values.clear();
    delete (
      globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: object;
      }
    ).__TAURI_INTERNALS__;
  });

  it("rejects an unbound browser write instead of reporting it as saved", async () => {
    await expect(saveLocalDocument(createSeedDocument())).rejects.toThrow(
      "还没有可用的浏览器文档位置",
    );
  });

  it("preserves invalid legacy data under a recovery key", async () => {
    values.set("origin.mindmap.v1", "{not-json");

    const result = await loadLocalDocument();

    expect(result.document).toBeNull();
    expect(values.has("origin.mindmap.v1")).toBe(false);
    expect(
      [...values.keys()].some((key) =>
        key.startsWith("origin.mindmap.v1.corrupt."),
      ),
    ).toBe(true);
  });

  it("migrates the old single browser document into the document library", async () => {
    const legacy = createSeedDocument();
    values.set("origin.mindmap.v1", JSON.stringify(legacy));

    const loaded = await loadLocalDocument();

    expect(loaded.document?.title).toBe(legacy.title);
    expect(loaded.documentPath).toMatch(/^browser:\/\/laniakea\//);
    expect(loaded.sourceHash).toMatch(/^laniakea-browser:/);
    expect(values.has("origin.mindmap.v1")).toBe(false);

    const changed = { ...loaded.document!, title: "迁移后继续编辑" };
    const saved = await saveLocalDocument(
      changed,
      loaded.documentPath,
      loaded.sourceHash,
    );
    expect(saved.sourceHash).not.toBe(loaded.sourceHash);
  });

  it("recovers a stale tab as a copy without replacing the newer document", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const newer = { ...created.document, title: "较新版本" };
    await saveLocalDocument(
      newer,
      created.documentPath,
      created.sourceHash,
    );
    const stale = { ...created.document, title: "旧标签页未保存内容" };
    saveBrowserDocumentSynchronously(
      stale,
      created.documentPath,
      created.sourceHash,
    );

    const recovered = await loadLocalDocument();

    expect(recovered.document?.title).toBe("旧标签页未保存内容");
    expect(recovered.documentPath).not.toBe(created.documentPath);
    expect(recovered.notice).toContain("独立副本");
    expect((await openBrowserDocument(created.documentPath)).document.title)
      .toBe("较新版本");
  });

  it("does not duplicate a committed recovery after reload with an old acknowledgement", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const changed = { ...created.document, title: "刚刚保存的内容" };
    // The database commit wins the race, but the closing page still holds its old token.
    await saveBrowserDocument(changed, created.documentPath, created.sourceHash);
    const returned = {
      ...changed,
      nodes: { ...changed.nodes, root: { ...changed.nodes.root, collapsed: true } },
      viewport: { x: -90, y: 240, zoom: 0.8 },
    };
    saveBrowserDocumentSynchronously(returned, created.documentPath, created.sourceHash);
    const restored = await loadLocalDocument();
    expect(restored.documentPath).toBe(created.documentPath);
    expect(restored.document?.viewport).toEqual(returned.viewport);
    expect(restored.document?.nodes.root.collapsed).toBe(true);
    expect(restored.document?.title).toBe(changed.title);
    expect(await listBrowserDocuments()).toHaveLength(1);
    expect(restored.notice).toBe("已恢复关闭前的状态。");
  });

  it("clears an acknowledged snapshot regardless of JSON object key order", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const reordered = JSON.parse(JSON.stringify(created.document, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value,
    ));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(created.document));
    saveBrowserDocumentSynchronously(reordered, created.documentPath, created.sourceHash);
    await saveLocalDocument(created.document, created.documentPath, created.sourceHash);
    expect([...values.keys()].filter((key) => key.startsWith("laniakea.browser-recovery.v2.")))
      .toHaveLength(0);
    expect((await loadLocalDocument()).notice).toBeNull();
  });

  it("retains a newer snapshot with reordered siblings even when its text is unchanged", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const pending = saveLocalDocument(created.document, created.documentPath, created.sourceHash);
    const reordered = structuredClone(created.document);
    expect(reordered.nodes.root.children.length).toBeGreaterThan(1);
    reordered.nodes.root.children.reverse();
    saveBrowserDocumentSynchronously(reordered, created.documentPath, created.sourceHash);
    await pending;
    expect([...values.keys()].filter((key) => key.startsWith("laniakea.browser-recovery.v2.")))
      .toHaveLength(1);
    const restored = await loadLocalDocument();
    expect(restored.document?.nodes.root.children).toEqual(reordered.nodes.root.children);
    expect(restored.documentPath).not.toBe(created.documentPath);
  });

  it("keeps newer close-time content when an older save completes afterwards", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const writing = { ...created.document, title: "保存开始时的内容" };
    const pending = saveLocalDocument(writing, created.documentPath, created.sourceHash);
    const newest = { ...created.document, title: "保存期间追加并关闭" };
    saveBrowserDocumentSynchronously(newest, created.documentPath, created.sourceHash);
    await pending;
    const restored = await loadLocalDocument();
    expect(restored.document?.title).toBe(newest.title);
    expect((await openBrowserDocument(created.documentPath)).document.title).toBe(writing.title);
    expect(restored.documentPath).not.toBe(created.documentPath);
  });

  it("does not renew a stale tab's content lease through a view-only save", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const staleTab = await openBrowserDocument(created.documentPath);
    const currentTab = await openBrowserDocument(created.documentPath);
    const newer = { ...currentTab.document, title: "另一标签页的新内容" };
    await saveLocalDocument(
      newer,
      currentTab.documentPath,
      currentTab.sourceHash,
    );

    const panned = {
      ...staleTab.document,
      viewport: { x: 200, y: -80, zoom: 0.9 },
    };
    const viewSave = await saveLocalDocument(
      panned,
      staleTab.documentPath,
      staleTab.sourceHash,
      null,
      { viewportOnly: true },
    );

    expect(viewSave.sourceHash).toBe(staleTab.sourceHash);
    await expect(saveLocalDocument(
      { ...panned, title: "旧标签页的过期内容" },
      staleTab.documentPath,
      viewSave.sourceHash,
    )).rejects.toThrow("另一个标签页");
    expect((await openBrowserDocument(created.documentPath)).document.title)
      .toBe("另一标签页的新内容");
  });

  it("keeps each tab recovery record and only clears the tab that saved", async () => {
    const created = await createBrowserDocument(createSeedDocument());
    const tabA = { ...created.document, title: "标签页 A 未提交" };
    saveBrowserDocumentSynchronously(
      tabA,
      created.documentPath,
      created.sourceHash,
    );

    resetBrowserRecoveryTabForTests();
    const tabB = { ...created.document, title: "标签页 B 已保存" };
    saveBrowserDocumentSynchronously(
      tabB,
      created.documentPath,
      created.sourceHash,
    );
    await saveLocalDocument(
      tabB,
      created.documentPath,
      created.sourceHash,
    );

    const recoveryKeys = [...values.keys()].filter((key) =>
      key.startsWith("laniakea.browser-recovery.v2."),
    );
    expect(recoveryKeys).toHaveLength(1);

    const recovered = await loadLocalDocument();
    expect(recovered.document?.title).toBe("标签页 A 未提交");
    expect(recovered.documentPath).not.toBe(created.documentPath);
    expect((await openBrowserDocument(created.documentPath)).document.title)
      .toBe("标签页 B 已保存");
    expect(
      [...values.keys()].filter((key) =>
        key.startsWith("laniakea.browser-recovery.v2."),
      ),
    ).toHaveLength(0);
  });

  it("recognizes the injected desktop bridge even without the legacy flag", () => {
    (
      globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: object;
      }
    ).__TAURI_INTERNALS__ = {};

    expect(isDesktopRuntime()).toBe(true);
  });
});
