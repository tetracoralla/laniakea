// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";
import type { DocumentLoadResult } from "../persistence/localDocumentStore";
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
  externalDocumentConflictMessage: "external conflict",
  isDesktopRuntime: () => true,
  openLocalDocument: mocks.openLocalDocument,
  readOutlineFile: mocks.readOutlineFile,
  shouldFitLoadedDocument: (
    loaded: Pick<DocumentLoadResult, "viewStateRestored">,
  ) => !loaded.viewStateRestored,
}));

describe("document workflow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.chooseDocumentToOpen.mockReset();
    mocks.chooseMarkdownDocumentPath.mockReset();
    mocks.activateLocalDocument.mockReset();
    mocks.activateLocalDocument.mockResolvedValue(undefined);
    mocks.clearActiveDocument.mockReset();
    mocks.clearActiveDocument.mockResolvedValue(undefined);
    mocks.discardInternalDraft.mockReset();
    mocks.discardInternalDraft.mockResolvedValue(undefined);
    mocks.openLocalDocument.mockReset();
    mocks.readOutlineFile.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
    mocks.activateLocalDocument.mockReturnValueOnce(activatingA.promise);
    const retrySave = vi.fn(async () => true);
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

    expect(replaceDocument).toHaveBeenCalledTimes(1);

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

    expect(openDocument).not.toHaveBeenCalled();
    expect(replaceDocument).toHaveBeenCalledTimes(1);
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
