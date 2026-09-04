// @vitest-environment jsdom

import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowKeyboardCommands } from "./useFlowKeyboardCommands";
import { useFlowNodeDrag } from "./useFlowNodeDrag";
import { FlowShapePalette } from "../components/canvas/FlowShapePalette";
import type { FlowLayoutResult } from "../model/flowLayout";
import type { FlowSpace } from "../types/mindmap";

describe("flow keyboard commands", () => {
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

  function Harness(props: {
    children?: ReactNode;
    selectedEdgeId?: string | null;
    selectedId?: string | null;
  }) {
    useFlowKeyboardCommands({
      enabled: true,
      selectedId: props.selectedId === undefined ? "step-1" : props.selectedId,
      selectedEdgeId: props.selectedEdgeId,
      onAddNext: handlers.onAddNext,
      onAddBranch: handlers.onAddBranch,
      onBeginEdit: handlers.onBeginEdit,
      onDelete: handlers.onDelete,
      onDeleteEdge: handlers.onDeleteEdge,
      onClearEdgeSelection: handlers.onClearEdgeSelection,
      onNavigate: handlers.onNavigate,
      onBack: handlers.onBack,
      onUndo: handlers.onUndo,
      onRedo: handlers.onRedo,
    });
    return (
      <div className="flow-canvas">
        {props.children}
        <div role="menu">
          <button type="button">判断</button>
        </div>
        <button className="flow-fit-button" type="button">
          适应内容
        </button>
        <input aria-label="编辑流程步骤" />
      </div>
    );
  }

  function NodeDragHarness() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const drag = useFlowNodeDrag({
      containerRef,
      layout: {
        nodes: { "step-1": { x: 0, y: 0 } },
      } as unknown as FlowLayoutResult,
      onMove: () => undefined,
      onSelect: () => undefined,
      space: {
        id: "flow-1",
        viewport: { x: 0, y: 0, zoom: 1 },
      } as unknown as FlowSpace,
    });
    return (
      <div className="flow-canvas" ref={containerRef}>
        <div data-flow-node-id="step-1">
          <button
            onPointerDown={(event) => drag.begin("step-1", event)}
            type="button"
          >
            步骤
          </button>
        </div>
      </div>
    );
  }

  function makeHandlers() {
    return {
      onAddNext: vi.fn(),
      onAddBranch: vi.fn(),
      onBeginEdit: vi.fn(),
      onDelete: vi.fn(),
      onDeleteEdge: vi.fn(),
      onClearEdgeSelection: vi.fn(),
      onNavigate: vi.fn(),
      onBack: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    };
  }

  let handlers = makeHandlers();

  beforeEach(() => {
    handlers = makeHandlers();
  });

  function pressKey(target: Element, key: string, options?: KeyboardEventInit) {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key, ...options }),
    );
  }

  it("keeps Enter/Tab task-native while focus rests on body after a commit", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      pressKey(document.body, "Enter");
      pressKey(document.body, "Tab");
    });
    expect(handlers.onAddNext).toHaveBeenCalledWith("step-1");
    expect(handlers.onAddBranch).toHaveBeenCalledWith("step-1");
  });

  it("runs undo and redo from window capture", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      pressKey(document.body, "z", { metaKey: true });
      pressKey(document.body, "z", { metaKey: true, shiftKey: true });
    });
    expect(handlers.onUndo).toHaveBeenCalledOnce();
    expect(handlers.onRedo).toHaveBeenCalledOnce();
  });

  it("moves the flow selection with direction keys", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      pressKey(document.body, "ArrowUp");
      pressKey(document.body, "ArrowRight");
    });
    expect(handlers.onNavigate.mock.calls).toEqual([["up"], ["right"]]);
  });

  it("returns to the parent space on Escape outside the type menu", async () => {
    await act(async () => root.render(<Harness />));
    const canvas = container.querySelector(".flow-canvas")!;
    await act(async () => pressKey(canvas, "Escape"));
    expect(handlers.onBack).toHaveBeenCalledOnce();

    const menuItem = container.querySelector("[role='menu'] button")!;
    await act(async () => pressKey(menuItem, "Escape"));
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  it("routes selected-edge Escape and Delete without a DOM side channel", async () => {
    await act(async () => root.render(
      <Harness selectedEdgeId="edge-1" selectedId={null} />,
    ));

    await act(async () => pressKey(document.body, "Escape"));
    expect(handlers.onClearEdgeSelection).toHaveBeenCalledOnce();
    expect(handlers.onBack).not.toHaveBeenCalled();

    await act(async () => pressKey(document.body, "Delete"));
    expect(handlers.onDeleteEdge).toHaveBeenCalledWith("edge-1");
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it("keeps native activation keys on the fit button", async () => {
    await act(async () => root.render(<Harness />));
    const fitButton = container.querySelector(".flow-fit-button")!;
    await act(async () => {
      pressKey(fitButton, "Enter");
      pressKey(fitButton, " ");
    });
    expect(handlers.onAddNext).not.toHaveBeenCalled();
    expect(handlers.onBeginEdit).not.toHaveBeenCalled();
  });

  it("leaves native text editing keys to the step editor", async () => {
    await act(async () => root.render(<Harness />));
    const editor = container.querySelector("input")!;
    await act(async () => {
      pressKey(editor, "Enter");
      pressKey(editor, " ");
    });
    expect(handlers.onAddNext).not.toHaveBeenCalled();
    expect(handlers.onBeginEdit).not.toHaveBeenCalled();
  });

  it("ignores keys while disabled or without a selection", async () => {
    await act(async () => root.render(<Harness selectedId={null} />));
    await act(async () => pressKey(document.body, "Enter"));
    expect(handlers.onAddNext).not.toHaveBeenCalled();
  });

  it("does not return to the parent while Escape is cancelling a palette shape drag", async () => {
    await act(async () =>
      root.render(
        <Harness>
          <FlowShapePalette onDrop={() => undefined} onInsert={() => undefined} />
        </Harness>,
      ),
    );
    const shapeButton = container.querySelector<HTMLButtonElement>(
      ".flow-shape-palette__item",
    )!;
    await act(async () => {
      shapeButton.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 60,
          clientY: 60,
        }),
      );
    });
    expect(container.querySelector(".flow-shape-drag-ghost")).not.toBeNull();

    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    await act(async () => window.dispatchEvent(escape));

    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(container.querySelector(".flow-shape-drag-ghost")).toBeNull();
  });

  it("keeps Escape owned by an active node drag even when the drag listener mounted later", async () => {
    const keyboardContainer = document.createElement("div");
    const dragContainer = document.createElement("div");
    document.body.append(keyboardContainer, dragContainer);
    const keyboardRoot = createRoot(keyboardContainer);
    const dragRoot = createRoot(dragContainer);
    try {
      // Keyboard commands register first; the node drag mounts in a second
      // root afterwards. Registration order must not decide who wins Escape.
      await act(async () => keyboardRoot.render(<Harness>{null}</Harness>));
      await act(async () => dragRoot.render(<NodeDragHarness />));

      const nodeButton = dragContainer.querySelector<HTMLButtonElement>(
        "[data-flow-node-id] button",
      )!;
      await act(async () => {
        nodeButton.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerId: 2,
          }),
        );
      });

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          }),
        );
      });
      expect(handlers.onBack).not.toHaveBeenCalled();

      // Once the gesture is gone, Escape belongs to the keyboard layer again.
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          }),
        );
      });
      expect(handlers.onBack).toHaveBeenCalledOnce();
    } finally {
      await act(async () => {
        keyboardRoot.unmount();
        dragRoot.unmount();
      });
      keyboardContainer.remove();
      dragContainer.remove();
    }
  });
});
