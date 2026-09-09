// @vitest-environment jsdom
import { createFlowWithStep } from "../../test/flowFixture";

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../../data/seed";
import {
  addFlowBranch,
  addFlowNodeAfter,
  connectFlowNodes,
  createFlowSpace,
  flowSpaceForNode,
  setFlowEdgeRoute,
  setFlowEdgeStyle,
  setFlowNodeText,
} from "../../model/spaces";
import { FlowCanvas } from "./FlowCanvas";

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

describe("FlowCanvas", () => {
  let container: HTMLDivElement;
  let root: Root;
  let pointerCaptures: WeakMap<HTMLElement, Set<number>>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    pointerCaptures = new WeakMap();
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: {
        configurable: true,
        value: vi.fn(function (this: HTMLElement, pointerId: number) {
          return pointerCaptures.get(this)?.has(pointerId) ?? false;
        }),
      },
      releasePointerCapture: {
        configurable: true,
        value: vi.fn(function (this: HTMLElement, pointerId: number) {
          pointerCaptures.get(this)?.delete(pointerId);
        }),
      },
      setPointerCapture: {
        configurable: true,
        value: vi.fn(function (this: HTMLElement, pointerId: number) {
          const captures = pointerCaptures.get(this) ?? new Set<number>();
          captures.add(pointerId);
          pointerCaptures.set(this, captures);
        }),
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    vi.restoreAllMocks();
  });

  it("renders semantic shapes for the seeded space", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={space}
        />,
      );
    });

    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    expect(container.querySelectorAll(".flow-node")).toHaveLength(1);
    expect(container.querySelector(".flow-node--step")).not.toBeNull();
    expect(container.querySelector(".flow-node--start")).toBeNull();
    expect(container.querySelector(".flow-node--end")).toBeNull();
    expect(canvas.getAttribute("role")).toBe("application");
  });

  it("places a blank double-click in the live viewport and ignores object or modified double-clicks", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onAddShape = vi.fn();
    const onViewportChange = vi.fn();
    await act(async () => root.render(
      <FlowCanvas
        space={space} selectedId={null} editingId={null} draft=""
        onAddShape={onAddShape} onAddBranch={vi.fn()} onAddNext={vi.fn()}
        onBeginEdit={vi.fn()} onCancelEdit={vi.fn()} onCommitEdit={vi.fn()}
        onChangeKind={vi.fn()} onChangeEdgeLabel={vi.fn()} onConnect={vi.fn()}
        onDelete={vi.fn()} onDraftChange={vi.fn()} onSelect={vi.fn()}
        onViewportChange={onViewportChange}
      />,
    ));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, x: 0, y: 0, width: 1200, height: 800, right: 1200, bottom: 800, toJSON: () => ({}),
    });
    const doubleClick = (target: Element, options = {}) => target.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, clientX: 600, clientY: 400, ...options }),
    );
    await act(async () => {
      canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX: 200, deltaY: 100 }));
      doubleClick(canvas);
    });
    expect(onViewportChange).not.toHaveBeenCalled(); // Its 120ms persistence debounce has not fired.
    expect(onAddShape).toHaveBeenCalledExactlyOnceWith("step", { x: 612, y: 396 }, {});
    onAddShape.mockClear();
    // Chrome targets the click at the element that captured pointer-up.
    // A blank-canvas double-click still creates a step after releasing pan.
    const panSurface = container.querySelector<HTMLElement>(".canvas-pan-surface")!;
    await act(async () => doubleClick(panSurface));
    expect(onAddShape).toHaveBeenCalledExactlyOnceWith("step", { x: 612, y: 396 }, {});
    onAddShape.mockClear();
    await act(async () => {
      doubleClick(container.querySelector(".flow-shape-palette button")!);
      doubleClick(canvas, { shiftKey: true });
      doubleClick(canvas, { metaKey: true });
      doubleClick(canvas, { button: 2 });
      canvas.focus();
      canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
      doubleClick(canvas);
      doubleClick(panSurface);
      canvas.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
    });
    expect(onAddShape).not.toHaveBeenCalled();
  });

  it("starts an empty flow from Enter at the view center but not where steps already exist", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onAddShape = vi.fn();
    const onAddNext = vi.fn();
    await act(async () => root.render(
      <FlowCanvas
        space={space} selectedId={null} editingId={null} draft=""
        onAddShape={onAddShape} onAddBranch={vi.fn()} onAddNext={onAddNext}
        onBeginEdit={vi.fn()} onCancelEdit={vi.fn()} onCommitEdit={vi.fn()}
        onChangeKind={vi.fn()} onChangeEdgeLabel={vi.fn()} onConnect={vi.fn()}
        onDelete={vi.fn()} onDraftChange={vi.fn()} onSelect={vi.fn()}
        onViewportChange={vi.fn()}
      />,
    ));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, x: 0, y: 0, width: 1200, height: 800, right: 1200, bottom: 800, toJSON: () => ({}),
    });
    await act(async () => {
      canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX: 200, deltaY: 100 }));
      canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    });
    // Same placement decision as the verified blank double-click at (600, 400).
    expect(onAddShape).toHaveBeenCalledExactlyOnceWith("step", { x: 612, y: 396 }, {});
    expect(onAddNext).not.toHaveBeenCalled();

    onAddShape.mockClear();
    const populated = createFlowWithStep(createSeedDocument(), "path");
    await act(async () => root.render(
      <FlowCanvas
        space={flowSpaceForNode(populated.document, "path")!}
        selectedId={null} editingId={null} draft=""
        onAddShape={onAddShape} onAddBranch={vi.fn()} onAddNext={onAddNext}
        onBeginEdit={vi.fn()} onCancelEdit={vi.fn()} onCommitEdit={vi.fn()}
        onChangeKind={vi.fn()} onChangeEdgeLabel={vi.fn()} onConnect={vi.fn()}
        onDelete={vi.fn()} onDraftChange={vi.fn()} onSelect={vi.fn()}
        onViewportChange={vi.fn()}
      />,
    ));
    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    });
    expect(onAddShape).not.toHaveBeenCalled();
    expect(onAddNext).not.toHaveBeenCalled();
  });

  it("leaves Space activation to controls outside the Flow canvas", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onSpaceTap = vi.fn();
    const chromeButton = document.createElement("button");
    chromeButton.textContent = "新建";
    document.body.append(chromeButton);

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onSpaceTap={onSpaceTap}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });

    const chromeKeyDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    await act(async () => {
      chromeButton.dispatchEvent(chromeKeyDown);
      chromeButton.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: " " }),
      );
    });
    expect(chromeKeyDown.defaultPrevented).toBe(false);
    expect(onSpaceTap).not.toHaveBeenCalled();

    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " " }),
      );
      canvas.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: " " }),
      );
    });
    expect(onSpaceTap).toHaveBeenCalledOnce();
    chromeButton.remove();
  });

  it("uses four ports for creation and retains the right-click object menu", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onAddNode = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNode={onAddNode}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });

    expect(container.querySelector(".flow-node__quick-actions")).toBeNull();
    expect(container.querySelectorAll(".flow-node__port")).toHaveLength(4);

    const rightPort = container.querySelector<HTMLButtonElement>(
      ".flow-node__port--right",
    )!;
    await act(async () => {
      rightPort.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(container.querySelector(".flow-quick-create-preview__node")).toBeNull();
    await act(async () => {
      rightPort.querySelector("span")!.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
    });
    const previewNode = container.querySelector<HTMLElement>(
      ".flow-quick-create-preview__node",
    )!;
    expect(previewNode).not.toBeNull();
    const previewPosition = {
      x: Number.parseFloat(previewNode.style.left),
      y: Number.parseFloat(previewNode.style.top),
    };
    await act(async () => rightPort.click());
    expect(onAddNode).toHaveBeenLastCalledWith(
      created.selectedFlowNodeId,
      "step",
      "right",
      expect.any(Object),
      previewPosition,
    );
    expect(container.querySelector(".flow-quick-create-preview__node")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".flow-node__content")!.click();
    });
    expect(container.querySelector(".node-context-bar")).toBeNull();
    expect(container.querySelector("[role='menu']")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLElement>(".flow-node")!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 200, clientY: 160 }),
      );
    });
    expect(container.querySelector("[role='menu']")).not.toBeNull();

    const afterMenu = document.createElement("button");
    afterMenu.textContent = "画布后的控件";
    document.body.append(afterMenu);
    await act(async () => afterMenu.focus());
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(afterMenu);

    const returnFocus = container.querySelector<HTMLButtonElement>(
      ".flow-node__content",
    )!;
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    await act(async () => {
      container.querySelector<HTMLElement>(".flow-node")!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 200, clientY: 160 }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(returnFocus);
    requestAnimationFrame.mockRestore();
    afterMenu.remove();
  });

  it("preserves native composition text and commits once on Enter", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onCommitEdit = vi.fn();
    const onDraftChange = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft="旧步骤"
          editingId={created.selectedFlowNodeId}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={onCommitEdit}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={onDraftChange}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });

    const editor = container.querySelector<HTMLTextAreaElement>(
      ".flow-node__editor",
    )!;
    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editor.value = "中文步骤";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      editor.blur();
    });

    expect(onDraftChange).toHaveBeenLastCalledWith("中文步骤");
    expect(onCommitEdit).toHaveBeenCalledOnce();
    expect(onCommitEdit).toHaveBeenCalledWith(
      created.selectedFlowNodeId,
      "中文步骤",
    );
  });

  it("uses the shared session-local undo stack while editing a flow node", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    let draft = "旧步骤";

    const renderCanvas = () => (
      <FlowCanvas
        draft={draft}
        editingId={created.selectedFlowNodeId}
        onAddBranch={() => undefined}
        onAddNext={() => undefined}
        onBeginEdit={() => undefined}
        onCancelEdit={() => undefined}
        onChangeKind={() => undefined}
        onChangeEdgeLabel={() => undefined}
        onCommitEdit={() => undefined}
        onConnect={() => undefined}
        onDelete={() => undefined}
        onDraftChange={(value) => {
          draft = value;
          root.render(renderCanvas());
        }}
        onSelect={() => undefined}
        onViewportChange={() => undefined}
        selectedId={created.selectedFlowNodeId}
        space={space}
      />
    );

    await act(async () => root.render(renderCanvas()));
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".flow-node__editor",
    )!;
    const setEditorValue = (value: string) => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editor, value);
      editor.setSelectionRange(value.length, value.length);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => {
      setEditorValue("步骤一");
      setEditorValue("步骤二");
    });
    const undoEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "z",
      metaKey: true,
    });
    await act(async () => editor.dispatchEvent(undoEvent));
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(editor.value).toBe("步骤一");
    expect(draft).toBe("步骤一");

    const redoEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "z",
      metaKey: true,
      shiftKey: true,
    });
    await act(async () => editor.dispatchEvent(redoEvent));
    expect(redoEvent.defaultPrevented).toBe(true);
    expect(editor.value).toBe("步骤二");
    expect(draft).toBe("步骤二");
  });

  it("commits final IME text after composition-time blur", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onCommitEdit = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={created.selectedFlowNodeId}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={onCommitEdit}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });
    const editor = container.querySelector<HTMLTextAreaElement>(".flow-node__editor")!;
    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editor.value = "liu cheng";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.blur();
    });
    expect(onCommitEdit).not.toHaveBeenCalled();

    await act(async () => {
      editor.value = "流程";
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(onCommitEdit).toHaveBeenCalledOnce();
    expect(onCommitEdit).toHaveBeenCalledWith(created.selectedFlowNodeId, "流程");
  });

  it("keeps Shift+Enter as a newline instead of committing", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onCommitEdit = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={created.selectedFlowNodeId}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={onCommitEdit}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });
    expect(container.querySelector(".flow-node__editor")?.tagName).toBe(
      "TEXTAREA",
    );

    const editor = container.querySelector<HTMLTextAreaElement>(
      ".flow-node__editor",
    )!;
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });

    expect(onCommitEdit).not.toHaveBeenCalled();
  });

  it("renders a real decision outline and edits branch labels in place", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const branched = addFlowBranch(initial, created.selectedFlowNodeId).space;
    const onChangeEdgeLabel = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={onChangeEdgeLabel}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={branched}
        />,
      );
    });

    expect(container.querySelector(".flow-node__decision-shape polygon"))
      .not.toBeNull();
    const label = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".flow-edge-label"),
    ).find((button) => button.textContent === "否")!;
    await act(async () => label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".flow-edge-label__editor",
    )!;
    await act(async () => {
      editor.value = "已通过";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onChangeEdgeLabel).toHaveBeenCalledWith(
      expect.any(String),
      "已通过",
    );
  });

  it("waits for final IME text when a branch label blurs during composition", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const branched = addFlowBranch(initial, created.selectedFlowNodeId).space;
    const onChangeEdgeLabel = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={onChangeEdgeLabel}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={created.selectedFlowNodeId}
          space={branched}
        />,
      );
    });
    const label = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".flow-edge-label"),
    ).find((button) => button.textContent === "否")!;
    await act(async () => label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".flow-edge-label__editor",
    )!;
    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editor.value = "tong guo";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.blur();
    });
    expect(onChangeEdgeLabel).not.toHaveBeenCalled();

    await act(async () => {
      editor.value = "通过";
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(onChangeEdgeLabel).toHaveBeenCalledOnce();
    expect(onChangeEdgeLabel).toHaveBeenCalledWith(expect.any(String), "通过");
  });

  it("connects two different sources to one existing target through direct drag", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const firstBranch = addFlowBranch(
      initial,
      created.selectedFlowNodeId,
    ).space;
    const sourceIds = firstBranch.edges
      .filter((edge) => edge.from === created.selectedFlowNodeId)
      .map((edge) => edge.to);
    expect(sourceIds).toHaveLength(2);
    const inserted = addFlowNodeAfter(firstBranch, sourceIds[0], "step");
    const prepared = {
      ...inserted.space,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const targetId = inserted.nodeId;

    const rect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      top,
      right: left + width,
      bottom: top + height,
      left,
      width,
      height,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("flow-canvas")) {
          return rect(0, 0, 1000, 800);
        }
        if (this.classList.contains("flow-node")) {
          return rect(
            Number.parseFloat(this.style.left),
            Number.parseFloat(this.style.top),
            Number.parseFloat(this.style.width),
            Number.parseFloat(this.style.height),
          );
        }
        if (this.classList.contains("flow-node__port")) {
          const nodeBounds = this.parentElement!.getBoundingClientRect();
          if (this.classList.contains("flow-node__port--up")) {
            return rect((nodeBounds.left + nodeBounds.right) / 2 - 8, nodeBounds.top - 8, 16, 16);
          }
          if (this.classList.contains("flow-node__port--right")) {
            return rect(nodeBounds.right - 8, (nodeBounds.top + nodeBounds.bottom) / 2 - 8, 16, 16);
          }
          if (this.classList.contains("flow-node__port--left")) {
            return rect(nodeBounds.left - 8, (nodeBounds.top + nodeBounds.bottom) / 2 - 8, 16, 16);
          }
          return rect(
            (nodeBounds.left + nodeBounds.right) / 2 - 8,
            nodeBounds.bottom - 8,
            16,
            16,
          );
        }
        return rect(0, 0, 0, 0);
      },
    );

    let latestSpace = prepared;
    const onAddNode = vi.fn();
    function Harness() {
      const [space, setSpace] = useState(prepared);
      const [selectedId, setSelectedId] = useState<string | null>(sourceIds[0]);
      latestSpace = space;
      return (
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNode={onAddNode}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={(fromId, toId, ports) => {
            setSpace((current) => connectFlowNodes(current, fromId, toId, ports));
            setSelectedId(toId);
          }}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={setSelectedId}
          onViewportChange={() => undefined}
          selectedId={selectedId}
          space={space}
        />
      );
    }

    await act(async () => root.render(<Harness />));

    const pressedSource = container.querySelector<HTMLElement>(
      `[data-flow-node-id="${sourceIds[1]}"]`,
    )!;
    const pressedPort = pressedSource.querySelector<HTMLButtonElement>(
      ".flow-node__port--right",
    )!;
    const pressedBounds = pressedPort.getBoundingClientRect();
    const pressedX = (pressedBounds.left + pressedBounds.right) / 2;
    const pressedY = (pressedBounds.top + pressedBounds.bottom) / 2;
    await act(async () => {
      dispatchPointer(pressedPort, "pointerdown", pressedX, pressedY, 10);
      dispatchPointer(
        container.querySelector<HTMLElement>(".flow-canvas")!,
        "pointerup",
        pressedX,
        pressedY,
        10,
      );
    });
    expect(onAddNode).toHaveBeenCalledWith(
      sourceIds[1],
      "step",
      "right",
      expect.any(Object),
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );

    const dragSourceToTarget = async (
      sourceId: string,
      releaseType: "pointerup" | "pointercancel",
    ) => {
      const sourceNode = container.querySelector<HTMLElement>(
        `[data-flow-node-id="${sourceId}"]`,
      )!;
      await act(async () => {
        sourceNode.querySelector<HTMLButtonElement>(".flow-node__content")!.click();
      });
      const handle = sourceNode.querySelector<HTMLButtonElement>(
        ".flow-node__port--right",
      )!;
      const handleBounds = handle.getBoundingClientRect();
      const targetNode = container.querySelector<HTMLElement>(
        `[data-flow-node-id="${targetId}"]`,
      )!;
      const targetBounds = targetNode.getBoundingClientRect();
      const startX = (handleBounds.left + handleBounds.right) / 2;
      const startY = (handleBounds.top + handleBounds.bottom) / 2;
      const targetX = (targetBounds.left + targetBounds.right) / 2;
      const targetY = (targetBounds.top + targetBounds.bottom) / 2;

      await act(async () => {
        dispatchPointer(handle, "pointerdown", startX, startY);
        dispatchPointer(
          container.querySelector<HTMLElement>(".flow-canvas")!,
          "pointermove",
          targetX,
          targetY,
        );
      });
      expect(targetNode.classList.contains("is-connection-target")).toBe(true);
      await act(async () => {
        dispatchPointer(
          container.querySelector<HTMLElement>(".flow-canvas")!,
          releaseType,
          targetX,
          targetY,
        );
      });
      expect(targetNode.classList.contains("is-connection-target")).toBe(false);
    };

    await dragSourceToTarget(sourceIds[1], "pointercancel");
    expect(latestSpace.edges.filter((edge) => edge.to === targetId)).toHaveLength(1);
    await dragSourceToTarget(sourceIds[1], "pointerup");

    expect(latestSpace.edges.filter((edge) => edge.to === targetId)).toHaveLength(2);
    expect(
      latestSpace.edges.find(
        (edge) => edge.from === sourceIds[1] && edge.to === targetId,
      ),
    ).toMatchObject({ fromPort: "right", toPort: "up" });
    expect(new Set(latestSpace.edges.map((edge) => edge.id)).size).toBe(
      latestSpace.edges.length,
    );
  });

  it("moves a node directly and discards an interrupted drag", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = {
      ...flowSpaceForNode(created.document, "path")!,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const onPositionsChange = vi.fn();
    const renderCanvas = (currentSpace: typeof space) => (
      <FlowCanvas
        draft=""
        editingId={null}
        onAddBranch={() => undefined}
        onAddNext={() => undefined}
        onBeginEdit={() => undefined}
        onCancelEdit={() => undefined}
        onChangeKind={() => undefined}
        onChangeEdgeLabel={() => undefined}
        onCommitEdit={() => undefined}
        onConnect={() => undefined}
        onDelete={() => undefined}
        onDraftChange={() => undefined}
        onPositionsChange={onPositionsChange}
        onSelect={() => undefined}
        onViewportChange={() => undefined}
        selectedId={created.selectedFlowNodeId}
        space={currentSpace}
      />
    );

    await act(async () => root.render(renderCanvas(space)));

    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    const content = container.querySelector<HTMLElement>(".flow-node__content")!;
    await act(async () => {
      dispatchPointer(content, "pointerdown", 200, 180);
      dispatchPointer(canvas, "pointermove", 260, 220);
      dispatchPointer(canvas, "pointerup", 260, 220);
    });
    expect(onPositionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        [created.selectedFlowNodeId]: { x: 200, y: 180 },
      }),
    );
    const committedPositions = onPositionsChange.mock.calls[0][0];
    await act(async () => {
      root.render(renderCanvas({ ...space, positions: committedPositions }));
    });
    expect(
      container.querySelector<HTMLElement>(".flow-node")?.style.left,
    ).toBe("200px");
    expect(
      container.querySelector<HTMLElement>(".flow-node")?.style.top,
    ).toBe("180px");

    const callsAfterCommit = onPositionsChange.mock.calls.length;
    const movedContent = container.querySelector<HTMLElement>(
      ".flow-node__content",
    )!;
    await act(async () => {
      dispatchPointer(movedContent, "pointerdown", 200, 180, 8);
      dispatchPointer(canvas, "pointermove", 320, 260, 8);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onPositionsChange).toHaveBeenCalledTimes(callsAfterCommit);
    expect(movedContent.parentElement?.style.transform).toBe("");

    await act(async () => {
      dispatchPointer(movedContent, "pointerdown", 200, 180, 9);
      dispatchPointer(canvas, "pointerup", 240, 210, 9);
    });
    expect(onPositionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        [created.selectedFlowNodeId]: { x: 240, y: 210 },
      }),
    );
  });

  it("ignores wheel viewport changes while a node drag owns the pointer", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = {
      ...flowSpaceForNode(created.document, "path")!,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const onPositionsChange = vi.fn();
    const onViewportChange = vi.fn();
    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDeleteEdge={() => undefined}
          onDraftChange={() => undefined}
          onPositionsChange={onPositionsChange}
          onSelect={() => undefined}
          onViewportChange={onViewportChange}
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });

    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    const content = container.querySelector<HTMLElement>(".flow-node__content")!;
    await act(async () => {
      dispatchPointer(content, "pointerdown", 200, 180);
      dispatchPointer(canvas, "pointermove", 260, 220);
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 260,
          ctrlKey: true,
          deltaY: -120,
        }),
      );
      dispatchPointer(canvas, "pointerup", 260, 220);
      // The same wheel gesture after the gesture ends must zoom again.
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 260,
          ctrlKey: true,
          deltaY: -120,
        }),
      );
    });
    // Unmount flushes any scheduled viewport write, so both the gated and the
    // allowed wheel events would have surfaced here had gating failed.
    await act(async () => root.unmount());

    expect(onPositionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        [created.selectedFlowNodeId]: { x: 200, y: 180 },
      }),
    );
    expect(onViewportChange).toHaveBeenCalledOnce();
    expect(onViewportChange.mock.calls[0][0].zoom).toBeGreaterThan(1);
  });

  it("adds palette shapes by click or drag without forcing a terminal", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = {
      ...flowSpaceForNode(created.document, "path")!,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const onAddShape = vi.fn();
    const rect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      top,
      right: left + width,
      bottom: top + height,
      left,
      width,
      height,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("flow-canvas")
          ? rect(0, 0, 1000, 800)
          : rect(0, 0, 0, 0);
      },
    );

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onAddShape={onAddShape}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={space}
        />,
      );
    });

    expect(container.querySelectorAll(".flow-shape-palette__item")).toHaveLength(3);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[aria-label='添加起止图形']",
      )!.click();
    });
    expect(onAddShape).toHaveBeenCalledWith(
      "start",
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      expect.any(Object),
    );
    const clickPosition = onAddShape.mock.calls[0][1];
    const existingNode = container.querySelector<HTMLElement>(".flow-node")!;
    expect(clickPosition.x).toBeGreaterThanOrEqual(
      Number.parseFloat(existingNode.style.left) +
      Number.parseFloat(existingNode.style.width) +
      18,
    );

    const decision = container.querySelector<HTMLButtonElement>(
      "[aria-label='添加判断图形']",
    )!;
    await act(async () => {
      dispatchPointer(decision, "pointerdown", 48, 400, 21);
      dispatchPointer(decision, "pointermove", 420, 310, 21);
      dispatchPointer(decision, "pointerup", 420, 310, 21);
    });
    expect(onAddShape).toHaveBeenLastCalledWith(
      "decision",
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      expect.any(Object),
    );
  });

  it("selects a connector and drags its existing endpoint to another side", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    const sourceId = created.selectedFlowNodeId;
    const targetId = added.nodeId;
    const space = {
      ...added.space,
      positions: {
        [sourceId]: { x: 140, y: 180 },
        [targetId]: { x: 500, y: 180 },
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const onReconnectEdge = vi.fn();
    const rect = (left: number, top: number, width: number, height: number) => ({
      x: left,
      y: top,
      top,
      right: left + width,
      bottom: top + height,
      left,
      width,
      height,
      toJSON: () => ({}),
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this instanceof HTMLElement && this.classList.contains("flow-canvas")) {
          return rect(0, 0, 1000, 800) as DOMRect;
        }
        if (this instanceof HTMLElement && this.classList.contains("flow-node")) {
          return rect(
            Number.parseFloat(this.style.left),
            Number.parseFloat(this.style.top),
            Number.parseFloat(this.style.width),
            Number.parseFloat(this.style.height),
          ) as DOMRect;
        }
        if (this instanceof SVGElement && this.tagName.toLowerCase() === "circle") {
          const cx = Number(this.getAttribute("cx"));
          const cy = Number(this.getAttribute("cy"));
          return rect(cx - 6, cy - 6, 12, 12) as DOMRect;
        }
        return rect(0, 0, 0, 0) as DOMRect;
      },
    );

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onReconnectEdge={onReconnectEdge}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={space}
        />,
      );
    });

    await act(async () => {
      container.querySelector<SVGPathElement>(".flow-connector__hit")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const handle = container.querySelector<SVGCircleElement>(
      ".flow-edge-handle--from",
    )!;
    expect(handle).not.toBeNull();
    expect(handle.closest(".flow-edge-handle-layer")).not.toBeNull();
    const source = container.querySelector<HTMLElement>(
      `[data-flow-node-id="${sourceId}"]`,
    )!;
    const sourceBounds = source.getBoundingClientRect();
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    await act(async () => {
      dispatchPointer(handle as unknown as HTMLElement, "pointerdown", 336, 207, 22);
      dispatchPointer(
        canvas,
        "pointermove",
        sourceBounds.left,
        (sourceBounds.top + sourceBounds.bottom) / 2,
        22,
      );
      dispatchPointer(
        canvas,
        "pointerup",
        sourceBounds.left,
        (sourceBounds.top + sourceBounds.bottom) / 2,
        22,
      );
    });
    expect(onReconnectEdge).toHaveBeenCalledWith(
      space.edges[0].id,
      "from",
      sourceId,
      "left",
    );
  });

  it("selects a connector and reopens either endpoint from the keyboard", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    const onReconnectEdge = vi.fn();
    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onReconnectEdge={onReconnectEdge}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={added.space}
        />,
      );
    });

    const hit = container.querySelector<SVGPathElement>(".flow-connector__hit")!;
    expect(hit.getAttribute("role")).toBe("button");
    expect(hit.getAttribute("aria-label")).toContain("到");
    hit.focus();
    await act(async () => {
      hit.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }));
    });
    expect(document.activeElement).toBe(hit);
    expect(container.querySelector(".flow-edge-toolbar__delete")).not.toBeNull();

    const endpoint = container.querySelector<SVGCircleElement>(
      ".flow-edge-handle--from",
    )!;
    endpoint.focus();
    await act(async () => {
      endpoint.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: " ",
      }));
    });
    expect(container.textContent).toContain("重连起点");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[role='option']")!.click();
    });
    expect(onReconnectEdge).toHaveBeenCalledWith(
      added.space.edges[0].id,
      "from",
      created.selectedFlowNodeId,
      expect.any(String),
    );
  });

  it("deletes a selected edge from the contextual control or Delete key", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    const onDeleteEdge = vi.fn();
    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDeleteEdge={onDeleteEdge}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={added.space}
        />,
      );
    });
    const selectEdge = () => act(async () => {
      container.querySelector<SVGPathElement>(".flow-connector__hit")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await selectEdge();
    expect(container.querySelector(".flow-edge-toolbar__delete")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".flow-edge-toolbar__delete")!.click();
    });
    expect(onDeleteEdge).toHaveBeenCalledWith(added.space.edges[0].id);

    onDeleteEdge.mockClear();
    await selectEdge();
    await act(async () => {
      container.querySelector<HTMLElement>(".flow-canvas")!.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
      );
    });
    expect(onDeleteEdge).toHaveBeenCalledWith(added.space.edges[0].id);
  });

  it("edits connector appearance and drags its route without changing endpoints", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    const onChangeEdgeRoute = vi.fn();
    const onChangeEdgeStyle = vi.fn();
    let renderedSpace = added.space;

    function Harness() {
      const [space, setSpace] = useState(added.space);
      renderedSpace = space;
      return (
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onChangeEdgeRoute={(edgeId, route) => {
            onChangeEdgeRoute(edgeId, route);
            setSpace((current) => setFlowEdgeRoute(current, edgeId, route));
          }}
          onChangeEdgeStyle={(edgeId, patch) => {
            onChangeEdgeStyle(edgeId, patch);
            setSpace((current) => setFlowEdgeStyle(current, edgeId, patch));
          }}
          onChangeKind={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={space}
        />
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      container.querySelector<SVGPathElement>(".flow-connector__hit")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[aria-label='调整连线样式']",
      )!.click();
    });
    expect(container.querySelector(".flow-edge-style-panel")).not.toBeNull();
    const panel = container.querySelector<HTMLElement>(".flow-edge-style-panel")!;
    const content = container.querySelector<HTMLElement>(".flow-canvas__content")!;
    const transformBefore = content.style.transform;
    const scroll = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    const pinch = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, ctrlKey: true });
    await act(async () => {
      panel.querySelector("button")!.dispatchEvent(scroll);
      panel.querySelector("button")!.dispatchEvent(pinch);
    });
    // The panel may scroll in a short window, without panning the document or
    // invoking browser zoom. This includes events on its nested controls.
    expect(scroll.defaultPrevented).toBe(false);
    expect(pinch.defaultPrevented).toBe(true);
    expect(content.style.transform).toBe(transformBefore);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[aria-label='曲线']")!.click();
      container.querySelector<HTMLButtonElement>("[aria-label='虚线']")!.click();
      container.querySelector<HTMLButtonElement>("[aria-label='圆环']")!.click();
    });
    expect(onChangeEdgeStyle).toHaveBeenCalledWith(
      added.space.edges[0].id,
      { kind: "curved" },
    );
    expect(onChangeEdgeStyle).toHaveBeenCalledWith(
      added.space.edges[0].id,
      { dash: "dashed" },
    );
    expect(onChangeEdgeStyle).toHaveBeenCalledWith(
      added.space.edges[0].id,
      expect.objectContaining({ sourceEndpoint: "ring" }),
    );
    expect(container.querySelector(".flow-connector")?.getAttribute("d"))
      .toContain(" C ");
    expect(container.querySelector(".flow-edge-route-handle")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        "[aria-label='圆角折线']",
      )!.click();
    });

    const routeHandle = container.querySelector<SVGCircleElement>(
      ".flow-edge-route-handle",
    )!;
    expect(routeHandle).not.toBeNull();
    const startX = Number(routeHandle.getAttribute("cx"));
    const startY = Number(routeHandle.getAttribute("cy"));
    const axis = routeHandle.classList.contains("flow-edge-route-handle--x")
      ? "x"
      : "y";
    await act(async () => {
      dispatchPointer(routeHandle as unknown as HTMLElement, "pointerdown", startX, startY, 31);
      dispatchPointer(
        routeHandle as unknown as HTMLElement,
        "pointermove",
        startX + (axis === "x" ? 60 : 0),
        startY + (axis === "y" ? 60 : 0),
        31,
      );
      dispatchPointer(
        routeHandle as unknown as HTMLElement,
        "pointerup",
        startX + (axis === "x" ? 60 : 0),
        startY + (axis === "y" ? 60 : 0),
        31,
      );
    });
    expect(onChangeEdgeRoute).toHaveBeenCalledWith(
      added.space.edges[0].id,
      expect.objectContaining({ axis, coordinate: expect.any(Number) }),
    );
    expect(renderedSpace.edges[0]).toMatchObject({
      from: added.space.edges[0].from,
      to: added.space.edges[0].to,
      style: {
        dash: "dashed",
        kind: "rounded",
        sourceEndpoint: "ring",
      },
    });
    expect(renderedSpace.edgeRoutes?.[added.space.edges[0].id])
      .toEqual(expect.objectContaining({ axis, coordinate: expect.any(Number) }));
    const curved = panel.querySelector<HTMLButtonElement>("[aria-label='曲线']")!;
    await act(async () => curved.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(container.querySelector(".flow-edge-style-panel")).toBeNull();
    expect(container.querySelector(".flow-edge-toolbar")).not.toBeNull();
    const styleButton = container.querySelector<HTMLButtonElement>("[aria-label='调整连线样式']")!;
    await act(async () => styleButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(container.querySelector(".flow-edge-toolbar")).toBeNull();
  });

  it.each([
    { zoom: 1, delta: 1600, label: "", offset: 0 },
    { zoom: 0.5, delta: -1600, label: "已有原文 · Label", offset: 700 },
    { zoom: 2, delta: 1600, label: "已有原文 · Label", offset: -500 },
  ])("reveals the label editor from a pinned toolbar at zoom $zoom, then respects continued pan", async ({ zoom, delta, label, offset }) => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    const edge = added.space.edges[0];
    const space = {
      ...added.space,
      viewport: { x: 0, y: 0, zoom },
      edges: [{ ...edge, label }],
      edgeLabelOffsets: { [edge.id]: { x: offset, y: offset } },
    };
    const onChangeEdgeLabel = vi.fn();
    const onViewportChange = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("flow-canvas")) return new DOMRect(0, 0, 760, 320);
      if (this.classList.contains("flow-edge-label__editor")) {
        const content = container.querySelector<HTMLElement>(".flow-canvas__content")!;
        const translation = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(content.style.transform)!;
        const width = Number.parseFloat(this.style.width);
        return new DOMRect(
          Number(translation[1]) + (Number.parseFloat(this.style.left) - width / 2) * zoom,
          Number(translation[2]) + (Number.parseFloat(this.style.top) - 13) * zoom,
          width * zoom, 26 * zoom,
        );
      }
      return new DOMRect();
    });
    await act(async () => root.render(
      <FlowCanvas
        space={space} selectedId={null} editingId={null} draft=""
        onAddBranch={vi.fn()} onAddNext={vi.fn()} onBeginEdit={vi.fn()}
        onCancelEdit={vi.fn()} onCommitEdit={vi.fn()} onChangeKind={vi.fn()}
        onChangeEdgeLabel={onChangeEdgeLabel} onConnect={vi.fn()}
        onDelete={vi.fn()} onDraftChange={vi.fn()} onSelect={vi.fn()}
        onViewportChange={onViewportChange}
      />,
    ));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    const content = container.querySelector<HTMLElement>(".flow-canvas__content")!;
    await act(async () => {
      container.querySelector(".flow-connector__hit")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX: delta, deltaY: delta }));
    });
    const beforeEdit = content.style.transform;
    await act(async () => container.querySelector<HTMLButtonElement>(
      label ? "[aria-label='编辑连线文字']" : "[aria-label='添加连线文字']",
    )!.click());
    const editor = container.querySelector<HTMLTextAreaElement>(".flow-edge-label__editor")!;
    const bounds = editor.getBoundingClientRect();
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe(label);
    expect(bounds.left).toBeGreaterThanOrEqual(84);
    expect(bounds.right).toBeLessThanOrEqual(676);
    expect(bounds.top).toBeGreaterThanOrEqual(80);
    expect(bounds.bottom).toBeLessThanOrEqual(240);
    expect(content.style.transform).not.toBe(beforeEdit);
    expect(content.style.transform).toContain(`scale(${zoom})`);
    expect(onChangeEdgeLabel).not.toHaveBeenCalled();

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "继续输入一条较长的连线说明 · A longer connection label");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(editor.getBoundingClientRect().right).toBeLessThanOrEqual(760);

    // Continued manual pan and typing must not repeatedly reveal the editor.
    await act(async () => canvas.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, deltaX: 900, deltaY: 900,
    })));
    const afterPan = content.style.transform;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "继续编辑 · Continued");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor.value).toBe("继续编辑 · Continued");
    expect(content.style.transform).toBe(afterPan);
    await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true, cancelable: true, key: "Escape",
    })));
    expect(container.querySelector(".flow-edge-label__editor")).toBeNull();
    expect(onChangeEdgeLabel).not.toHaveBeenCalled();
    expect(space.edges[0].label).toBe(label);
  });

  it("keeps connector controls and hit areas usable when the canvas is zoomed out", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    const space = {
      ...added.space,
      viewport: { x: 0, y: 0, zoom: 0.5 },
    };
    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onChangeKind={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={space}
        />,
      );
    });
    const hitPath = container.querySelector<SVGPathElement>(
      ".flow-connector__hit",
    )!;
    await act(async () => {
      hitPath.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(hitPath.getAttribute("stroke-width")).toBe("32");
    expect(container.querySelector(".flow-edge-handle--from")?.getAttribute("r"))
      .toBe("20");
    expect(container.querySelector(".flow-edge-route-handle")?.getAttribute("r"))
      .toBe("22");
    // Controls retain screen-space size, outside the zoomed content surface.
    const shell = container.querySelector<HTMLElement>(".flow-edge-toolbar-shell")!;
    expect(shell.parentElement).toBe(container.querySelector(".flow-canvas"));
    expect(shell.closest(".flow-canvas__content")).toBeNull();
  });

  it("keeps a directional arrow on a selected edge and highlights its marker", async () => {
    const created = createFlowWithStep(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowNodeAfter(initial, created.selectedFlowNodeId, "step");
    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDeleteEdge={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={() => undefined}
          selectedId={null}
          space={added.space}
        />,
      );
    });

    const connector = container.querySelector<SVGPathElement>(
      ".flow-connector",
    )!;
    expect(connector.getAttribute("marker-end")).toContain(
      `flow-edge-target-${added.space.id}`,
    );

    await act(async () => {
      container.querySelector<SVGPathElement>(".flow-connector__hit")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const selected = container.querySelector<SVGPathElement>(
      ".flow-connector.is-selected",
    )!;
    expect(selected).not.toBeNull();
    expect(selected.getAttribute("marker-end")).toContain(
      `flow-edge-target-${added.space.id}`,
    );
    const selectedMarker = container.querySelector<SVGPathElement>(
      `.flow-connectors marker[id^="flow-edge-target-${added.space.id}"] path`,
    );
    expect(selectedMarker?.style.fill).toBe("var(--violet)");
  });

  it("flushes the latest wheel viewport when the flow surface unmounts", async () => {
    vi.useFakeTimers();
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onViewportChange = vi.fn();

    await act(async () => {
      root.render(
        <FlowCanvas
          draft=""
          editingId={null}
          onAddBranch={() => undefined}
          onAddNext={() => undefined}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onChangeKind={() => undefined}
          onChangeEdgeLabel={() => undefined}
          onCommitEdit={() => undefined}
          onConnect={() => undefined}
          onDelete={() => undefined}
          onDraftChange={() => undefined}
          onSelect={() => undefined}
          onViewportChange={onViewportChange}
          selectedId={null}
          space={space}
        />,
      );
    });
    await act(async () => {
      container.querySelector(".flow-canvas")!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaX: 24, deltaY: 18 }),
      );
      root.render(null);
    });
    expect(onViewportChange).toHaveBeenCalledWith({
      ...space.viewport,
      x: space.viewport.x - 24,
      y: space.viewport.y - 18,
    });
    vi.useRealTimers();
  });

  it("keeps a manual pan when an edit elsewhere relayouts the space", async () => {
    vi.useFakeTimers();
    const created = createFlowWithStep(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const onViewportChange = vi.fn();
    const renderCanvas = (current: typeof space) => (
      <FlowCanvas
        draft=""
        editingId={null}
        onAddBranch={() => undefined}
        onAddNext={() => undefined}
        onBeginEdit={() => undefined}
        onCancelEdit={() => undefined}
        onChangeKind={() => undefined}
        onChangeEdgeLabel={() => undefined}
        onCommitEdit={() => undefined}
        onConnect={() => undefined}
        onDelete={() => undefined}
        onDraftChange={() => undefined}
        onSelect={() => undefined}
        onViewportChange={onViewportChange}
        selectedId={created.selectedFlowNodeId}
        space={current}
      />
    );

    await act(async () => root.render(renderCanvas(space)));
    await act(async () => {
      container.querySelector(".flow-canvas")!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaX: 200 }),
      );
    });
    // A no-op re-render plus a drain forces every pending mount effect and
    // the pan commit to land, giving a stable snapshot before the relayout.
    await act(async () => root.render(renderCanvas(space)));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    const callsBeforeRelayout = onViewportChange.mock.calls.length;
    expect(callsBeforeRelayout).toBeGreaterThan(0);

    // Growing the selected node shifts the row. That relayout
    // must not drag the user's manual pan back toward the selection.
    const edited = setFlowNodeText(
      space,
      created.selectedFlowNodeId,
      "实现路径\n第二行",
    );
    await act(async () => root.render(renderCanvas(edited)));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(onViewportChange.mock.calls.length).toBe(callsBeforeRelayout);
    vi.useRealTimers();
  });
});
