// @vitest-environment jsdom

import { act } from "react";
import { Profiler, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { singleSelection } from "../../model/selection";
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
    expect(
      newDocument.nextElementSibling?.classList.contains(
        "topbar__actions-divider",
      ),
    ).toBe(true);

    const more = container.querySelector<HTMLButtonElement>(
      "button[aria-label='更多']",
    )!;
    expect(
      container.querySelector<HTMLButtonElement>(
        "button[aria-label='另存为']",
      )?.textContent,
    ).toBe("另存为");
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

  it("keeps the latest pan transform and renders the incoming viewport in the same frame", async () => {
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
      "translate3d(0px, -1600px, 0) scale(1)",
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
      0.8705505633,
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
      "node-1",
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
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
    expect(container.querySelector(".node-drag-preview")).toBeNull();
  });
});
