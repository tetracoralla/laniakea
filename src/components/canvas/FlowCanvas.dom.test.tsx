// @vitest-environment jsdom

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
    const created = createFlowSpace(createSeedDocument(), "path");
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

  it("leaves Space activation to controls outside the Flow canvas", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
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

  it("shows selected-only direct creation controls and keeps the right-click fallback", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
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

    const directActions = container.querySelector(".flow-node__quick-actions");
    expect(directActions).not.toBeNull();
    expect(container.querySelectorAll(".flow-node__port")).toHaveLength(4);
    await act(async () => {
      directActions
        ?.querySelector<HTMLButtonElement>("[aria-label='添加判断']")
        ?.click();
    });
    expect(onAddNode).toHaveBeenCalledWith(
      created.selectedFlowNodeId,
      "decision",
      "right",
      expect.objectContaining({
        [created.selectedFlowNodeId]: { x: 140, y: 140 },
      }),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".flow-node__port--right")
        ?.click();
    });
    expect(onAddNode).toHaveBeenLastCalledWith(
      created.selectedFlowNodeId,
      "step",
      "right",
      expect.any(Object),
    );

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
  });

  it("preserves native composition text and commits once on Enter", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
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

  it("commits final IME text after composition-time blur", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    await act(async () => label.click());
    const editor = container.querySelector<HTMLInputElement>(
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    await act(async () => label.click());
    const editor = container.querySelector<HTMLInputElement>(
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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

  it("deletes a selected edge from the contextual control or Delete key", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
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
    expect(container.querySelector(".flow-edge-delete")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".flow-edge-delete")!.click();
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

  it("keeps a directional arrow on a selected edge via the highlighted marker", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
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
    expect(connector.getAttribute("marker-end")).toBe(
      `url(#flow-arrow-${added.space.id})`,
    );

    await act(async () => {
      container.querySelector<SVGPathElement>(".flow-connector__hit")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const selected = container.querySelector<SVGPathElement>(
      ".flow-connector.is-selected",
    )!;
    expect(selected).not.toBeNull();
    expect(selected.getAttribute("marker-end")).toBe(
      `url(#flow-arrow-selected-${added.space.id})`,
    );
    expect(
      container.querySelector(".flow-connectors marker.is-selected"),
    ).not.toBeNull();
  });

  it("flushes the latest wheel viewport when the flow surface unmounts", async () => {
    vi.useFakeTimers();
    const created = createFlowSpace(createSeedDocument(), "path");
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
    const created = createFlowSpace(createSeedDocument(), "path");
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
