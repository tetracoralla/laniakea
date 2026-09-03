// @vitest-environment jsdom

import { act, createRef } from "react";
import { Profiler, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  resolveSurfaceAfterInvalidation,
  type EditorSurface,
  type SurfaceRestorePoint,
} from "../../App";
import { canvasContentBounds, computeLayout } from "../../model/layout";
import { createMapSpace } from "../../model/spaces";
import { createSelection, singleSelection } from "../../model/selection";
import { canvasZoomToFit, minCanvasZoom } from "../../model/zoom";
import type {
  MindMapDocument,
  MindNode,
  Viewport,
} from "../../types/mindmap";
import { TopBar } from "../chrome/TopBar";
import { MindMapCanvas, type CanvasHandle } from "./MindMapCanvas";

const now = "2026-07-28T00:00:00.000Z";

function largeDocument(count: number): MindMapDocument {
  const nodes: Record<string, MindNode> = {
    root: {
      id: "root",
      text: "大图性能样本",
      parentId: null,
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
  };
  for (let index = 1; index < count; index += 1) {
    const id = `node-${index}`;
    nodes[id] = {
      id,
      text: `节点 ${index}`,
      parentId: "root",
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    nodes.root.children.push(id);
  }
  return {
    formatVersion: 1,
    title: "大图性能样本",
    rootId: "root",
    nodes,
    floatingRoots: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: now,
  };
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 7,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

function nodeFrame(element: HTMLElement) {
  return {
    height: Number.parseFloat(element.style.height),
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
    width: Number.parseFloat(element.style.width),
  };
}

describe("rendered interaction regressions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let animationFrames: FrameRequestCallback[];
  let pointerCaptures: WeakMap<HTMLElement, Set<number>>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    animationFrames = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    pointerCaptures = new WeakMap();
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: {
        configurable: true,
        value: vi.fn(function (
          this: HTMLElement,
          pointerId: number,
        ) {
          return pointerCaptures.get(this)?.has(pointerId) ?? false;
        }),
      },
      releasePointerCapture: {
        configurable: true,
        value: vi.fn(function (
          this: HTMLElement,
          pointerId: number,
        ) {
          pointerCaptures.get(this)?.delete(pointerId);
        }),
      },
      setPointerCapture: {
        configurable: true,
        value: vi.fn(function (
          this: HTMLElement,
          pointerId: number,
        ) {
          const captures = pointerCaptures.get(this) ?? new Set<number>();
          captures.add(pointerId);
          pointerCaptures.set(this, captures);
        }),
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 1200,
      bottom: 900,
      left: 0,
      width: 1200,
      height: 900,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (
      HTMLElement.prototype as Partial<HTMLElement>
    ).hasPointerCapture;
    delete (
      HTMLElement.prototype as Partial<HTMLElement>
    ).releasePointerCapture;
    delete (
      HTMLElement.prototype as Partial<HTMLElement>
    ).setPointerCapture;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens a new document directly from the dedicated toolbar group", async () => {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    await act(async () => {
      root.render(
        <TopBar
          currentDocumentPath={null}
          onCopyMarkdown={() => undefined}
          onImport={() => undefined}
          onMoveRecent={() => undefined}
          onNew={() => editor.focus()}
          onCopyRecentPath={() => undefined}
          onForgetRecent={() => undefined}
          onOpenRecent={() => undefined}
          onRevealRecent={() => undefined}
          onSave={() => undefined}
          onSaveAs={() => undefined}
          onSearch={() => undefined}
          onShortcutSettings={() => undefined}
          onTitleChange={() => undefined}
          recentDocuments={[]}
          title="测试"
        />,
      );
    });

    const newDocument = container.querySelector<HTMLButtonElement>(
      "button[aria-label='新建']",
    )!;
    await act(async () => newDocument.click());

    expect(document.activeElement).toBe(editor);
    expect(newDocument.textContent).toBe("新建");
    expect(newDocument.classList.contains("toolbar-button--labeled")).toBe(
      true,
    );
    expect(
      newDocument.nextElementSibling?.classList.contains(
        "topbar__actions-divider",
      ),
    ).toBe(true);

    const more = container.querySelector<HTMLButtonElement>(
      "button[aria-label='更多']",
    )!;
    const saveAs = container.querySelector<HTMLButtonElement>(
      "button[aria-label='另存为']",
    )!;
    expect(saveAs.textContent).toBe("");
    expect(saveAs.title).toBe("另存为");
    await act(async () => more.click());
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
      ).some((button) => button.textContent?.includes("新建")),
    ).toBe(false);
    expect(container.querySelector(".menu-popover")?.textContent)
      .not.toContain("另存为");
    editor.remove();
  });

  it("marks unsaved changes next to the title and clears them on save", async () => {
    const sharedProps = {
      currentDocumentPath: null,
      onCopyMarkdown: () => undefined,
      onCopyRecentPath: () => undefined,
      onForgetRecent: () => undefined,
      onImport: () => undefined,
      onMoveRecent: () => undefined,
      onNew: () => undefined,
      onOpenRecent: () => undefined,
      onRevealRecent: () => undefined,
      onSave: () => undefined,
      onSaveAs: () => undefined,
      onSearch: () => undefined,
      onShortcutSettings: () => undefined,
      onTitleChange: () => undefined,
      recentDocuments: [],
      title: "测试",
    };

    await act(async () => {
      root.render(<TopBar {...sharedProps} saveState="saving" />);
    });
    const dot = container.querySelector<HTMLElement>(
      ".document-title__dirty",
    )!;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute("aria-label")).toBe("有未保存的更改");
    expect(dot.classList.contains("document-title__dirty--error")).toBe(false);

    await act(async () => {
      root.render(<TopBar {...sharedProps} saveState="error" />);
    });
    expect(
      container
        .querySelector<HTMLElement>(".document-title__dirty")
        ?.classList.contains("document-title__dirty--error"),
    ).toBe(true);

    await act(async () => {
      root.render(<TopBar {...sharedProps} saveState="saved" />);
    });
    expect(container.querySelector(".document-title__dirty")).toBeNull();
  });

  it("uses the shared Armorial icon component for returning from a subspace", async () => {
    const onNavigateBack = vi.fn();
    await act(async () => {
      root.render(
        <TopBar
          currentDocumentPath={null}
          onCopyMarkdown={() => undefined}
          onImport={() => undefined}
          onMoveRecent={() => undefined}
          onNew={() => undefined}
          onCopyRecentPath={() => undefined}
          onForgetRecent={() => undefined}
          onOpenRecent={() => undefined}
          onRevealRecent={() => undefined}
          onSave={() => undefined}
          onSaveAs={() => undefined}
          onSearch={() => undefined}
          onShortcutSettings={() => undefined}
          onTitleChange={() => undefined}
          onNavigateBack={onNavigateBack}
          recentDocuments={[]}
          spacePath={[{ id: "flow-1", label: "当前流程", typeLabel: "流程" }]}
          title="测试"
        />,
      );
    });

    const back = container.querySelector<HTMLButtonElement>(
      "button[aria-label='返回上层图']",
    )!;
    expect(back.querySelector("svg")).not.toBeNull();
    expect(back.textContent).toBe("");
    await act(async () => back.click());
    expect(onNavigateBack).toHaveBeenCalledOnce();
  });

  it("does not submit the document title when Enter confirms an IME candidate", async () => {
    const onTitleChange = vi.fn();
    await act(async () => {
      root.render(
        <TopBar
          currentDocumentPath={null}
          onCopyMarkdown={() => undefined}
          onImport={() => undefined}
          onMoveRecent={() => undefined}
          onNew={() => undefined}
          onCopyRecentPath={() => undefined}
          onForgetRecent={() => undefined}
          onOpenRecent={() => undefined}
          onRevealRecent={() => undefined}
          onSave={() => undefined}
          onSaveAs={() => undefined}
          onSearch={() => undefined}
          onShortcutSettings={() => undefined}
          onTitleChange={onTitleChange}
          recentDocuments={[]}
          title="旧标题"
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>(".document-title input")!;
    input.focus();
    await act(async () => {
      input.value = "xin biao ti";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        isComposing: true,
        key: "Enter",
      }));
    });

    expect(onTitleChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("switches among five recent documents without duplicating Open in More", async () => {
    const onOpenRecent = vi.fn();
    await act(async () => {
      root.render(
        <TopBar
          currentDocumentPath="/tmp/current.md"
          onCopyMarkdown={() => undefined}
          onImport={() => undefined}
          onMoveRecent={() => undefined}
          onNew={() => undefined}
          onCopyRecentPath={() => undefined}
          onForgetRecent={() => undefined}
          onOpenRecent={onOpenRecent}
          onRevealRecent={() => undefined}
          onSave={() => undefined}
          onSaveAs={() => undefined}
          onSearch={() => undefined}
          onShortcutSettings={() => undefined}
          onTitleChange={() => undefined}
          recentDocuments={[
            {
              path: "/tmp/current.md",
              title: "当前文档",
              lastOpenedAt: "2026-07-28T10:07:00.000Z",
            },
            ...Array.from({ length: 6 }, (_, index) => ({
              path: `/tmp/recent-${index}.md`,
              title: `最近 ${index}`,
              lastOpenedAt: `2026-07-28T10:0${6 - index}:00.000Z`,
            })),
          ]}
          title="当前文档"
        />,
      );
    });

    const switcher = container.querySelector<HTMLButtonElement>(
      "button[aria-label='切换思维导图']",
    )!;
    await act(async () => switcher.click());
    const documentMenu = container.querySelector<HTMLElement>(
      ".document-switcher__popover",
    )!;
    const recentItems = Array.from(
      documentMenu.querySelectorAll<HTMLButtonElement>(
        ".document-switcher__recent",
      ),
    );

    expect(recentItems).toHaveLength(5);
    expect(documentMenu.textContent).not.toContain("当前文档");
    expect(documentMenu.textContent).toContain("打开文件…");

    await act(async () => recentItems[0].click());
    expect(onOpenRecent).toHaveBeenCalledWith("/tmp/recent-0.md");

    const more = container.querySelector<HTMLButtonElement>(
      "button[aria-label='更多']",
    )!;
    await act(async () => more.click());
    expect(
      container.querySelector(".menu-popover")?.textContent,
    ).not.toContain("打开文件");
  });

  it("shows browser backup actions without desktop-only settings", async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
    });

    const more = container.querySelector<HTMLButtonElement>(
      "button[aria-label='更多']",
    )!;
    await act(async () => more.click());
    const menuText = container.querySelector(".menu-popover")?.textContent;
    expect(menuText).toContain("导出完整备份");
    expect(menuText).toContain("恢复完整备份");
    expect(menuText).not.toContain("唤醒快捷键");
  });

  it("keeps ordinary selection quiet and opens drill-down only on request", async () => {
    const mindMap = largeDocument(2);
    const onOpenNodeContextMenu = vi.fn();
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={mindMap}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onOpenNodeContextMenu={onOpenNodeContextMenu}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection("node-1")}
        />,
      );
    });

    expect(container.querySelector(".mindmap-context-bar")).toBeNull();

    const node = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    await act(async () => {
      node.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 320, clientY: 240 }),
      );
    });
    expect(onOpenNodeContextMenu).toHaveBeenCalledWith(
      "node-1",
      expect.objectContaining({
        bottom: expect.any(Number),
        left: expect.any(Number),
        right: expect.any(Number),
        top: expect.any(Number),
      }),
      expect.any(HTMLElement),
    );
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("anchors reset-zoom on the selected node instead of a fixed origin", async () => {
    const mindMap = largeDocument(2);
    mindMap.viewport = { x: 3000, y: 2000, zoom: 0.7 };
    const onViewportChange = vi.fn();
    const canvasRef = createRef<CanvasHandle>();
    await act(async () => {
      root.render(
        <MindMapCanvas
          ref={canvasRef}
          document={mindMap}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={onViewportChange}
          selection={singleSelection("node-1")}
        />,
      );
    });

    const node = computeLayout(mindMap).nodes["node-1"];
    await act(async () => canvasRef.current?.resetZoom());
    // The reset eases over a few frames before the final viewport commit.
    for (let flush = 0; flush < 24 && animationFrames.length > 0; flush += 1) {
      await act(async () => {
        animationFrames.splice(0).forEach((callback) => callback(16 * (flush + 1)));
      });
    }

    expect(onViewportChange).toHaveBeenCalledWith({
      zoom: 1,
      x: 600 - (node.x + node.width / 2),
      y: 450 - (node.y + node.height / 2),
    });
  });

  it("auto-pans the viewport while a dragged node is held at the canvas edge", async () => {
    const mindMap = largeDocument(2);
    mindMap.viewport = { x: 0, y: 0, zoom: 1 };
    const onViewportChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={mindMap}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={onViewportChange}
          selection={singleSelection("node-1")}
        />,
      );
    });

    const canvas = container.querySelector<HTMLElement>(".mindmap-canvas")!;
    const content = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;
    await act(async () => {
      dispatchPointer(content, "pointerdown", 300, 300);
      dispatchPointer(canvas, "pointermove", 1199, 300);
    });
    const initialTransform = (
      container.querySelector<HTMLElement>(".mindmap-canvas__content")!
    ).style.transform;
    expect(initialTransform).toBe("translate3d(0px, 0px, 0) scale(1)");

    // Run the auto-pan frames: the pointer is held past the right inset.
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(16));
      animationFrames.splice(0).forEach((callback) => callback(48));
    });

    const pannedTransform = (
      container.querySelector<HTMLElement>(".mindmap-canvas__content")!
    ).style.transform;
    expect(pannedTransform).not.toBe(initialTransform);
    expect(pannedTransform).toContain("translate3d(-");

    await act(async () => {
      dispatchPointer(canvas, "pointerup", 1199, 300);
    });
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange.mock.calls[0][0]).toMatchObject({
      zoom: 1,
    });
    expect(onViewportChange.mock.calls[0][0].x).toBeLessThan(0);
  });

  it("renders an anchored subspace as a separate selectable child instead of a parent badge", async () => {
    const mindMap = createMapSpace(largeDocument(2), "node-1").document;
    const onOpenSubspace = vi.fn();
    const onSelectSubspace = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={mindMap}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onOpenSubspace={onOpenSubspace}
          onPasteStructured={() => false}
          onSelectSubspace={onSelectSubspace}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection("node-1")}
          selectedSubspaceAnchorId="node-1"
        />,
      );
    });

    const parent = container.querySelector<HTMLElement>(
      ".mind-node[data-node-id='node-1']",
    )!;
    const portal = container.querySelector<HTMLElement>(
      ".subspace-portal[data-subspace-anchor-id='node-1']",
    )!;
    expect(parent.querySelector(".mind-node__portal")).toBeNull();
    expect(parent.classList.contains("is-selected")).toBe(false);
    expect(portal.classList.contains("is-selected")).toBe(true);
    expect(portal.textContent).toContain("暂无下级节点");
    expect(
      container.querySelectorAll(".connectors .connector"),
    ).toHaveLength(2);

    await act(async () =>
      portal
        .querySelector<HTMLButtonElement>(".subspace-portal__content")!
        .click(),
    );
    expect(onSelectSubspace).toHaveBeenCalledWith("node-1");
  });

  it("keeps a selected subspace intact until its delete dialog is confirmed", async () => {
    const mindMap = createMapSpace(largeDocument(2), "node-1").document;
    window.localStorage.setItem("origin.mindmap.v1", JSON.stringify(mindMap));
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
      await Promise.resolve();
    });

    let portal = container.querySelector<HTMLElement>(
      ".subspace-portal[data-subspace-anchor-id='node-1']",
    )!;
    expect(portal).not.toBeNull();
    const summary = portal.querySelector<HTMLButtonElement>(
      ".subspace-portal__content",
    )!;
    await act(async () => summary.click());
    await act(async () =>
      summary.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Backspace" }),
      ),
    );

    expect(container.querySelector("[role='dialog']")?.textContent)
      .toContain("原节点会保留");
    expect(container.querySelector(".subspace-portal")).not.toBeNull();
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")]
        .find((button) => button.textContent === "取消")!
        .click(),
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.querySelector(".subspace-portal")).not.toBeNull();

    portal = container.querySelector<HTMLElement>(".subspace-portal")!;
    const selectedSummary = portal.querySelector<HTMLButtonElement>(
      ".subspace-portal__content",
    )!;
    await act(async () =>
      selectedSummary.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Backspace" }),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".delete-subspace-dialog__confirm")!
        .click(),
    );

    expect(container.querySelector(".subspace-portal")).toBeNull();
    expect(container.querySelector("[data-node-id='node-1']")).not.toBeNull();
  });

  it("exits editing but keeps selection when the page becomes hidden", async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
    });
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".mind-node__editor",
    )!;
    expect(editor).not.toBeNull();
    editor.value = "切换前的最终文本";

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(container.querySelector(".mind-node__editor")).toBeNull();
    expect(container.querySelector(".mind-node__content")?.textContent).toBe(
      "切换前的最终文本",
    );
    expect(
      container.querySelector(".mind-node")?.classList.contains("is-selected"),
    ).toBe(true);
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("does not commit an unfinished IME preedit when the window loses focus", async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
    });
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".mind-node__editor",
    )!;
    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editor.value = "pin yin yu bian ji";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      window.dispatchEvent(new Event("blur"));
    });

    expect(container.querySelector(".mind-node__editor")).toBe(editor);
    expect(container.querySelector(".mind-node__content")).toBeNull();

    await act(async () => {
      editor.value = "拼音与编辑";
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(container.querySelector(".mind-node__editor")).toBeNull();
    expect(container.querySelector(".mind-node__content")?.textContent).toBe(
      "拼音与编辑",
    );
  });

  it("keeps Tab-in-edit text and the new child in a single undo step", async () => {
    const mindMap = largeDocument(2);
    mindMap.nodes["node-1"].text = "原始文本";
    window.localStorage.setItem("origin.mindmap.v1", JSON.stringify(mindMap));
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".mind-node")).toHaveLength(2);

    const content = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;
    await act(async () => {
      content.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const editor = container.querySelector<HTMLTextAreaElement>(
      "[data-node-id='node-1'] .mind-node__editor",
    )!;
    expect(editor).not.toBeNull();

    await act(async () => {
      editor.value = "修改后的文本";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
      );
    });
    // The child is created and focused for editing immediately.
    expect(
      container.querySelector("[data-node-id='node-1'] .mind-node__content")
        ?.textContent,
    ).toBe("修改后的文本");
    expect(container.querySelectorAll(".mind-node")).toHaveLength(3);
    expect(container.querySelector(".mind-node__editor")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLTextAreaElement>(".mind-node__editor")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
        );
    });
    expect(container.querySelector(".mind-node__editor")).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          metaKey: true,
        }),
      );
    });
    // One undo reverts both the text edit and the inserted child.
    expect(
      container.querySelector("[data-node-id='node-1'] .mind-node__content")
        ?.textContent,
    ).toBe("原始文本");
    expect(container.querySelectorAll(".mind-node")).toHaveLength(2);
  });

  it("commits and selects the parent on Shift+Tab without structural change", async () => {
    const mindMap = largeDocument(2);
    mindMap.nodes["node-1"].text = "原始文本";
    window.localStorage.setItem("origin.mindmap.v1", JSON.stringify(mindMap));
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
      await Promise.resolve();
    });

    const content = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;
    await act(async () => {
      content.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const editor = container.querySelector<HTMLTextAreaElement>(
      "[data-node-id='node-1'] .mind-node__editor",
    )!;
    await act(async () => {
      editor.value = "更新文本";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Tab",
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector(".mind-node__editor")).toBeNull();
    expect(
      container.querySelector("[data-node-id='node-1'] .mind-node__content")
        ?.textContent,
    ).toBe("更新文本");
    expect(container.querySelectorAll(".mind-node")).toHaveLength(2);
    // The root becomes the primary selection.
    expect(
      container.querySelector(".mind-node--root.is-primary"),
    ).not.toBeNull();
  });

  it("creates a floating node in edit mode on blank-canvas double click", async () => {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
      await Promise.resolve();
    });

    const canvas = container.querySelector<HTMLElement>(".mindmap-canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    const editingNode = container
      .querySelector(".mind-node__editor")
      ?.closest(".mind-node");
    expect(editingNode).not.toBeNull();
    // The new floating root owns the editor, not the main root.
    expect(editingNode?.classList.contains("mind-node--root")).toBe(false);
    expect(
      editingNode?.classList.contains("mind-node--floating"),
    ).toBe(true);
    expect(container.querySelectorAll(".mind-node")).toHaveLength(2);

    await act(async () => {
      container
        .querySelector<HTMLTextAreaElement>(".mind-node__editor")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
        );
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          metaKey: true,
        }),
      );
    });
    // One undo removes the created floating node.
    expect(container.querySelectorAll(".mind-node")).toHaveLength(1);
  });

  it("mounts only the visible window of a 5,000-node document", async () => {
    const document = largeDocument(5_000);
    const startedAt = performance.now();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const elapsed = performance.now() - startedAt;

    const mountedNodes = container.querySelectorAll(".mind-node").length;
    expect(mountedNodes).toBeGreaterThan(1);
    expect(mountedNodes).toBeLessThan(40);
    expect(container.querySelector("[data-node-id='root']")).not.toBeNull();
    expect(elapsed).toBeLessThan(1_000);
  });

  it("fits the newly rendered document and can enter a full-map overview", async () => {
    const initial = largeDocument(2);
    const imported = largeDocument(100);
    const onViewportChange = vi.fn();
    const renderCanvas = (document: MindMapDocument, fitRequest: number) => (
      <MindMapCanvas
        document={document}
        draft=""
        editingId={null}
        fitRequest={fitRequest}
        onAttachNode={() => undefined}
        onBeginEdit={() => undefined}
        onCancelEdit={() => undefined}
        onCommitEdit={() => undefined}
        onDetachNode={() => undefined}
        onDraftChange={() => undefined}
        onPasteStructured={() => false}
        onSelectionChange={() => undefined}
        onSpaceTap={() => undefined}
        onToggle={() => undefined}
        onViewportChange={onViewportChange}
        selection={singleSelection(document.rootId)}
      />
    );

    await act(async () => root.render(renderCanvas(initial, 0)));
    await act(async () => root.render(renderCanvas(imported, 1)));

    const layout = computeLayout(imported);
    const content = canvasContentBounds(layout);
    const expectedZoom = canvasZoomToFit(
      content.width,
      content.height,
      1_200,
      900,
    );
    expect(expectedZoom).toBeLessThan(minCanvasZoom);
    expect(onViewportChange).toHaveBeenLastCalledWith({
      zoom: expectedZoom,
      x: (1_200 - content.width * expectedZoom) / 2 - content.minX * expectedZoom,
      y: (900 - content.height * expectedZoom) / 2 - content.minY * expectedZoom,
    });
  });

  it("coalesces wheel movement and renders the latest viewport in one frame", async () => {
    const document = largeDocument(5_000);
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const content = container.querySelector<HTMLElement>(
      ".mindmap-canvas__content",
    )!;
    expect(content.style.transition).toBe("none");
    expect(container.querySelector("[data-node-id='node-30']")).toBeNull();

    const firstWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 800,
    });
    await act(async () => {
      canvas.dispatchEvent(firstWheel);
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 800,
        }),
      );
    });
    expect(firstWheel.defaultPrevented).toBe(true);
    expect(content.style.transform).toBe(
      "translate3d(0px, 0px, 0) scale(1)",
    );

    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(16));
    });

    expect(content.style.transform).toBe(
      "translate3d(0px, -1600px, 0) scale(1)",
    );
    expect(
      container.querySelector("[data-node-id='node-30']"),
    ).not.toBeNull();
  });

  it("does not reclaim the viewport after panning away from an edited selection", async () => {
    vi.useFakeTimers();
    try {
      const initial = largeDocument(3);
      const committedViewports: Viewport[] = [];

      function Harness() {
        const [document, setDocument] = useState(initial);
        return (
          <MindMapCanvas
            document={document}
            draft={document.nodes["node-1"].text}
            editingId="node-1"
            onAttachNode={() => undefined}
            onBeginEdit={() => undefined}
            onCancelEdit={() => undefined}
            onCommitEdit={() => undefined}
            onDetachNode={() => undefined}
            onDraftChange={() => undefined}
            onPasteStructured={() => false}
            onSelectionChange={() => undefined}
            onSpaceTap={() => undefined}
            onToggle={() => undefined}
            onViewportChange={(viewport) => {
              committedViewports.push(viewport);
              setDocument((current) => ({ ...current, viewport }));
            }}
            selection={singleSelection("node-1")}
          />
        );
      }

      await act(async () => root.render(<Harness />));
      const canvas = container.querySelector<HTMLElement>(
        "[aria-label='思维导图画布']",
      )!;

      await act(async () => {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaX: 900,
            deltaY: 500,
          }),
        );
        animationFrames.splice(0).forEach((callback) => callback(16));
        vi.advanceTimersByTime(120);
      });

      expect(committedViewports).toEqual([
        { x: -900, y: -500, zoom: 1 },
      ]);
      expect(
        container.querySelector<HTMLElement>(".mindmap-canvas__content")
          ?.style.transform,
      ).toBe("translate3d(-900px, -500px, 0) scale(1)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending pan when keyboard selection reveals a new node", async () => {
    vi.useFakeTimers();
    try {
      const initial = largeDocument(40);
      const committedViewports: Viewport[] = [];

      function Harness() {
        const [document, setDocument] = useState(initial);
        const [selection, setSelection] = useState(singleSelection("root"));
        return (
          <>
            <button data-testid="select-last" onClick={() => setSelection(singleSelection("node-39"))}>
              选择末尾节点
            </button>
            <MindMapCanvas
              document={document}
              draft=""
              editingId={null}
              onAttachNode={() => undefined}
              onBeginEdit={() => undefined}
              onCancelEdit={() => undefined}
              onCommitEdit={() => undefined}
              onDetachNode={() => undefined}
              onDraftChange={() => undefined}
              onPasteStructured={() => false}
              onSelectionChange={setSelection}
              onSpaceTap={() => undefined}
              onToggle={() => undefined}
              onViewportChange={(viewport) => {
                committedViewports.push(viewport);
                setDocument((current) => ({ ...current, viewport }));
              }}
              selection={selection}
            />
          </>
        );
      }

      await act(async () => root.render(<Harness />));
      const canvas = container.querySelector<HTMLElement>(
        "[aria-label='思维导图画布']",
      )!;
      await act(async () => {
        canvas.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 300,
        }));
        animationFrames.splice(0).forEach((callback) => callback(16));
        container.querySelector<HTMLButtonElement>("[data-testid='select-last']")!.click();
      });

      expect(committedViewports).toHaveLength(1);
      expect(committedViewports[0].y).not.toBe(-300);

      await act(async () => {
        vi.advanceTimersByTime(120);
        animationFrames.splice(0).forEach((callback) => callback(32));
      });
      expect(committedViewports).toHaveLength(1);
      expect(initial.viewport).not.toEqual(committedViewports[0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a pending wheel pan to its own surface when the document switches", async () => {
    vi.useFakeTimers();
    try {
      const rootDocument = largeDocument(3);
      const spaceDocument = {
        ...largeDocument(3),
        viewport: { x: -400, y: -220, zoom: 0.8 },
      };
      const onRootViewportChange = vi.fn();
      const onSpaceViewportChange = vi.fn();
      const renderCanvas = (
        document: MindMapDocument,
        onViewportChange: (viewport: unknown) => void,
      ) => (
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={onViewportChange}
          selection={singleSelection(document.rootId)}
        />
      );

      await act(async () => {
        root.render(renderCanvas(rootDocument, onRootViewportChange));
      });
      const canvas = container.querySelector<HTMLElement>(
        "[aria-label='思维导图画布']",
      )!;
      await act(async () => {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaX: 120,
          }),
        );
      });
      await act(async () => {
        animationFrames.splice(0).forEach((callback) => callback(16));
      });

      // Surface switch inside the 120 ms commit window: same component
      // instance, next layer's document and callback. The pending pan must
      // reach the panned surface only, never the incoming one. The incoming
      // surface may legitimately reveal its own selection immediately.
      await act(async () => {
        root.render(renderCanvas(spaceDocument, onSpaceViewportChange));
      });
      expect(onRootViewportChange).toHaveBeenCalledWith({
        x: -120,
        y: 0,
        zoom: 1,
      });
      expect(onRootViewportChange.mock.calls.at(-1)).toEqual([
        { x: -120, y: 0, zoom: 1 },
      ]);
      expect(onSpaceViewportChange).not.toHaveBeenCalledWith({
        x: -120,
        y: 0,
        zoom: 1,
      });
      const rootCallsAfterSwitch = onRootViewportChange.mock.calls.length;
      const spaceCallsAfterSwitch = onSpaceViewportChange.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(onRootViewportChange.mock.calls.length).toBe(
        rootCallsAfterSwitch,
      );
      expect(onSpaceViewportChange.mock.calls.length).toBe(
        spaceCallsAfterSwitch,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits a pending wheel pan when the canvas unmounts", async () => {
    vi.useFakeTimers();
    try {
      const document = largeDocument(3);
      const onViewportChange = vi.fn();
      await act(async () => {
        root.render(
          <MindMapCanvas
            document={document}
            draft=""
            editingId={null}
            onAttachNode={() => undefined}
            onBeginEdit={() => undefined}
            onCancelEdit={() => undefined}
            onCommitEdit={() => undefined}
            onDetachNode={() => undefined}
            onDraftChange={() => undefined}
            onPasteStructured={() => false}
            onSelectionChange={() => undefined}
            onSpaceTap={() => undefined}
            onToggle={() => undefined}
            onViewportChange={onViewportChange}
            selection={singleSelection(document.rootId)}
          />,
        );
      });
      const canvas = container.querySelector<HTMLElement>(
        "[aria-label='思维导图画布']",
      )!;
      await act(async () => {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: 60,
          }),
        );
      });
      await act(async () => {
        animationFrames.splice(0).forEach((callback) => callback(16));
      });

      await act(async () => {
        root.unmount();
      });
      expect(onViewportChange).toHaveBeenCalledWith({
        x: 0,
        y: -60,
        zoom: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves wheel scrolling inside an overflowing node editor to the browser", async () => {
    const document = largeDocument(3);
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft={"😀".repeat(800)}
          editingId="node-1"
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection("node-1")}
        />,
      );
    });
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".mind-node__editor",
    )!;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 480 },
    });
    const content = container.querySelector<HTMLElement>(
      ".mindmap-canvas__content",
    )!;
    const transformBeforeWheel = content.style.transform;
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 90,
    });

    await act(async () => editor.dispatchEvent(wheel));

    expect(wheel.defaultPrevented).toBe(false);
    expect(content.style.transform).toBe(transformBeforeWheel);
  });

  it("reports live zoom feedback without waiting for viewport persistence", async () => {
    const document = largeDocument(3);
    const onZoomPreview = vi.fn();
    const onViewportChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={onViewportChange}
          onZoomPreview={onZoomPreview}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const viewportCallsBeforeZoom = onViewportChange.mock.calls.length;

    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: 100,
        }),
      );
    });

    expect(onZoomPreview).toHaveBeenCalledOnce();
    expect(onZoomPreview.mock.calls[0][0]).toBeCloseTo(
      0.8521803964,
      10,
    );
    expect(onViewportChange).toHaveBeenCalledTimes(viewportCallsBeforeZoom);
  });

  it("preserves fine wheel deltas and avoids layout reads in the zoom hot path", async () => {
    const document = largeDocument(3);
    const onZoomPreview = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          onZoomPreview={onZoomPreview}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const content = container.querySelector<HTMLElement>(
      ".mindmap-canvas__content",
    )!;
    const boundsReadsBeforeZoom = vi.mocked(
      HTMLElement.prototype.getBoundingClientRect,
    ).mock.calls.length;

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: 1,
          }),
        );
      });
    }

    const zooms = onZoomPreview.mock.calls.map(([zoom]) => zoom);
    expect(zooms).toHaveLength(4);
    expect(
      zooms.every(
        (zoom, index) => index === 0 || zoom < zooms[index - 1],
      ),
    ).toBe(true);
    expect(
      zooms.every(
        (zoom, index) =>
          index === 0 || zooms[index - 1] - zoom < 0.003,
      ),
    ).toBe(true);
    expect(content.style.transform).toContain("scale(1)");
    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(16));
    });
    expect(content.style.transform).toContain(`scale(${zooms.at(-1)})`);
    expect(
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length,
    ).toBe(boundsReadsBeforeZoom);
  });

  it("keeps small pans compositor-only until the mounted window needs refreshing", async () => {
    const document = largeDocument(5_000);
    let commits = 0;
    await act(async () => {
      root.render(
        <Profiler id="canvas" onRender={() => commits += 1}>
          <MindMapCanvas
            document={document}
            draft=""
            editingId={null}
            onAttachNode={() => undefined}
            onBeginEdit={() => undefined}
            onCancelEdit={() => undefined}
            onCommitEdit={() => undefined}
            onDetachNode={() => undefined}
            onDraftChange={() => undefined}
            onPasteStructured={() => false}
            onSelectionChange={() => undefined}
            onSpaceTap={() => undefined}
            onToggle={() => undefined}
            onViewportChange={() => undefined}
            selection={singleSelection(document.rootId)}
          />
        </Profiler>,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const initialCommits = commits;

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: 100,
          }),
        );
        animationFrames.splice(0).forEach((callback) => callback(16));
      });
    }

    expect(commits).toBe(initialCommits);

    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 400,
        }),
      );
      animationFrames.splice(0).forEach((callback) => callback(32));
    });

    expect(commits).toBe(initialCommits + 1);
  });

  it("refreshes incoming nodes when mounted under React strict mode", async () => {
    const document = largeDocument(5_000);
    await act(async () => {
      root.render(
        <StrictMode>
          <MindMapCanvas
            document={document}
            draft=""
            editingId={null}
            onAttachNode={() => undefined}
            onBeginEdit={() => undefined}
            onCancelEdit={() => undefined}
            onCommitEdit={() => undefined}
            onDetachNode={() => undefined}
            onDraftChange={() => undefined}
            onPasteStructured={() => false}
            onSelectionChange={() => undefined}
            onSpaceTap={() => undefined}
            onToggle={() => undefined}
            onViewportChange={() => undefined}
            selection={singleSelection(document.rootId)}
          />
        </StrictMode>,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;

    await act(async () => {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 1_600,
        }),
      );
      animationFrames.splice(0).forEach((callback) => callback(16));
    });

    expect(
      container.querySelector("[data-node-id='node-30']"),
    ).not.toBeNull();
  });

  it("shows persistent empty-state prompts without storing them as content", async () => {
    const document = largeDocument(3);
    document.nodes.root.text = "";
    document.nodes.root.children = ["node-1"];
    document.nodes["node-1"].parentId = "root";
    document.nodes["node-1"].text = "";
    document.nodes["node-1"].children = ["node-2"];
    document.nodes["node-2"].parentId = "node-1";
    document.nodes["node-2"].text = "";

    const renderAt = async (editingId: string | null) => {
      await act(async () => {
        root.render(
          <MindMapCanvas
            document={document}
            draft=""
            editingId={editingId}
            onAttachNode={() => undefined}
            onBeginEdit={() => undefined}
            onCancelEdit={() => undefined}
            onCommitEdit={() => undefined}
            onDetachNode={() => undefined}
            onDraftChange={() => undefined}
            onPasteStructured={() => false}
            onSelectionChange={() => undefined}
            onSpaceTap={() => undefined}
            onToggle={() => undefined}
            onViewportChange={() => undefined}
            selection={singleSelection(editingId ?? document.rootId)}
          />,
        );
      });
    };

    await renderAt("root");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        ".mind-node__editor",
      )?.placeholder,
    ).toBe("中心主题");

    await renderAt("node-1");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        ".mind-node__editor",
      )?.placeholder,
    ).toBe("输入文本");

    await renderAt("node-2");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        ".mind-node__editor",
      )?.placeholder,
    ).toBe("输入文本");

    await renderAt(null);
    const emptyRoot = container.querySelector<HTMLButtonElement>(
      "[data-node-id='root'] .mind-node__content",
    );
    expect(emptyRoot?.textContent).toBe("中心主题");
    expect(emptyRoot?.getAttribute("aria-label")).toBe(
      "空白中心主题",
    );
    expect(emptyRoot?.classList.contains("is-placeholder")).toBe(true);
    const emptyChild = container.querySelector<HTMLButtonElement>(
      "[data-node-id='node-1'] .mind-node__content",
    );
    expect(emptyChild?.textContent).toBe("输入文本");
    expect(emptyChild?.getAttribute("aria-label")).toBe("空白节点");
    expect(emptyChild?.classList.contains("is-placeholder")).toBe(
      true,
    );
  });

  it("keeps a node click in pointer mode available for single selection", async () => {
    const document = largeDocument(3);
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const nodeContent = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;

    await act(async () => {
      dispatchPointer(nodeContent, "pointerdown", 320, 240);
      dispatchPointer(nodeContent, "pointerup", 320, 240);
      nodeContent.click();
    });

    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      singleSelection("node-1"),
    );
  });

  it("does not preempt Command-click additive selection before drag starts", async () => {
    const document = largeDocument(3);
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection("node-2")}
        />,
      );
    });
    const nodeContent = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;

    await act(async () => {
      nodeContent.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 320,
          clientY: 240,
          metaKey: true,
        }),
      );
      nodeContent.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      );
    });

    expect(onSelectionChange).toHaveBeenCalledOnce();
    expect(onSelectionChange).toHaveBeenCalledWith({
      primaryId: "node-1",
      selectedIds: ["node-1", "node-2"],
    });
  });

  it("uses blank-canvas dragging for marquee selection in pointer mode", async () => {
    const document = largeDocument(3);
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;

    await act(async () => {
      dispatchPointer(canvas, "pointerdown", 0, 0);
      dispatchPointer(canvas, "pointermove", 1190, 890);
    });
    expect(container.querySelector(".selection-marquee")).not.toBeNull();

    await act(async () => {
      dispatchPointer(canvas, "pointerup", 1190, 890);
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining([
          "root",
          "node-1",
          "node-2",
        ]),
      }),
    );
  });

  it("commits the edit and clears selection when blank canvas is clicked", async () => {
    const document = largeDocument(3);

    function Harness() {
      const [editingId, setEditingId] = useState<string | null>("root");
      const [selection, setSelection] = useState(singleSelection("root"));
      return (
        <MindMapCanvas
          document={document}
          draft={document.nodes.root.text}
          editingId={editingId}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => setEditingId(null)}
          onCommitEdit={() => setEditingId(null)}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={setSelection}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={selection}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    await act(async () => {
      dispatchPointer(canvas, "pointerdown", 40, 40);
      dispatchPointer(canvas, "pointerup", 40, 40);
    });

    expect(container.querySelector(".mind-node__editor")).toBeNull();
    const rootNode = container.querySelector<HTMLElement>(
      "[data-node-id='root']",
    )!;
    expect(rootNode.classList.contains("is-selected")).toBe(false);
    expect(rootNode.classList.contains("is-primary")).toBe(false);
  });

  it("keeps every first-level branch anchored when a descendant is collapsed", async () => {
    const initial = largeDocument(8);
    initial.nodes.root.children = ["node-1", "node-2"];
    initial.nodes["node-1"].children = ["node-3", "node-4"];
    initial.nodes["node-3"].children = ["node-5", "node-6", "node-7"];
    for (const id of ["node-3", "node-4"]) {
      initial.nodes[id].parentId = "node-1";
    }
    for (const id of ["node-5", "node-6", "node-7"]) {
      initial.nodes[id].parentId = "node-3";
    }

    function Harness() {
      const [mindMap, setMindMap] = useState(initial);
      return (
        <MindMapCanvas
          document={mindMap}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={(id) =>
            setMindMap((current) => ({
              ...current,
              nodes: {
                ...current.nodes,
                [id]: {
                  ...current.nodes[id],
                  collapsed: !current.nodes[id].collapsed,
                },
              },
            }))
          }
          onViewportChange={() => undefined}
          selection={singleSelection("node-3")}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const firstTop = nodeFrame(
      container.querySelector<HTMLElement>("[data-node-id='node-1']")!,
    ).top;
    const secondTop = nodeFrame(
      container.querySelector<HTMLElement>("[data-node-id='node-2']")!,
    ).top;

    await act(async () => {
      container
        .querySelector<HTMLElement>(
          "[data-node-id='node-3'] .mind-node__disclosure",
        )!
        .click();
    });

    expect(
      nodeFrame(
        container.querySelector<HTMLElement>("[data-node-id='node-1']")!,
      ).top,
    ).toBe(firstTop);
    expect(
      nodeFrame(
        container.querySelector<HTMLElement>("[data-node-id='node-2']")!,
      ).top,
    ).toBe(secondTop);
    expect(container.querySelector("[data-node-id='node-5']")).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLElement>(
          "[data-node-id='node-3'] .mind-node__disclosure",
        )!
        .click();
    });

    expect(
      nodeFrame(
        container.querySelector<HTMLElement>("[data-node-id='node-1']")!,
      ).top,
    ).toBe(firstTop);
    expect(container.querySelector("[data-node-id='node-5']")).not.toBeNull();
    const firstBranchBottom = Math.max(
      ...["node-1", "node-3", "node-4", "node-5", "node-6", "node-7"].map(
        (id) => {
          const frame = nodeFrame(
            container.querySelector<HTMLElement>(`[data-node-id='${id}']`)!,
          );
          return frame.top + frame.height;
        },
      ),
    );
    expect(firstBranchBottom).toBeLessThanOrEqual(
      nodeFrame(
        container.querySelector<HTMLElement>("[data-node-id='node-2']")!,
      ).top,
    );
  });

  it("auto-pans a marquee while keeping its starting point attached to content", async () => {
    const document = largeDocument(80);
    const onViewportChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={onViewportChange}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;

    await act(async () => {
      dispatchPointer(canvas, "pointerdown", 100, 100);
      dispatchPointer(canvas, "pointermove", 1250, 950);
    });
    const initialMarquee = container.querySelector<HTMLElement>(
      ".selection-marquee",
    )!;
    expect(initialMarquee.style.left).toBe("100px");

    for (let frame = 1; frame <= 4; frame += 1) {
      await act(async () => {
        animationFrames
          .splice(0)
          .forEach((callback) => callback(frame * 16));
      });
    }

    const content = container.querySelector<HTMLElement>(
      ".mindmap-canvas__content",
    )!;
    const movedMarquee = container.querySelector<HTMLElement>(
      ".selection-marquee",
    )!;
    expect(content.style.transform).not.toBe(
      "translate3d(0px, 0px, 0) scale(1)",
    );
    expect(Number.parseFloat(movedMarquee.style.left)).toBeLessThan(100);

    await act(async () => {
      dispatchPointer(canvas, "pointerup", 1250, 950);
    });
    expect(onViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    );
  });

  it("drags a node structurally in pointer mode without entering hand mode", async () => {
    const document = largeDocument(3);
    const onDetachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const nodeContent = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;

    await act(async () => {
      dispatchPointer(nodeContent, "pointerdown", 320, 240);
      dispatchPointer(canvas, "pointermove", 1100, 800);
      dispatchPointer(canvas, "pointerup", 1100, 800);
    });

    expect(canvas.classList.contains("is-space-held")).toBe(false);
    expect(onDetachNode).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "node-1",
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      ],
    );
  });

  it("keeps an attached branch in place when a drag does not show deliberate detach intent", async () => {
    const document = largeDocument(3);
    const onAttachNode = vi.fn();
    const onDetachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const sourceContent = source.querySelector<HTMLElement>(
      ".mind-node__content",
    )!;
    const frame = nodeFrame(source);
    const start = {
      x: frame.left + frame.width / 2,
      y: frame.top + frame.height / 2,
    };

    await act(async () => {
      dispatchPointer(sourceContent, "pointerdown", start.x, start.y);
      dispatchPointer(canvas, "pointermove", start.x + 72, start.y);
    });

    expect(
      container.querySelector<HTMLElement>(".node-drag-preview")?.dataset
        .dropIntent,
    ).toBe("retain");
    expect(canvas.textContent).toContain("继续拖动以选择上级节点");

    await act(async () => {
      dispatchPointer(canvas, "pointerup", start.x + 72, start.y);
    });
    expect(onAttachNode).not.toHaveBeenCalled();
    expect(onDetachNode).not.toHaveBeenCalled();
  });

  it("shows and commits a shallow parent candidate across an expanded forward gap", async () => {
    const document = largeDocument(4);
    const onAttachNode = vi.fn();
    const onDetachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const sourceContent = source.querySelector<HTMLElement>(
      ".mind-node__content",
    )!;
    const target = container.querySelector<HTMLElement>(
      "[data-node-id='node-2']",
    )!;
    const sourceFrame = nodeFrame(source);
    const targetFrame = nodeFrame(target);
    const start = {
      x: sourceFrame.left + sourceFrame.width / 2,
      y: sourceFrame.top + sourceFrame.height / 2,
    };
    const nearTarget = {
      x:
        targetFrame.left +
        targetFrame.width +
        112 +
        sourceFrame.width / 2,
      y: targetFrame.top + targetFrame.height / 2,
    };

    await act(async () => {
      dispatchPointer(sourceContent, "pointerdown", start.x, start.y);
      dispatchPointer(canvas, "pointermove", nearTarget.x, nearTarget.y);
    });

    expect(target.dataset.nodeDropTarget).toBe("true");
    expect(
      container.querySelector<HTMLElement>(".node-drag-preview")?.dataset
        .dropIntent,
    ).toBe("attach");
    expect(
      container
        .querySelector<SVGPathElement>(
          ".node-drag-connector-preview__path",
        )
        ?.getAttribute("d"),
    ).toMatch(/^M /);
    expect(canvas.textContent).toContain("松手将分支移入“节点 2”");

    await act(async () => {
      dispatchPointer(canvas, "pointerup", nearTarget.x, nearTarget.y);
    });
    expect(onAttachNode).toHaveBeenCalledWith(["node-1"], "node-2", 0);
    expect(onDetachNode).not.toHaveBeenCalled();
    expect(
      container
        .querySelector<SVGPathElement>(
          ".node-drag-connector-preview__path",
        )
        ?.getAttribute("d"),
    ).toBe("");
  });

  it("cancels a structural drag on Escape without committing on pointer release", async () => {
    const document = largeDocument(4);
    const onAttachNode = vi.fn();
    const onDetachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const target = container.querySelector<HTMLElement>(
      "[data-node-id='node-2']",
    )!;
    const sourceFrame = nodeFrame(source);
    const targetFrame = nodeFrame(target);
    const start = {
      x: sourceFrame.left + sourceFrame.width / 2,
      y: sourceFrame.top + sourceFrame.height / 2,
    };
    const nearTarget = {
      x:
        targetFrame.left +
        targetFrame.width +
        112 +
        sourceFrame.width / 2,
      y: targetFrame.top + targetFrame.height / 2,
    };

    await act(async () => {
      dispatchPointer(
        source.querySelector<HTMLElement>(".mind-node__content")!,
        "pointerdown",
        start.x,
        start.y,
      );
      dispatchPointer(
        canvas,
        "pointermove",
        nearTarget.x,
        nearTarget.y,
      );
    });
    expect(canvas.dataset.nodeDragging).toBeUndefined();
    expect(target.dataset.nodeDropTarget).toBe("true");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
    });
    expect(canvas.dataset.nodeDragging).toBeUndefined();
    expect(target.dataset.nodeDropTarget).toBeUndefined();
    expect(
      container.querySelector<HTMLDivElement>(".node-drag-preview")?.hidden,
    ).toBe(true);

    await act(async () => {
      dispatchPointer(
        canvas,
        "pointerup",
        nearTarget.x,
        nearTarget.y,
      );
    });
    expect(onAttachNode).not.toHaveBeenCalled();
    expect(onDetachNode).not.toHaveBeenCalled();
  });

  it("commits the rendered insertion slot between existing siblings", async () => {
    const document = largeDocument(5);
    document.nodes.root.children = ["node-1", "node-2"];
    document.nodes["node-2"].children = ["node-3", "node-4"];
    document.nodes["node-3"].parentId = "node-2";
    document.nodes["node-4"].parentId = "node-2";
    const onAttachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const target = container.querySelector<HTMLElement>(
      "[data-node-id='node-2']",
    )!;
    const firstChild = container.querySelector<HTMLElement>(
      "[data-node-id='node-3']",
    )!;
    const lastChild = container.querySelector<HTMLElement>(
      "[data-node-id='node-4']",
    )!;
    const sourceFrame = nodeFrame(source);
    const targetFrame = nodeFrame(target);
    const firstFrame = nodeFrame(firstChild);
    const lastFrame = nodeFrame(lastChild);
    const start = {
      x: sourceFrame.left + sourceFrame.width / 2,
      y: sourceFrame.top + sourceFrame.height / 2,
    };
    const betweenChildren = {
      x:
        targetFrame.left +
        targetFrame.width +
        112 +
        sourceFrame.width / 2,
      y:
        (firstFrame.top +
          firstFrame.height / 2 +
          lastFrame.top +
          lastFrame.height / 2) /
        2,
    };

    await act(async () => {
      dispatchPointer(
        source.querySelector<HTMLElement>(".mind-node__content")!,
        "pointerdown",
        start.x,
        start.y,
      );
      dispatchPointer(
        canvas,
        "pointermove",
        betweenChildren.x,
        betweenChildren.y,
      );
    });

    expect(target.dataset.nodeDropTarget).toBe("true");
    expect(canvas.textContent).toContain("排在第 2 个");

    await act(async () => {
      dispatchPointer(
        canvas,
        "pointerup",
        betweenChildren.x,
        betweenChildren.y,
      );
    });
    expect(onAttachNode).toHaveBeenCalledWith(["node-1"], "node-2", 1);
  });

  it("does not show attachment feedback while the dragged node covers a candidate", async () => {
    const document = largeDocument(4);
    const onAttachNode = vi.fn();
    const onDetachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const sourceContent = source.querySelector<HTMLElement>(
      ".mind-node__content",
    )!;
    const target = container.querySelector<HTMLElement>(
      "[data-node-id='node-2']",
    )!;
    const sourceFrame = nodeFrame(source);
    const targetFrame = nodeFrame(target);
    const start = {
      x: sourceFrame.left + sourceFrame.width / 2,
      y: sourceFrame.top + sourceFrame.height / 2,
    };
    const behindTarget = {
      x: targetFrame.left + targetFrame.width / 2,
      y: targetFrame.top + targetFrame.height / 2,
    };

    await act(async () => {
      dispatchPointer(sourceContent, "pointerdown", start.x, start.y);
      dispatchPointer(
        canvas,
        "pointermove",
        behindTarget.x,
        behindTarget.y,
      );
    });

    expect(target.dataset.nodeDropTarget).toBeUndefined();
    expect(
      container
        .querySelector<SVGPathElement>(
          ".node-drag-connector-preview__path",
        )
        ?.getAttribute("d"),
    ).toBe("");
    expect(canvas.textContent).toContain("继续拖动以选择上级节点");

    await act(async () => {
      dispatchPointer(
        canvas,
        "pointercancel",
        behindTarget.x,
        behindTarget.y,
      );
    });
    expect(onAttachNode).not.toHaveBeenCalled();
    expect(onDetachNode).not.toHaveBeenCalled();
  });

  it("drags every selected root to blank canvas while preserving relative position", async () => {
    const document = largeDocument(4);
    const layout = computeLayout(document);
    const selection = createSelection(
      ["node-1", "node-2"],
      layout.visibleIds,
      "node-1",
    );
    const onDetachNode = vi.fn();
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={selection}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const frame = nodeFrame(source);

    await act(async () => {
      dispatchPointer(
        source.querySelector<HTMLElement>(".mind-node__content")!,
        "pointerdown",
        frame.left + frame.width / 2,
        frame.top + frame.height / 2,
      );
      dispatchPointer(canvas, "pointermove", 1180, 760);
    });

    expect(container.querySelectorAll(".node-drag-preview__item")).toHaveLength(2);
    expect(
      container.querySelector<HTMLElement>("[data-node-id='node-1']")
        ?.dataset.nodeDragging,
    ).toBe("true");
    expect(
      container.querySelector<HTMLElement>("[data-node-id='node-2']")
        ?.dataset.nodeDragging,
    ).toBe("true");
    expect(canvas.textContent).toContain("松手将2 个分支移到画布空白处");

    await act(async () => {
      dispatchPointer(canvas, "pointerup", 1180, 760);
    });
    const positions = onDetachNode.mock.calls[0][0] as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(positions.map(({ id }) => id)).toEqual(["node-1", "node-2"]);
    expect(positions[1].y - positions[0].y).toBe(
      layout.nodes["node-2"].y - layout.nodes["node-1"].y,
    );
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("excludes the primary origin from the operation set and visible selection before a group drag", async () => {
    const document = largeDocument(4);
    const layout = computeLayout(document);
    const selection = createSelection(
      ["root", "node-1", "node-2"],
      layout.visibleIds,
      "node-1",
    );
    const onDetachNode = vi.fn();
    const onSelectionChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={selection}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const frame = nodeFrame(source);

    await act(async () => {
      dispatchPointer(
        source.querySelector<HTMLElement>(".mind-node__content")!,
        "pointerdown",
        frame.left + frame.width / 2,
        frame.top + frame.height / 2,
      );
      dispatchPointer(canvas, "pointermove", 1180, 760);
    });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-node-id='root']")?.classList,
    ).not.toContain("is-selected");
    expect(source.classList).toContain("is-primary");
    expect(container.querySelectorAll(".node-drag-preview__item")).toHaveLength(2);
    expect(
      container.querySelector<HTMLElement>("[data-node-id='root']")
        ?.dataset.nodeDragging,
    ).toBeUndefined();

    await act(async () => {
      dispatchPointer(canvas, "pointerup", 1180, 760);
    });
    expect(onSelectionChange.mock.calls.at(-1)![0]).toEqual({
      primaryId: "node-1",
      selectedIds: ["node-1", "node-2"],
    });
    const positions = onDetachNode.mock.calls[0][0] as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(positions.map(({ id }) => id)).toEqual(["node-1", "node-2"]);
  });

  it("snaps selected roots into one parent as an ordered block", async () => {
    const document = largeDocument(5);
    const layout = computeLayout(document);
    const selection = createSelection(
      ["node-1", "node-2"],
      layout.visibleIds,
      "node-1",
    );
    const onAttachNode = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={() => undefined}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={() => undefined}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={() => undefined}
          selection={selection}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const source = container.querySelector<HTMLElement>(
      "[data-node-id='node-1']",
    )!;
    const target = container.querySelector<HTMLElement>(
      "[data-node-id='node-3']",
    )!;
    const sourceFrame = nodeFrame(source);
    const targetFrame = nodeFrame(target);
    const targetPoint = {
      x: targetFrame.left + targetFrame.width + 112 + sourceFrame.width / 2,
      y: targetFrame.top + targetFrame.height / 2,
    };

    await act(async () => {
      dispatchPointer(
        source.querySelector<HTMLElement>(".mind-node__content")!,
        "pointerdown",
        sourceFrame.left + sourceFrame.width / 2,
        sourceFrame.top + sourceFrame.height / 2,
      );
      dispatchPointer(canvas, "pointermove", targetPoint.x, targetPoint.y);
      dispatchPointer(canvas, "pointerup", targetPoint.x, targetPoint.y);
    });

    expect(onAttachNode).toHaveBeenCalledWith(
      ["node-1", "node-2"],
      "node-3",
      0,
    );
  });

  it("pans from a node with Space without starting a structural node drag", async () => {
    const document = largeDocument(3);
    const onAttachNode = vi.fn();
    const onDetachNode = vi.fn();
    const onSelectionChange = vi.fn();
    const onViewportChange = vi.fn();
    await act(async () => {
      root.render(
        <MindMapCanvas
          document={document}
          draft=""
          editingId={null}
          onAttachNode={onAttachNode}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDetachNode={onDetachNode}
          onDraftChange={() => undefined}
          onPasteStructured={() => false}
          onSelectionChange={onSelectionChange}
          onSpaceTap={() => undefined}
          onToggle={() => undefined}
          onViewportChange={onViewportChange}
          selection={singleSelection(document.rootId)}
        />,
      );
    });
    const canvas = container.querySelector<HTMLElement>(
      "[aria-label='思维导图画布']",
    )!;
    const nodeContent = container.querySelector<HTMLElement>(
      "[data-node-id='node-1'] .mind-node__content",
    )!;

    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: " " }),
      );
    });
    expect(canvas.classList.contains("is-space-held")).toBe(true);

    await act(async () => {
      dispatchPointer(nodeContent, "pointerdown", 320, 240);
      dispatchPointer(canvas, "pointermove", 390, 285);
      dispatchPointer(canvas, "pointerup", 390, 285);
      nodeContent.click();
      canvas.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: " " }),
      );
    });

    expect(onViewportChange).toHaveBeenLastCalledWith({
      x: 70,
      y: 45,
      zoom: 1,
    });
    expect(onAttachNode).not.toHaveBeenCalled();
    expect(onDetachNode).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLDivElement>(".node-drag-preview")?.hidden,
    ).toBe(true);
  });
});

