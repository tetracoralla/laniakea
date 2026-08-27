// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardCommands } from "./useKeyboardCommands";

describe("keyboard commands after editor commit", () => {
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

  it("runs a deferred global command with the callback from the committed render", async () => {
    const copiedValues: string[] = [];

    function Harness() {
      const [value, setValue] = useState("提交前");
      useKeyboardCommands({
        enabled: true,
        selectionEnabled: false,
        onCommand: () => copiedValues.push(value),
        onBeginTyping: vi.fn(),
        onPasteText: vi.fn(),
      });
      return (
        <textarea
          defaultValue="正在编辑"
          onBlur={() => setValue("刚提交的内容")}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const editor = container.querySelector("textarea")!;
    editor.focus();

    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "KeyC",
          key: "c",
          metaKey: true,
          shiftKey: true,
        }),
      );
      await Promise.resolve();
    });

    expect(copiedValues).toEqual(["刚提交的内容"]);
  });

  it("leaves Command-V native and pastes event text directly on the canvas", async () => {
    const onCommand = vi.fn();
    const onPasteText = vi.fn();

    function Harness() {
      useKeyboardCommands({
        enabled: true,
        selectionEnabled: true,
        onCommand,
        onBeginTyping: vi.fn(),
        onPasteText,
      });
      return <button className="mindmap-canvas">已选择节点</button>;
    }

    await act(async () => root.render(<Harness />));
    const canvas = container.querySelector<HTMLButtonElement>("button")!;
    canvas.focus();

    const keydown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyV",
      key: "v",
      metaKey: true,
    });
    canvas.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);
    expect(onCommand).not.toHaveBeenCalled();

    const paste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: (format: string) =>
          format === "text/plain" ? "- 单个节点" : "",
      },
    });
    canvas.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(onPasteText).toHaveBeenCalledOnce();
    expect(onPasteText).toHaveBeenCalledWith("- 单个节点");
  });

  it("does not intercept paste while a text editor owns focus", async () => {
    const onPasteText = vi.fn();

    function Harness() {
      useKeyboardCommands({
        enabled: true,
        selectionEnabled: true,
        onCommand: vi.fn(),
        onBeginTyping: vi.fn(),
        onPasteText,
      });
      return (
        <div className="mindmap-canvas">
          <textarea />
        </div>
      );
    }

    await act(async () => root.render(<Harness />));
    const editor = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const paste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "原生文本输入" },
    });
    editor.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(false);
    expect(onPasteText).not.toHaveBeenCalled();
  });
});
