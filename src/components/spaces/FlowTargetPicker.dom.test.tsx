// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowNode } from "../../types/mindmap";
import { FlowTargetPicker } from "./FlowTargetPicker";

const now = "2026-08-27T00:00:00.000Z";

function candidates(count: number): FlowNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    text: `步骤 ${index}`,
    kind: "step",
    createdAt: now,
    updatedAt: now,
  }));
}

describe("FlowTargetPicker", () => {
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

  it("bounds a large candidate list while keeping exact search and keyboard choice", async () => {
    const onChoose = vi.fn();
    await act(async () => {
      root.render(
        <FlowTargetPicker
          candidates={candidates(25)}
          onChoose={onChoose}
          onClose={() => undefined}
          sourceLabel="当前步骤"
        />,
      );
    });

    const input = container.querySelector("input")!;
    const list = container.querySelector('[role="listbox"]')!;
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(20);
    expect(container.textContent).toContain("显示前 20 步，共 25 步");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(
      container.querySelector('[role="option"]')?.id,
    );

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "步骤 24");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(container.textContent).not.toContain("显示前");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(onChoose).toHaveBeenCalledWith("node-24");
  });

  it("does not choose a target when Enter only confirms an IME candidate", async () => {
    const onChoose = vi.fn();
    await act(async () => {
      root.render(
        <FlowTargetPicker
          candidates={candidates(3)}
          onChoose={onChoose}
          onClose={() => undefined}
          sourceLabel="当前步骤"
        />,
      );
    });
    const input = container.querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        isComposing: true,
        key: "Enter",
      }));
    });
    expect(onChoose).not.toHaveBeenCalled();
  });
});
