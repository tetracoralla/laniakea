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
});
