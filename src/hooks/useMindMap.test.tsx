// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";
import { setNodeText } from "../model/tree";
import { useMindMap } from "./useMindMap";

const persistence = vi.hoisted(() => ({
  clearActiveDocument: vi.fn(),
  createMarkdownDraft: vi.fn(),
  desktopRuntime: false,
  loadLocalDocument: vi.fn(),
  moveInternalDraft: vi.fn(),
  saveBrowserDocumentSynchronously: vi.fn(),
  saveLocalDocument: vi.fn(),
}));

const lifecycle = vi.hoisted(() => ({
  exitHandler: null as null | (() => void | Promise<void>),
  hide: vi.fn(),
  listenForApplicationExit: vi.fn(
    async (handler: () => void | Promise<void>) => {
      lifecycle.exitHandler = handler;
      return vi.fn();
    },
  ),
  onCloseRequested: vi.fn(
    async (
      handler: (event: { preventDefault: () => void }) => void | Promise<void>,
    ) => {
      lifecycle.closeHandler = handler;
      return vi.fn();
    },
  ),
  closeHandler: null as null | ((
    event: { preventDefault: () => void },
  ) => void | Promise<void>),
  resolveApplicationExit: vi.fn(async () => undefined),
}));

vi.mock("../persistence/localDocumentStore", () => ({
  clearActiveDocument: persistence.clearActiveDocument,
  createMarkdownDraft: persistence.createMarkdownDraft,
  isDesktopRuntime: () => persistence.desktopRuntime,
  loadLocalDocument: persistence.loadLocalDocument,
  moveInternalDraft: persistence.moveInternalDraft,
  saveBrowserDocumentSynchronously:
    persistence.saveBrowserDocumentSynchronously,
  saveLocalDocument: persistence.saveLocalDocument,
}));

