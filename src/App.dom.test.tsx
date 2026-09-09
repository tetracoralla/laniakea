// @vitest-environment jsdom
import { createFlowWithStep } from "./test/flowFixture";

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/canvas/MindMapCanvas", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    MindMapCanvas: forwardRef(function TestMindMapCanvas(
      props: { onOpenSubspace: (id: string) => void; onOpenCanvasContextMenu: (anchor: {
        clientX: number;
        clientY: number;
        contentX: number;
        contentY: number;
      }) => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        fit: () => undefined,
        focusCanvas: () => undefined,
        focusSelected: () => undefined,
        flushViewport: () => undefined,
        resetZoom: () => undefined,
        zoomIn: () => undefined,
        zoomOut: () => undefined,
      }));
      return (
        <>
        <button
          className="mindmap-canvas"
          onContextMenu={(event) => {
            event.preventDefault();
            props.onOpenCanvasContextMenu({
              clientX: 240,
              clientY: 180,
              contentX: 120,
              contentY: 90,
            });
          }}
          type="button"
        >
          测试画布
        </button>
        <button className="test-open-subspace" onClick={() => props.onOpenSubspace("path")} type="button">
          测试子图入口
        </button>
        </>
      );
    }),
  };
});

vi.mock("./persistence/localDocumentStore", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("./persistence/localDocumentStore")
  >();
  let draftId = 0;
  return {
    ...original,
    activateLocalDocument: vi.fn(async () => undefined),
    clearActiveDocument: vi.fn(async () => undefined),
    createMarkdownDraft: vi.fn(async () => ({
      documentPath: `browser:test-${++draftId}`,
      sourceHash: `revision-${draftId}`,
    })),
    isDesktopRuntime: () => false,
    loadLocalDocument: vi.fn(async () => ({
      document: null,
      documentPath: null,
      sourcePath: null,
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown" as const,
      importedAsCopy: false,
      viewStateRestored: false,
      sourceHash: null,
    })),
  };
});

import { App } from "./App";
import { createSeedDocument } from "./data/seed";
import { flowSpaceForNode, setFlowNodeText, updateFlowSpace } from "./model/spaces";
import { createBrowserDocument } from "./persistence/browserDocumentStore";
import { loadLocalDocument } from "./persistence/localDocumentStore";

