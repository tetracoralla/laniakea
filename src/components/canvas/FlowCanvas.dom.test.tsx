// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../../data/seed";
import {
  addFlowBranch,
  createFlowSpace,
  flowSpaceForNode,
  setFlowNodeText,
} from "../../model/spaces";
import { FlowCanvas } from "./FlowCanvas";

describe("FlowCanvas", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
    expect(container.querySelectorAll(".flow-node")).toHaveLength(3);
    expect(container.querySelector(".flow-node--start")).not.toBeNull();
    expect(container.querySelector(".flow-node--end")).not.toBeNull();
    expect(canvas.getAttribute("role")).toBe("application");
  });

  it("keeps ordinary selection quiet and opens operations only on right click", async () => {
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
          selectedId={created.selectedFlowNodeId}
          space={space}
        />,
      );
    });

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
    ).find((button) => button.textContent === "分支 2")!;
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

    // Growing the start node shifts the selected step's row. That relayout
    // must not drag the user's manual pan back toward the selection.
    const startId = Object.values(space.nodes).find(
      ({ kind }) => kind === "start",
    )!.id;
    const edited = setFlowNodeText(space, startId, "开始\n第二行");
    await act(async () => root.render(renderCanvas(edited)));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(onViewportChange.mock.calls.length).toBe(callsBeforeRelayout);
    vi.useRealTimers();
  });
});
