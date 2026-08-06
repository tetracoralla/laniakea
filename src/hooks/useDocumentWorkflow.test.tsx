// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";
import type { DocumentLoadResult } from "../persistence/localDocumentStore";
import {
  createBrowserDocument,
  openBrowserDocument,
  resetBrowserDocumentStoreForTests,
  saveBrowserDocument,
} from "../persistence/browserDocumentStore";
import { useDocumentWorkflow } from "./useDocumentWorkflow";

function preparedNewDocument() {
  return {
    document: createSeedDocument(),
    documentPath: "/app-data/drafts/未命名思维.md",
    sourceHash: "new-draft-hash",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  activateLocalDocument: vi.fn(),
  clearActiveDocument: vi.fn(),
  chooseDocumentToOpen: vi.fn(),
  chooseMarkdownDocumentPath: vi.fn(),
  discardInternalDraft: vi.fn(),
  desktopRuntime: true,
  openLocalDocument: vi.fn(),
  readOutlineFile: vi.fn(),
}));

vi.mock("../persistence/documentFileDialog", () => ({
  chooseDocumentToOpen: mocks.chooseDocumentToOpen,
  chooseMarkdownDocumentPath: mocks.chooseMarkdownDocumentPath,
}));

vi.mock("../persistence/localDocumentStore", () => ({
  activateLocalDocument: mocks.activateLocalDocument,
  clearActiveDocument: mocks.clearActiveDocument,
  discardInternalDraft: mocks.discardInternalDraft,
  browserDocumentConflictMessage: "browser conflict",
  externalDocumentConflictMessage: "external conflict",
  protectedSourceOverwriteMessage: "protected source",
  isBrowserDocumentPath: () => false,
  isDesktopRuntime: () => mocks.desktopRuntime,
  openLocalDocument: mocks.openLocalDocument,
  readOutlineFile: mocks.readOutlineFile,
  shouldFitLoadedDocument: (
    loaded: Pick<DocumentLoadResult, "viewStateRestored">,
  ) => !loaded.viewStateRestored,
}));

