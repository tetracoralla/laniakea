// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowKeyboardCommands } from "./useFlowKeyboardCommands";

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

  function Harness(props: { selectedId?: string | null }) {
    useFlowKeyboardCommands({
      enabled: true,
      selectedId: props.selectedId === undefined ? "step-1" : props.selectedId,
      onAddNext: handlers.onAddNext,
      onAddBranch: handlers.onAddBranch,
      onBeginEdit: handlers.onBeginEdit,
      onDelete: handlers.onDelete,
      onNavigate: handlers.onNavigate,
      onBack: handlers.onBack,
      onUndo: handlers.onUndo,
      onRedo: handlers.onRedo,
    });
    return (
      <div className="flow-canvas">
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

  function makeHandlers() {
    return {
      onAddNext: vi.fn(),
      onAddBranch: vi.fn(),
      onBeginEdit: vi.fn(),
      onDelete: vi.fn(),
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
});