describe("surface invalidation after undo", () => {
  const surfaceValid =
    (surviving: Set<string>) => (candidate: EditorSurface) =>
      candidate.kind === "flow"
        ? surviving.has(candidate.spaceId)
        : !candidate.spaceId || surviving.has(candidate.spaceId);

  it("keeps the current surface untouched while its space exists", () => {
    const surface: EditorSurface = { kind: "map", spaceId: "space-a" };
    expect(
      resolveSurfaceAfterInvalidation(surface, [], surfaceValid(new Set(["space-a"]))),
    ).toBeNull();
  });

  it("pops to the deepest surviving ancestor and keeps the outer return path", () => {
    const outer: SurfaceRestorePoint = {
      surface: { kind: "map", spaceId: "space-outer" },
      selection: singleSelection("outer-node"),
    };
    const middle: SurfaceRestorePoint = {
      surface: {
        kind: "flow",
        spaceId: "flow-inner",
        anchorNodeId: "n",
        entryRequest: 1,
        fitOnMount: false,
        initialEditing: false,
        initialSelectedId: null,
      },
      selection: singleSelection("middle-node"),
    };
    const result = resolveSurfaceAfterInvalidation(
      { kind: "map", spaceId: "space-inner" },
      [outer, middle],
      surfaceValid(new Set(["space-outer", "flow-inner"])),
    );
    expect(result).not.toBeNull();
    expect(result?.surface).toEqual(middle.surface);
    expect(result?.restoreSelection).toEqual(singleSelection("middle-node"));
    expect(result?.surfaceStack).toEqual([outer]);
  });

  it("skips invalidated ancestors instead of stopping at the first one", () => {
    const outer: SurfaceRestorePoint = {
      surface: { kind: "map", spaceId: "space-outer" },
      selection: singleSelection("outer-node"),
    };
    const middle: SurfaceRestorePoint = {
      surface: { kind: "map", spaceId: "space-middle" },
      selection: singleSelection("middle-node"),
    };
    const result = resolveSurfaceAfterInvalidation(
      { kind: "map", spaceId: "space-inner" },
      [outer, middle],
      surfaceValid(new Set(["space-outer"])),
    );
    expect(result?.surface).toEqual(outer.surface);
    expect(result?.surfaceStack).toEqual([]);
  });

  it("falls back to the root map when every layer was undone", () => {
    const entry: SurfaceRestorePoint = {
      surface: { kind: "map", spaceId: "space-a" },
      selection: singleSelection("node"),
    };
    const result = resolveSurfaceAfterInvalidation(
      { kind: "map", spaceId: "space-b" },
      [entry],
      surfaceValid(new Set()),
    );
    expect(result?.surface).toEqual({ kind: "map", spaceId: null });
    expect(result?.restoreSelection).toBeNull();
    expect(result?.surfaceStack).toEqual([]);
  });
});
