// @vitest-environment jsdom

import { act } from "react";
import { Profiler, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { computeLayout } from "../../model/layout";
import { createSelection, singleSelection } from "../../model/selection";
import { canvasZoomToFit, minCanvasZoom } from "../../model/zoom";
import type {
  MindMapDocument,
  MindNode,
} from "../../types/mindmap";
import { TopBar } from "../chrome/TopBar";
import { MindMapCanvas } from "./MindMapCanvas";

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
    const expectedZoom = canvasZoomToFit(
      layout.width,
      layout.height,
      1_200,
      900,
    );
    expect(expectedZoom).toBeLessThan(minCanvasZoom);
    expect(onViewportChange).toHaveBeenLastCalledWith({
      zoom: expectedZoom,
      x: (1_200 - layout.width * expectedZoom) / 2,
      y: (900 - layout.height * expectedZoom) / 2,
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
      0.8619728212,
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

  it("keeps the edited node selected when blank canvas exits editing", async () => {
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
    expect(rootNode.classList.contains("is-selected")).toBe(true);
    expect(rootNode.classList.contains("is-primary")).toBe(true);
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
    expect(canvas.dataset.nodeDragging).toBe("true");
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