describe("document workflow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.chooseDocumentToOpen.mockReset();
    mocks.desktopRuntime = true;
    mocks.chooseMarkdownDocumentPath.mockReset();
    mocks.activateLocalDocument.mockReset();
    mocks.activateLocalDocument.mockResolvedValue(undefined);
    mocks.clearActiveDocument.mockReset();
    mocks.clearActiveDocument.mockResolvedValue(undefined);
    mocks.discardInternalDraft.mockReset();
    mocks.discardInternalDraft.mockResolvedValue(undefined);
    mocks.openLocalDocument.mockReset();
    mocks.readOutlineFile.mockReset();
    await resetBrowserDocumentStoreForTests();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    delete (window as Window & { showSaveFilePicker?: unknown })
      .showSaveFilePicker;
    delete (window as Window & { showOpenFilePicker?: unknown })
      .showOpenFilePicker;
  });

  it("fits an unbound rich Markdown copy when no viewport was restored", async () => {
    const loaded: DocumentLoadResult = {
      document: createSeedDocument(),
      documentPath: null,
      sourcePath: "/tmp/复杂方案.md",
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: true,
      viewStateRestored: false,
      sourceHash: null,
    };
    mocks.chooseDocumentToOpen.mockResolvedValue("/tmp/复杂方案.md");
    mocks.openLocalDocument.mockResolvedValue(loaded);
    const finishDocumentSwitch = vi.fn();
    const openDocument = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: null,
        currentDocumentPath: null,
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: async () => preparedNewDocument(),
        openDocument,
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch,
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return <button onClick={workflow.openImport}>打开</button>;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openDocument).toHaveBeenCalledWith(
      loaded.document,
      null,
      "/tmp/复杂方案.md",
      false,
      true,
      null,
      null,
    );
    expect(mocks.activateLocalDocument).toHaveBeenCalledWith(
      "/tmp/复杂方案.md",
    );
    expect(finishDocumentSwitch).toHaveBeenCalledWith(true);
    expect(mocks.chooseDocumentToOpen).toHaveBeenCalledWith({
      currentPath: null,
      recentDocuments: [],
    });
  });

  it("does not replace the current document when its pre-switch save fails", async () => {
    const newDocument = vi.fn(async () => preparedNewDocument());
    const beginBlankDocument = vi.fn();
    const saveBeforeSwitch = vi.fn(async () => false);

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument,
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch,
        beginBlankDocument,
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return <button onClick={workflow.createNewDocument}>新建</button>;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveBeforeSwitch).toHaveBeenCalledTimes(1);
    expect(newDocument).not.toHaveBeenCalled();
    expect(beginBlankDocument).not.toHaveBeenCalled();
  });

  it("offers to remove a missing recent file after the failed reopen", async () => {
    const notify = vi.fn();
    const removeRecentDocument = vi.fn();
    mocks.openLocalDocument.mockRejectedValue(
      new Error("这个文件已不存在"),
    );

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [
          {
            path: "/tmp/已移动.md",
            title: "已移动",
            lastOpenedAt: "2026-07-30T10:00:00.000Z",
          },
        ],
        saveState: "saved",
        saveError: null,
        notify,
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument,
      });
      return (
        <button
          onClick={() =>
            void workflow.openRecentDocument("/tmp/已移动.md")
          }
        >
          打开最近
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const notice = notify.mock.calls.at(-1)?.[0];
    expect(notice).toMatchObject({
      message: "这个文件已不存在",
      tone: "error",
      actionLabel: "移除记录",
    });
    notice.onAction();
    expect(removeRecentDocument).toHaveBeenCalledWith(
      "/tmp/已移动.md",
    );
  });

  it("moves an inactive local draft directly from the recent menu", async () => {
    const sourcePath =
      "/Users/adam/Library/Application Support/com.openadam.origin/drafts/想法.md";
    const targetPath = "/Users/adam/Documents/想法.md";
    const moveRecentDocument = vi.fn(async () => true);
    const notify = vi.fn();
    mocks.chooseMarkdownDocumentPath.mockResolvedValue(targetPath);

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [
          {
            path: sourcePath,
            title: "想法",
            lastOpenedAt: "2026-07-30T10:00:00.000Z",
          },
        ],
        saveState: "saved",
        saveError: null,
        notify,
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument,
        removeRecentDocument: vi.fn(),
      });
      return (
        <button
          onClick={() =>
            workflow.moveRecentDocumentToDirectory(sourcePath)
          }
        >
          移动
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.chooseMarkdownDocumentPath).toHaveBeenCalledWith(
      "想法",
      {
        currentPath: "/tmp/当前.md",
        recentDocuments: [
          expect.objectContaining({ path: sourcePath }),
        ],
      },
    );
    expect(moveRecentDocument).toHaveBeenCalledWith(
      sourcePath,
      targetPath,
    );
    expect(notify).toHaveBeenLastCalledWith({
      message: "已移动到新位置",
      tone: "neutral",
    });
  });

  it("keeps the last requested document when earlier loading finishes later", async () => {
    const a = deferred<DocumentLoadResult>();
    const b = deferred<DocumentLoadResult>();
    const documentA = createSeedDocument();
    documentA.title = "A";
    const documentB = createSeedDocument();
    documentB.title = "B";
    mocks.openLocalDocument.mockImplementation((path: string) =>
      path === "/tmp/A.md" ? a.promise : b.promise,
    );
    const openDocument = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: async () => preparedNewDocument(),
        openDocument,
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <>
          <button
            data-testid="open-a"
            onClick={() => void workflow.openRecentDocument("/tmp/A.md")}
          >
            A
          </button>
          <button
            data-testid="open-b"
            onClick={() => void workflow.openRecentDocument("/tmp/B.md")}
          >
            B
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='open-a']",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='open-b']",
      )!.click();
      await Promise.resolve();
    });

    await act(async () => {
      b.resolve({
        document: documentB,
        documentPath: "/tmp/B.md",
        sourcePath: "/tmp/B.md",
        recoveredFromBackup: false,
        notice: null,
        saveError: null,
        sourceFormat: "markdown",
        importedAsCopy: false,
        viewStateRestored: true,
        sourceHash: "hash-b",
      });
      await b.promise;
      await Promise.resolve();
    });
    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(mocks.activateLocalDocument).toHaveBeenCalledTimes(1);
    expect(mocks.activateLocalDocument).toHaveBeenCalledWith(
      "/tmp/B.md",
    );
    expect(openDocument).toHaveBeenLastCalledWith(
      documentB,
      "/tmp/B.md",
      "/tmp/B.md",
      false,
      false,
      "hash-b",
      null,
    );

    await act(async () => {
      a.resolve({
        document: documentA,
        documentPath: "/tmp/A.md",
        sourcePath: "/tmp/A.md",
        recoveredFromBackup: false,
        notice: null,
        saveError: null,
        sourceFormat: "markdown",
        importedAsCopy: false,
        viewStateRestored: true,
        sourceHash: "hash-a",
      });
      await a.promise;
      await Promise.resolve();
    });

    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(mocks.activateLocalDocument).toHaveBeenCalledTimes(1);
  });

  it("restores the visible document when a stale native activation finishes", async () => {
    const activatingA = deferred<void>();
    let startupPath = "/tmp/当前.md";
    const documentA = createSeedDocument();
    documentA.title = "A";
    mocks.openLocalDocument.mockImplementation((path: string) => {
      if (path === "/tmp/A.md") {
        return Promise.resolve({
          document: documentA,
          documentPath: "/tmp/A.md",
          sourcePath: "/tmp/A.md",
          recoveredFromBackup: false,
          notice: null,
          saveError: null,
          sourceFormat: "markdown" as const,
          importedAsCopy: false,
          viewStateRestored: true,
          sourceHash: "hash-a",
        });
      }
      return Promise.reject(new Error("B 无法打开"));
    });
    mocks.activateLocalDocument.mockImplementationOnce(async () => {
      await activatingA.promise;
      startupPath = "/tmp/A.md";
    });
    const retrySave = vi.fn(async () => true);
    const restoreActiveDocument = vi.fn(async () => {
      startupPath = "/tmp/当前.md";
    });
    const openDocument = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: async () => preparedNewDocument(),
        openDocument,
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave,
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
        restoreActiveDocument,
      });
      return (
        <>
          <button
            data-testid="open-a"
            onClick={() => void workflow.openRecentDocument("/tmp/A.md")}
          >
            A
          </button>
          <button
            data-testid="open-b"
            onClick={() => void workflow.openRecentDocument("/tmp/B.md")}
          >
            B
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='open-a']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.activateLocalDocument).toHaveBeenCalledWith("/tmp/A.md");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='open-b']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      activatingA.resolve();
      await activatingA.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openDocument).not.toHaveBeenCalled();
    expect(retrySave).toHaveBeenCalledTimes(1);
    expect(restoreActiveDocument).toHaveBeenCalledTimes(1);
    expect(startupPath).toBe("/tmp/当前.md");
  });

  it("lets a new document invalidate an earlier slow open request", async () => {
    let finishOpeningA!: (value: DocumentLoadResult) => void;
    const openingA = new Promise<DocumentLoadResult>((resolve) => {
      finishOpeningA = resolve;
    });
    mocks.openLocalDocument.mockReturnValue(openingA);
    const blank = preparedNewDocument();
    blank.document.title = "B";
    const openDocument = vi.fn();
    const beginBlankDocument = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: async () => blank,
        openDocument,
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument,
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <>
          <button
            data-testid="open-a"
            onClick={() => void workflow.openRecentDocument("/tmp/A.md")}
          >
            打开 A
          </button>
          <button
            data-testid="new-b"
            onClick={workflow.createNewDocument}
          >
            新建 B
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='open-a']",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='new-b']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenLastCalledWith(
      blank.document,
      blank.documentPath,
      blank.documentPath,
      false,
      false,
      blank.sourceHash,
    );
    expect(beginBlankDocument).toHaveBeenCalledWith(
      blank.document.rootId,
    );

    await act(async () => {
      finishOpeningA({
        document: createSeedDocument(),
        documentPath: "/tmp/A.md",
        sourcePath: "/tmp/A.md",
        recoveredFromBackup: false,
        notice: null,
        saveError: null,
        sourceFormat: "markdown",
        importedAsCopy: false,
        viewStateRestored: true,
        sourceHash: "hash-a",
      });
      await openingA;
      await Promise.resolve();
    });

    expect(openDocument).toHaveBeenCalledTimes(1);
  });

  it("lets a browser import invalidate an earlier slow open request", async () => {
    mocks.desktopRuntime = false;
    let finishOpeningA!: (value: DocumentLoadResult) => void;
    const openingA = new Promise<DocumentLoadResult>((resolve) => {
      finishOpeningA = resolve;
    });
    mocks.openLocalDocument.mockReturnValue(openingA);
    const replaceDocument = vi.fn();
    const importedFile = {
      name: "导入.md",
      text: vi.fn(async () => "# 导入\n\n- 新内容\n"),
    } as unknown as File;
    const openDocument = vi.fn();
    const newDocument = vi.fn(async (document = createSeedDocument()) => ({
      document,
      documentPath: "browser://laniakea/imported",
      sourceHash: "laniakea-browser:imported:1",
    }));

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument,
        openDocument,
        replaceDocument,
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <>
          <button
            data-testid="open-a"
            onClick={() => void workflow.openRecentDocument("/tmp/A.md")}
          >
            打开 A
          </button>
          <button
            data-testid="import"
            onClick={() => void workflow.importFile(importedFile)}
          >
            导入
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='open-a']",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='import']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(newDocument).toHaveBeenCalledTimes(1);
    expect(replaceDocument).not.toHaveBeenCalled();
    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "导入" }),
      "browser://laniakea/imported",
      "browser://laniakea/imported",
      false,
      false,
      "laniakea-browser:imported:1",
      null,
    );

    await act(async () => {
      finishOpeningA({
        document: createSeedDocument(),
        documentPath: "/tmp/A.md",
        sourcePath: "/tmp/A.md",
        recoveredFromBackup: false,
        notice: null,
        saveError: null,
        sourceFormat: "markdown",
        importedAsCopy: false,
        viewStateRestored: true,
        sourceHash: "hash-a",
      });
      await openingA;
      await Promise.resolve();
    });

    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(replaceDocument).not.toHaveBeenCalled();
  });

  it("discards a prepared new draft when a later import supersedes it", async () => {
    let finishPreparing!: (
      value: ReturnType<typeof preparedNewDocument>,
    ) => void;
    const preparing = new Promise<ReturnType<typeof preparedNewDocument>>(
      (resolve) => {
        finishPreparing = resolve;
      },
    );
    const candidate = preparedNewDocument();
    const replaceDocument = vi.fn();
    const importedFile = {
      name: "后来导入.md",
      text: vi.fn(async () => "# 后来导入\n\n- 最新内容\n"),
    } as unknown as File;
    const openDocument = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: () => preparing,
        openDocument,
        replaceDocument,
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <>
          <button
            data-testid="new"
            onClick={workflow.createNewDocument}
          >
            新建
          </button>
          <button
            data-testid="import"
            onClick={() => void workflow.importFile(importedFile)}
          >
            导入
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='new']",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='import']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      finishPreparing(candidate);
      await preparing;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replaceDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).not.toHaveBeenCalled();
    expect(mocks.discardInternalDraft).toHaveBeenCalledWith(
      candidate.documentPath,
    );
  });

  it("saves the current edit before exporting a complete browser backup", async () => {
    mocks.desktopRuntime = false;
    const created = await createBrowserDocument(createSeedDocument());
    const edited = { ...created.document, title: "刚刚修改" };
    const saveBeforeSwitch = vi.fn(async () => {
      await saveBrowserDocument(
        edited,
        created.documentPath,
        created.sourceHash,
      );
      return true;
    });
    const notify = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const createObjectURL = vi.fn(() => "blob:backup");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: edited,
        documentPath: created.documentPath,
        currentDocumentPath: created.documentPath,
        recentDocuments: [],
        saveState: "saving",
        saveError: null,
        notify,
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch,
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <button onClick={() => void workflow.exportFullBackup()}>
          导出完整备份
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveBeforeSwitch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
    expect((await openBrowserDocument(created.documentPath)).document.title)
      .toBe("刚刚修改");
    expect(notify).toHaveBeenCalledWith({
      message: "已导出 1 张思维导图的完整备份",
    });
  });

  it("stops complete backup export when the current save fails", async () => {
    mocks.desktopRuntime = false;
    const notify = vi.fn();
    const createObjectURL = vi.fn(() => "blob:backup");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "browser://laniakea/current",
        currentDocumentPath: "browser://laniakea/current",
        recentDocuments: [],
        saveState: "error",
        saveError: "无法保存",
        notify,
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => false),
        saveBeforeSwitch: vi.fn(async () => false),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <button onClick={() => void workflow.exportFullBackup()}>
          导出完整备份
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({
      message: "当前思维导图保存失败，未导出完整备份",
      tone: "error",
    });
  });

  it("keeps a browser conflict as a copy and then allows a new document", async () => {
    mocks.desktopRuntime = false;
    let preserved = false;
    const preserveCurrentAsBrowserCopy = vi.fn(async () => {
      preserved = true;
      return {
        document: createSeedDocument(),
        documentPath: "browser://laniakea/conflict-copy",
        sourceHash: "laniakea-browser:conflict-copy:1",
      };
    });
    const newDocument = vi.fn(async () => preparedNewDocument());
    const notify = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "browser://laniakea/stale",
        currentDocumentPath: "browser://laniakea/stale",
        recentDocuments: [],
        saveState: "error",
        saveError: "browser conflict",
        notify,
        newDocument,
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => false),
        saveBeforeSwitch: vi.fn(async () => preserved),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
        preserveCurrentAsBrowserCopy,
      });
      return <button onClick={workflow.createNewDocument}>新建</button>;
    }

    await act(async () => root.render(<Harness />));
    const conflictNotice = notify.mock.calls
      .map(([notice]) => notice)
      .find((notice) => notice.actionLabel === "保留为副本");
    expect(conflictNotice).toBeTruthy();
    await act(async () => {
      conflictNotice.onAction();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(preserveCurrentAsBrowserCopy).toHaveBeenCalledTimes(1);
    expect(newDocument).toHaveBeenCalledTimes(1);
  });

  it("suggests a different Save As filename for a protected rich Markdown source", async () => {
    const document = createSeedDocument();
    document.title = "复杂方案";
    mocks.chooseMarkdownDocumentPath.mockResolvedValue(null);

    function Harness() {
      const workflow = useDocumentWorkflow({
        document,
        documentPath: null,
        currentDocumentPath: "/tmp/复杂方案.md",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <button onClick={() => void workflow.saveAsMarkdownDocument()}>
          另存为
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
    });

    expect(mocks.chooseMarkdownDocumentPath).toHaveBeenCalledWith(
      "复杂方案 - 另存",
      {
        currentPath: "/tmp/复杂方案.md",
        recentDocuments: [],
      },
    );
  });

  it("writes Markdown through the browser file picker when available", async () => {
    mocks.desktopRuntime = false;
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: showSaveFilePicker,
    });
    const notify = vi.fn();

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "browser://laniakea/current",
        currentDocumentPath: "browser://laniakea/current",
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify,
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <button onClick={() => void workflow.saveAsMarkdownDocument()}>
          另存为
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "思维导图工具.md" }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("做一个思维导图 APP"),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      message: "Markdown 已保存到所选文件",
    });
  });

  it("restores rich Markdown if the save picker clears the protected source before rejecting it", async () => {
    mocks.desktopRuntime = false;
    const originalSource =
      "# 研究\n\n| 项目 | 结论 |\n| --- | --- |\n| A | B |\n";
    let sourceContent = originalSource;
    const importedFile = {
      name: "研究.md",
      text: vi.fn(async () => sourceContent),
    } as unknown as File;
    const sourceWrite = vi.fn(async (data: string | ArrayBuffer) => {
      sourceContent = typeof data === "string"
        ? data
        : new TextDecoder().decode(data);
    });
    const sourceClose = vi.fn(async () => undefined);
    const sourceHandle = {
      createWritable: vi.fn(),
      getFile: vi.fn(async () => ({
        arrayBuffer: async () =>
          new TextEncoder().encode(sourceContent).buffer,
      } as File)),
    };
    const createWritable = vi.fn(async () => ({
      write: sourceWrite,
      close: sourceClose,
    }));
    const targetHandle = {
      createWritable,
      isSameEntry: vi.fn(async (other: unknown) => other === sourceHandle),
    };
    const showSaveFilePicker = vi.fn(async () => {
      sourceContent = "";
      return targetHandle;
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: showSaveFilePicker,
    });
    const newDocument = vi.fn(async (
      document = createSeedDocument(),
    ) => ({
      document,
      documentPath: "browser://laniakea/imported-rich",
      sourceHash: "laniakea-browser:imported-rich:1",
    }));
    const notify = vi.fn();

    function Harness() {
      const [active, setActive] = useState({
        document: createSeedDocument(),
        path: "browser://laniakea/current",
        protectedSourceName: null as string | null,
      });
      const workflow = useDocumentWorkflow({
        document: active.document,
        documentPath: active.path,
        currentDocumentPath: active.path,
        protectedBrowserSourceName: active.protectedSourceName,
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        isDocumentSessionCurrent: () => false,
        notify,
        newDocument,
        openDocument: (
          document,
          path,
          _sourcePath,
          _recovered,
          _protectedCopy,
          _sourceHash,
          protectedSourceName,
        ) => setActive({
          document,
          path: path!,
          protectedSourceName: protectedSourceName ?? null,
        }),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <>
          <button
            data-testid="import-rich"
            onClick={() =>
              void workflow.importFile(importedFile, sourceHandle)
            }
          >
            导入
          </button>
          <button
            data-testid="save-rich"
            onClick={() => void workflow.saveAsMarkdownDocument()}
          >
            另存为
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='import-rich']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='save-rich']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(newDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "研究" }),
      { name: "研究.md" },
    );
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "研究 - Laniakea.md" }),
    );
    expect(targetHandle.isSameEntry).toHaveBeenCalledWith(sourceHandle);
    expect(createWritable).toHaveBeenCalledTimes(1);
    expect(sourceHandle.createWritable).not.toHaveBeenCalled();
    expect(sourceWrite).toHaveBeenCalledTimes(1);
    expect(typeof sourceWrite.mock.calls[0]![0]).not.toBe("string");
    expect(
      (sourceWrite.mock.calls[0]![0] as ArrayBuffer).byteLength,
    ).toBeGreaterThan(0);
    expect(sourceClose).toHaveBeenCalledTimes(1);
    expect(sourceContent).toBe(originalSource);
    expect(notify).toHaveBeenCalledWith({
      message: "protected source",
      tone: "error",
    });
  });

  it("does not save a newer document through an older Save As dialog", async () => {
    const choosingPath = deferred<string | null>();
    mocks.chooseMarkdownDocumentPath.mockReturnValue(choosingPath.promise);
    const saveDocumentAs = vi.fn(async () => true);
    const notify = vi.fn();
    let activeSession = 1;

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/A.md",
        currentDocumentPath: "/tmp/A.md",
        documentSessionId: 1,
        isDocumentSessionCurrent: (sessionId) =>
          sessionId === activeSession,
        recentDocuments: [],
        saveState: "saved",
        saveError: null,
        notify,
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs,
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument: vi.fn(async () => true),
        removeRecentDocument: vi.fn(),
      });
      return (
        <button onClick={() => void workflow.saveAsMarkdownDocument()}>
          另存为
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
    });
    activeSession = 2;
    await act(async () => {
      choosingPath.resolve("/tmp/A-副本.md");
      await choosingPath.promise;
      await Promise.resolve();
    });

    expect(saveDocumentAs).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "已另存为 Markdown" }),
    );
  });

  it("does not move a recent draft after the active document changed", async () => {
    const sourcePath =
      "/Users/adam/Library/Application Support/com.openadam.origin/drafts/A.md";
    const choosingPath = deferred<string | null>();
    mocks.chooseMarkdownDocumentPath.mockReturnValue(choosingPath.promise);
    const moveRecentDocument = vi.fn(async () => true);
    let activeSession = 1;

    function Harness() {
      const workflow = useDocumentWorkflow({
        document: createSeedDocument(),
        documentPath: "/tmp/当前.md",
        currentDocumentPath: "/tmp/当前.md",
        documentSessionId: 1,
        isDocumentSessionCurrent: (sessionId) =>
          sessionId === activeSession,
        recentDocuments: [
          {
            path: sourcePath,
            title: "A",
            lastOpenedAt: "2026-07-31T10:00:00.000Z",
          },
        ],
        saveState: "saved",
        saveError: null,
        notify: vi.fn(),
        newDocument: async () => preparedNewDocument(),
        openDocument: vi.fn(),
        replaceDocument: vi.fn(),
        saveDocumentAs: vi.fn(async () => true),
        retrySave: vi.fn(async () => true),
        saveBeforeSwitch: vi.fn(async () => true),
        beginBlankDocument: vi.fn(),
        finishDocumentSwitch: vi.fn(),
        moveRecentDocument,
        removeRecentDocument: vi.fn(),
      });
      return (
        <button
          onClick={() =>
            workflow.moveRecentDocumentToDirectory(sourcePath)
          }
        >
          移动
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
    });
    activeSession = 2;
    await act(async () => {
      choosingPath.resolve("/tmp/A.md");
      await choosingPath.promise;
      await Promise.resolve();
    });

    expect(moveRecentDocument).not.toHaveBeenCalled();
  });
});