vi.mock("../desktop/applicationLifecycle", () => ({
  listenForApplicationExit: lifecycle.listenForApplicationExit,
  resolveApplicationExit: lifecycle.resolveApplicationExit,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide: lifecycle.hide,
    onCloseRequested: lifecycle.onCloseRequested,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

describe("mind map save presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    window.localStorage.clear();
    persistence.desktopRuntime = false;
    persistence.clearActiveDocument.mockReset();
    persistence.createMarkdownDraft.mockReset();
    persistence.moveInternalDraft.mockReset();
    persistence.moveInternalDraft.mockResolvedValue({
      sourceHash: "hash-moved",
    });
    persistence.saveBrowserDocumentSynchronously.mockReset();
    persistence.saveLocalDocument.mockReset();
    persistence.saveLocalDocument.mockResolvedValue({
      sourceHash: "hash-v1",
    });
    lifecycle.closeHandler = null;
    lifecycle.exitHandler = null;
    lifecycle.hide.mockReset();
    lifecycle.listenForApplicationExit.mockClear();
    lifecycle.onCloseRequested.mockClear();
    lifecycle.resolveApplicationExit.mockClear();
    const loadedDocument = createSeedDocument();
    persistence.loadLocalDocument.mockReset();
    persistence.loadLocalDocument.mockResolvedValue({
      document: loadedDocument,
      documentPath: "/tmp/方案.md",
      sourcePath: "/tmp/方案.md",
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: false,
      viewStateRestored: true,
      sourceHash: "hash-v1",
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("persists viewport changes silently while content edits show saving", async () => {
    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="save-state">{mindMap.saveState}</output>
          <button
            data-testid="pan"
            onClick={() =>
              mindMap.setViewport({ x: 120, y: -40, zoom: 0.8 })
            }
          >
            平移
          </button>
          <button
            data-testid="edit"
            onClick={() =>
              mindMap.applyMutation((current) =>
                setNodeText(
                  current.document,
                  current.document.rootId,
                  "内容已修改",
                ),
              )
            }
          >
            编辑
          </button>
          <button
            data-testid="pan-after-edit"
            onClick={() =>
              mindMap.setViewport({ x: 240, y: -80, zoom: 0.8 })
            }
          >
            编辑后平移
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saved");
    persistence.saveLocalDocument.mockClear();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='pan']",
      )!.click();
    });
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saved");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(899);
    });
    expect(persistence.saveLocalDocument).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(persistence.saveLocalDocument).toHaveBeenCalledTimes(1);
    expect(persistence.saveLocalDocument).toHaveBeenCalledWith(
      expect.any(Object),
      "/tmp/方案.md",
      "hash-v1",
      null,
      { viewportOnly: true },
    );
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saved");

    persistence.saveLocalDocument.mockClear();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit']",
      )!.click();
    });
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saving");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='pan-after-edit']",
      )!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(899);
    });
    expect(persistence.saveLocalDocument).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saving");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(persistence.saveLocalDocument).toHaveBeenCalledTimes(1);
    expect(persistence.saveLocalDocument).toHaveBeenCalledWith(
      expect.any(Object),
      "/tmp/方案.md",
      "hash-v1",
      null,
    );
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saved");
  });

  it("surfaces a silent viewport save failure", async () => {
    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="save-state">{mindMap.saveState}</output>
          <output data-testid="save-error">{mindMap.saveError}</output>
          <button
            data-testid="pan"
            onClick={() =>
              mindMap.setViewport({ x: 80, y: 25, zoom: 0.9 })
            }
          >
            平移
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockReset();
    persistence.saveLocalDocument.mockRejectedValueOnce(
      new Error("文件已在外部修改或移动，原文件未被覆盖。"),
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='pan']",
      )!.click();
      await vi.advanceTimersByTimeAsync(900);
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("error");
    expect(
      container.querySelector("[data-testid='save-error']")?.textContent,
    ).toContain("文件已在外部修改或移动");
  });

  it("advances the source hash after a committed save with an auxiliary warning", async () => {
    persistence.saveLocalDocument
      .mockResolvedValueOnce({
        sourceHash: "hash-v2",
        auxiliaryWarning:
          "正文已经保存，但本地视图状态或旧备份清理未完成。",
      })
      .mockResolvedValueOnce({
        sourceHash: "hash-v3",
        auxiliaryWarning: null,
      });

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="save-warning">{mindMap.saveWarning}</output>
          <button
            data-testid="edit-one"
            onClick={() =>
              mindMap.applyMutation((current) =>
                setNodeText(
                  current.document,
                  current.document.rootId,
                  "第一轮应用内修改",
                ),
              )
            }
          >
            第一次编辑
          </button>
          <button
            data-testid="edit-two"
            onClick={() =>
              mindMap.applyMutation((current) =>
                setNodeText(
                  current.document,
                  current.document.rootId,
                  "第二轮应用内修改",
                ),
              )
            }
          >
            第二次编辑
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit-one']",
      )!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='save-warning']")?.textContent,
    ).toContain("正文已经保存");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit-two']",
      )!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
      await Promise.resolve();
    });

    expect(persistence.saveLocalDocument).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      "/tmp/方案.md",
      "hash-v2",
      null,
    );
  });

  it("waits for the latest save before approving a native application exit", async () => {
    let completeSave!: (value: { sourceHash: string }) => void;
    const pendingSave = new Promise<{ sourceHash: string }>((resolve) => {
      completeSave = resolve;
    });
    persistence.desktopRuntime = true;
    persistence.saveLocalDocument.mockReturnValueOnce(pendingSave);

    function Harness() {
      const mindMap = useMindMap();
      return (
        <button
          data-testid="edit"
          onClick={() =>
            mindMap.applyMutation((current) =>
              setNodeText(
                current.document,
                current.document.rootId,
                "退出前必须保存",
              ),
            )
          }
        >
          编辑
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit']",
      )!.click();
    });
    let exitHandling!: Promise<void>;
    await act(async () => {
      exitHandling = Promise.resolve(lifecycle.exitHandler?.());
      await Promise.resolve();
    });

    expect(persistence.saveLocalDocument).toHaveBeenCalledTimes(1);
    expect(lifecycle.resolveApplicationExit).not.toHaveBeenCalled();

    await act(async () => {
      completeSave({ sourceHash: "hash-exit" });
      await exitHandling;
    });

    expect(lifecycle.resolveApplicationExit).toHaveBeenCalledWith(true);
  });

  it("commits the focused editor before a native application exit saves", async () => {
    persistence.desktopRuntime = true;

    function Harness() {
      const mindMap = useMindMap({
        prepareForLifecycleSave: () => {
          flushSync(() => {
            const activeElement = globalThis.document.activeElement;
            if (activeElement instanceof HTMLElement) activeElement.blur();
          });
        },
      });
      return (
        <textarea
          defaultValue={mindMap.snapshot.document.nodes.root.text}
          onBlur={(event) =>
            mindMap.applyMutation((current) =>
              setNodeText(
                current.document,
                current.document.rootId,
                event.currentTarget.value,
              ),
            )
          }
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockClear();
    const editor = container.querySelector("textarea")!;
    editor.value = "退出前仍在输入框里的最新内容";
    editor.focus();

    await act(async () => {
      await lifecycle.exitHandler?.();
    });

    expect(persistence.saveLocalDocument).toHaveBeenCalledTimes(1);
    const savedDocument = persistence.saveLocalDocument.mock.calls[0][0];
    expect(savedDocument.nodes[savedDocument.rootId].text).toBe(
      "退出前仍在输入框里的最新内容",
    );
    expect(lifecycle.resolveApplicationExit).toHaveBeenCalledWith(true);
  });

  it("keeps the window visible when its close-triggered save fails", async () => {
    persistence.desktopRuntime = true;
    persistence.saveLocalDocument.mockRejectedValueOnce(
      new Error("磁盘暂时不可写"),
    );
    const preventDefault = vi.fn();
    function Harness() {
      useMindMap();
      return null;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await lifecycle.closeHandler?.({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(lifecycle.hide).not.toHaveBeenCalled();
  });

  it("hides the window only after its close-triggered save completes", async () => {
    let completeSave!: (value: { sourceHash: string }) => void;
    const pendingSave = new Promise<{ sourceHash: string }>((resolve) => {
      completeSave = resolve;
    });
    persistence.desktopRuntime = true;
    persistence.saveLocalDocument.mockReturnValueOnce(pendingSave);
    const preventDefault = vi.fn();
    function Harness() {
      useMindMap();
      return null;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    let closeHandling!: Promise<void>;
    await act(async () => {
      closeHandling = Promise.resolve(
        lifecycle.closeHandler?.({ preventDefault }),
      );
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(lifecycle.hide).not.toHaveBeenCalled();

    await act(async () => {
      completeSave({ sourceHash: "hash-close" });
      await closeHandling;
    });

    expect(lifecycle.hide).toHaveBeenCalledTimes(1);
  });

  it("keeps an unbound rich Markdown source in recent documents and defers viewport-only autosave", async () => {
    const richDocument = createSeedDocument();
    persistence.loadLocalDocument.mockResolvedValueOnce({
      document: richDocument,
      documentPath: null,
      sourcePath: "/tmp/复杂方案.md",
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: true,
      viewStateRestored: false,
      sourceHash: null,
    });

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="binding">{mindMap.documentPath}</output>
          <output data-testid="source">
            {mindMap.sourceDocumentPath}
          </output>
          <output data-testid="recent">
            {mindMap.recentDocuments.map((item) => item.path).join("|")}
          </output>
          <button
            data-testid="pan"
            onClick={() =>
              mindMap.setViewport({ x: 40, y: -20, zoom: 0.85 })
            }
          >
            平移
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockClear();

    expect(
      container.querySelector("[data-testid='binding']")?.textContent,
    ).toBe("");
    expect(
      container.querySelector("[data-testid='source']")?.textContent,
    ).toBe("/tmp/复杂方案.md");
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).toContain("/tmp/复杂方案.md");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='pan']",
      )!.click();
      await vi.advanceTimersByTimeAsync(900);
      await Promise.resolve();
    });

    expect(persistence.saveLocalDocument).not.toHaveBeenCalled();
  });

  it("keeps the rich Markdown source protected after editing and rejects Save As to that source", async () => {
    const sourcePath = "/tmp/复杂方案.md";
    const richDocument = createSeedDocument();
    persistence.desktopRuntime = true;
    persistence.loadLocalDocument.mockResolvedValueOnce({
      document: richDocument,
      documentPath: null,
      sourcePath,
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: true,
      viewStateRestored: false,
      sourceHash: null,
    });
    persistence.saveLocalDocument.mockImplementation(
      async (_document, path, _expectedHash, protectedSourcePath) => {
        if (path === sourcePath && protectedSourcePath === sourcePath) {
          throw new Error(
            "这个文件包含原点无法完整保留的 Markdown 内容，请另存到其他位置。",
          );
        }
        return { sourceHash: "recovery-hash" };
      },
    );

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="path">{mindMap.documentPath}</output>
          <output data-testid="save-state">{mindMap.saveState}</output>
          <button
            data-testid="edit"
            onClick={() =>
              mindMap.applyMutation((current) =>
                setNodeText(
                  current.document,
                  current.document.rootId,
                  "编辑后的普通大纲",
                ),
              )
            }
          >
            编辑
          </button>
          <button
            data-testid="save-as-source"
            onClick={() => void mindMap.saveDocumentAs(sourcePath)}
          >
            另存到源文件
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit']",
      )!.click();
      await vi.advanceTimersByTimeAsync(320);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='save-as-source']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistence.saveLocalDocument).toHaveBeenLastCalledWith(
      expect.any(Object),
      sourcePath,
      null,
      sourcePath,
    );
    expect(
      container.querySelector("[data-testid='path']")?.textContent,
    ).toBe("");
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("error");
  });

  it("settles an earlier saving state after switching to an already-saved document", async () => {
    const richDocument = createSeedDocument();
    const nextDocument = {
      ...createSeedDocument(),
      id: "next-document",
      title: "下一份思维",
    };
    persistence.desktopRuntime = true;
    persistence.loadLocalDocument.mockResolvedValueOnce({
      document: richDocument,
      documentPath: null,
      sourcePath: "/tmp/复杂方案.md",
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: true,
      viewStateRestored: false,
      sourceHash: null,
    });
    persistence.createMarkdownDraft.mockResolvedValueOnce({
      documentPath: "/app-data/drafts/复杂方案.md",
      sourceHash: "hash-draft",
    });

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="save-state">{mindMap.saveState}</output>
          <button
            data-testid="prepare-switch"
            onClick={() => void mindMap.saveBeforeSwitch()}
          >
            保存当前文档
          </button>
          <button
            data-testid="install-next"
            onClick={() =>
              mindMap.openDocument(
                nextDocument,
                "/tmp/下一份思维.md",
                "/tmp/下一份思维.md",
                false,
                false,
                "hash-next",
              )
            }
          >
            安装下一份文档
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='prepare-switch']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saving");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='install-next']",
      )!.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='save-state']")?.textContent,
    ).toBe("saved");
  });

  it("serializes pre-switch saves so an unbound document creates only one draft", async () => {
    const richDocument = createSeedDocument();
    const creatingDraft = deferred<{
      documentPath: string;
      sourceHash: string;
    }>();
    persistence.desktopRuntime = true;
    persistence.loadLocalDocument.mockResolvedValueOnce({
      document: richDocument,
      documentPath: null,
      sourcePath: "/tmp/复杂方案.md",
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: true,
      viewStateRestored: false,
      sourceHash: null,
    });
    persistence.createMarkdownDraft.mockReturnValueOnce(
      creatingDraft.promise,
    );
    let switches: Promise<boolean[]> | null = null;

    function Harness() {
      const mindMap = useMindMap();
      return (
        <button
          onClick={() => {
            switches = Promise.all([
              mindMap.saveBeforeSwitch(),
              mindMap.saveBeforeSwitch(),
            ]);
          }}
        >
          连续切换
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockClear();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
    });

    expect(persistence.createMarkdownDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      creatingDraft.resolve({
        documentPath: "/app-data/drafts/复杂方案.md",
        sourceHash: "hash-draft",
      });
      await switches;
    });

    expect(persistence.createMarkdownDraft).toHaveBeenCalledTimes(1);
    expect(persistence.saveLocalDocument).toHaveBeenCalledTimes(1);
    expect(persistence.saveLocalDocument).toHaveBeenCalledWith(
      expect.any(Object),
      "/app-data/drafts/复杂方案.md",
      "hash-draft",
      null,
    );
  });

  it("turns Save As into a move only for the current internal draft", async () => {
    const internalPath =
      "/Users/adam/Library/Application Support/com.openadam.origin/drafts/想法.md";
    const targetPath = "/Users/adam/Documents/想法.md";
    const internalDocument = createSeedDocument();
    persistence.desktopRuntime = true;
    persistence.loadLocalDocument.mockResolvedValueOnce({
      document: internalDocument,
      documentPath: internalPath,
      sourcePath: internalPath,
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: false,
      viewStateRestored: true,
      sourceHash: "hash-internal",
    });

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="path">{mindMap.documentPath}</output>
          <output data-testid="recent">
            {mindMap.recentDocuments.map((item) => item.path).join("|")}
          </output>
          <button
            data-testid="save-as"
            onClick={() => void mindMap.saveDocumentAs(targetPath)}
          >
            另存为
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockClear();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='save-as']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistence.saveLocalDocument).toHaveBeenCalledWith(
      internalDocument,
      internalPath,
      "hash-internal",
      null,
    );
    expect(persistence.moveInternalDraft).toHaveBeenCalledWith(
      internalPath,
      targetPath,
    );
    expect(
      container.querySelector("[data-testid='path']")?.textContent,
    ).toBe(targetPath);
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).toContain(targetPath);
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).not.toContain(internalPath);
  });

  it("keeps Save As as a copy-and-rebind operation for an external file", async () => {
    const targetPath = "/tmp/方案副本.md";
    persistence.desktopRuntime = true;

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="path">{mindMap.documentPath}</output>
          <button
            data-testid="save-as"
            onClick={() => void mindMap.saveDocumentAs(targetPath)}
          >
            另存为
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockClear();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='save-as']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistence.moveInternalDraft).not.toHaveBeenCalled();
    expect(persistence.saveLocalDocument).toHaveBeenCalledWith(
      expect.any(Object),
      targetPath,
      null,
      null,
    );
    expect(
      container.querySelector("[data-testid='path']")?.textContent,
    ).toBe(targetPath);
  });

  it("moves an inactive internal draft without switching the current document", async () => {
    const internalPath =
      "/Users/adam/Library/Application Support/com.openadam.origin/drafts/旧想法.md";
    const targetPath = "/Users/adam/Documents/旧想法.md";
    localStorage.setItem(
      "origin.recent-documents.v1",
      JSON.stringify([
        {
          path: internalPath,
          title: "旧想法",
          lastOpenedAt: "2026-07-28T10:00:00.000Z",
        },
      ]),
    );
    persistence.desktopRuntime = true;

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="path">{mindMap.documentPath}</output>
          <output data-testid="recent">
            {mindMap.recentDocuments.map((item) => item.path).join("|")}
          </output>
          <button
            data-testid="move"
            onClick={() =>
              void mindMap.moveRecentDocument(
                internalPath,
                targetPath,
              )
            }
          >
            移动
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='move']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistence.moveInternalDraft).toHaveBeenCalledWith(
      internalPath,
      targetPath,
    );
    expect(
      container.querySelector("[data-testid='path']")?.textContent,
    ).toBe("/tmp/方案.md");
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).toContain(targetPath);
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).not.toContain(internalPath);
  });

  it("binds a new map to its own Markdown draft and remembers both documents", async () => {
    persistence.desktopRuntime = true;
    persistence.createMarkdownDraft.mockResolvedValue({
      documentPath: "/app-data/drafts/未命名思维-2.md",
      sourceHash: "hash-draft",
    });

    function Harness() {
      const mindMap = useMindMap();
      return (
        <>
          <output data-testid="path">{mindMap.documentPath}</output>
          <output data-testid="recent">
            {mindMap.recentDocuments.map((item) => item.path).join("|")}
          </output>
          <button
            data-testid="new"
            onClick={() => void (async () => {
              const blank = await mindMap.newDocument();
              mindMap.openDocument(
                blank.document,
                blank.documentPath,
                blank.documentPath,
                false,
                false,
                blank.sourceHash,
              );
            })()}
          >
            新建
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='new']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='path']")?.textContent,
    ).toBe("/app-data/drafts/未命名思维-2.md");
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).toContain("/tmp/方案.md");
    expect(
      container.querySelector("[data-testid='recent']")?.textContent,
    ).toContain("/app-data/drafts/未命名思维-2.md");
  });

  it("keeps saves bound to the active document across edit A -> new B -> edit B", async () => {
    persistence.desktopRuntime = true;
    persistence.createMarkdownDraft.mockResolvedValue({
      documentPath: "/app-data/drafts/B.md",
      sourceHash: "hash-b1",
    });
    persistence.saveLocalDocument.mockImplementation(
      async (_document, path) => ({
        sourceHash: path === "/tmp/方案.md" ? "hash-a2" : "hash-b2",
      }),
    );

    function Harness() {
      const mindMap = useMindMap();
      const createNextDocument = async () => {
        if (await mindMap.saveBeforeSwitch()) {
          const blank = await mindMap.newDocument();
          mindMap.openDocument(
            blank.document,
            blank.documentPath,
            blank.documentPath,
            false,
            false,
            blank.sourceHash,
          );
        }
      };
      return (
        <>
          <output data-testid="path">{mindMap.documentPath}</output>
          <button
            data-testid="edit"
            onClick={() =>
              mindMap.applyMutation((current) =>
                setNodeText(
                  current.document,
                  current.document.rootId,
                  mindMap.documentPath === "/tmp/方案.md"
                    ? "A 已修改"
                    : "B 已修改",
                ),
              )
            }
          >
            编辑当前文档
          </button>
          <button
            data-testid="new"
            onClick={() => void createNextDocument()}
          >
            新建
          </button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    persistence.saveLocalDocument.mockClear();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit']",
      )!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='new']",
      )!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='path']")?.textContent,
    ).toBe("/app-data/drafts/B.md");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[data-testid='edit']",
      )!.click();
      await vi.advanceTimersByTimeAsync(320);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      persistence.saveLocalDocument.mock.calls.map(
        ([, path]) => path,
      ),
    ).toEqual(["/tmp/方案.md", "/app-data/drafts/B.md"]);
    expect(
      persistence.saveLocalDocument.mock.calls.map(
        ([document]) =>
          document.nodes[document.rootId].text,
      ),
    ).toEqual(["A 已修改", "B 已修改"]);
    expect(
      persistence.saveLocalDocument.mock.calls.map(
        ([, , sourceHash]) => sourceHash,
      ),
    ).toEqual(["hash-v1", "hash-b1"]);
  });
});