describe("App document-scoped overlays", () => {
  let container: HTMLDivElement;
  let root: Root;

  const waitForSearch = () => vi.waitFor(async () => {
    // Search is lazy-loaded. Wait for its rendered control, not a fixed import
    // duration that varies with the test worker's load.
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    const search = container.querySelector<HTMLInputElement>("[role='combobox']");
    expect(search).toBeInstanceOf(HTMLInputElement);
    return search!;
  });

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    localStorage.clear();
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("dismisses a blank-canvas menu before a keyboard-created document becomes active", async () => {
    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    const canvas = container.querySelector<HTMLElement>(".mindmap-canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    expect(container.textContent).toContain("新建浮动节点");
    const menuItem = container.querySelector<HTMLButtonElement>(
      "[role='menuitem']",
    )!;

    const newDocumentKey = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "n",
    });
    await act(async () => {
      menuItem.dispatchEvent(newDocumentKey);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(newDocumentKey.defaultPrevented).toBe(true);
    expect(container.textContent).not.toContain("新建浮动节点");
  });
  it("resumes the selected Flow step and viewport after a round trip, while explicit search chooses its target", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const flow = setFlowNodeText(flowSpaceForNode(created.document, "path")!, created.selectedFlowNodeId, "起点");
    const stored = await createBrowserDocument(updateFlowSpace(created.document, flow, { primaryId: "path", selectedIds: ["path"] }).document);
    vi.mocked(loadLocalDocument).mockResolvedValueOnce({
      ...stored, sourcePath: null, sourceFormat: "markdown", importedAsCopy: false,
      recoveredFromBackup: false, notice: null, saveError: null, viewStateRestored: true,
    });
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 30));
    const press = async (target: Element, key: string, metaKey = false) => {
      await act(async () => {
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, metaKey }));
        await settle();
      });
    };
    const enter = async () => {
      await act(async () => container.querySelector<HTMLButtonElement>(".test-open-subspace")!.click());
      await vi.waitFor(async () => {
        await act(async () => { await settle(); });
        expect(container.querySelector(".flow-canvas__content")).not.toBeNull();
      });
      return container.querySelector<HTMLElement>(".flow-canvas")!;
    };
    const selectedText = () => container.querySelector(".flow-node__content[aria-pressed='true']")?.textContent;
    await act(async () => { root.render(<App />); await settle(); });
    const canvas = await enter();
    await press(canvas, "Enter");
    const editor = container.querySelector<HTMLTextAreaElement>("[aria-label='编辑流程步骤']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "继续处理的步骤");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(editor, "Enter");
    expect(selectedText()).toBe("继续处理的步骤");
    await press(canvas, "=", true);
    const viewport = container.querySelector<HTMLElement>(".flow-canvas__content")!.style.transform;
    await press(canvas, "Escape");
    expect(container.querySelector(".flow-canvas")).toBeNull();
    const resumedCanvas = await enter();
    expect(selectedText()).toBe("继续处理的步骤");
    expect(container.querySelector<HTMLElement>(".flow-canvas__content")!.style.transform).toBe(viewport);

    await press(resumedCanvas, "f", true);
    const search = await waitForSearch();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "起点");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(search, "Enter");
    expect(selectedText()).toBe("起点");

    // Removing the remembered node from the parent must not resurrect it on entry.
    const continuation = Array.from(container.querySelectorAll<HTMLButtonElement>(".flow-node__content"))
      .find((node) => node.textContent === "继续处理的步骤")!;
    await act(async () => continuation.click());
    await press(resumedCanvas, "Escape");
    const parent = container.querySelector<HTMLElement>(".mindmap-canvas")!;
    await press(parent, "z", true); // Undo its text edit.
    await press(parent, "z", true); // Undo its creation.
    await enter();
    expect(selectedText()).toBe("起点");
    expect(container.querySelectorAll(".flow-node__content")).toHaveLength(1);
  });

  it("routes global commands to the current Flow and keeps parent editing out of its palette", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const flow = setFlowNodeText(flowSpaceForNode(created.document, "path")!, created.selectedFlowNodeId, "Flow target");
    const document = updateFlowSpace(created.document, flow, { primaryId: "path", selectedIds: ["path"] }).document;
    const stored = await createBrowserDocument(document);
    vi.mocked(loadLocalDocument).mockResolvedValueOnce({
      ...stored, sourcePath: null, sourceFormat: "markdown", importedAsCopy: false,
      recoveredFromBackup: false, notice: null, saveError: null, viewStateRestored: true,
    });
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 30));
    const press = async (target: Element, key: string, metaKey = false) => {
      await act(async () => {
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, metaKey }));
        await settle();
      });
    };
    await act(async () => { root.render(<App />); await settle(); });
    await press(window.document.body, "f", true);
    const search = await waitForSearch();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Flow target");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(search, "Enter");
    await vi.waitFor(async () => {
      await act(async () => { await settle(); });
      expect(container.querySelector(".flow-canvas__content")).not.toBeNull();
    });
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    expect(canvas).not.toBeNull();
    const content = canvas.querySelector<HTMLElement>(".flow-canvas__content")!;
    expect(content, canvas.outerHTML).not.toBeNull();
    const initialTransform = content.style.transform;
    await press(canvas, "=", true);
    expect(content.style.transform).toContain("scale(1.2)");
    expect(content.style.transform).not.toBe(initialTransform);
    await press(canvas, "0", true);
    expect(content.style.transform).toContain("scale(1)");
    await press(canvas, "k", true);
    expect(container.querySelector("[aria-label='命令面板']")).not.toBeNull();
    expect(container.textContent).not.toContain("创建同级节点");
    expect(container.textContent).not.toContain("删除节点及子节点");
    expect(container.textContent).toContain("立即保存");
    await press(await waitForSearch(), "Escape");
    expect(container.querySelector(".flow-canvas")).not.toBeNull();
    const switcher = container.querySelector<HTMLButtonElement>(".document-switcher__trigger")!;
    await act(async () => {
      canvas.focus();
      switcher.click();
    });
    expect(switcher.getAttribute("aria-expanded")).toBe("true");
    await press(window.document.activeElement!, "Escape");
    expect(switcher.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".flow-canvas__content")).not.toBeNull();
    const more = container.querySelector<HTMLButtonElement>("[aria-label='更多']")!;
    await act(async () => {
      canvas.focus();
      more.click();
    });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await press(window.document.activeElement!, "Escape");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".flow-canvas__content")).not.toBeNull();
    await press(container.querySelector("[aria-label='搜索']")!, "Escape");
    expect(container.querySelector(".flow-canvas")).toBeNull();
    expect(container.querySelector(".mindmap-canvas")).not.toBeNull();
  });

});
