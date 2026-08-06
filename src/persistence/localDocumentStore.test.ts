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
