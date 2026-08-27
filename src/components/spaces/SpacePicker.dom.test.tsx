// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacePicker } from "./SpacePicker";

describe("SpacePicker", () => {
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

  it("offers map and flow only after drill-down is invoked", async () => {
    const onCreate = vi.fn();
    await act(async () => {
      root.render(
        <SpacePicker
          onCreate={onCreate}
          onClose={() => undefined}
        />,
      );
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']")!;
    expect(dialog.querySelector("h2")?.textContent).toBe("选择下层图类型");
    expect(dialog.querySelector(".space-picker__eyebrow")).toBeNull();
    expect(dialog.querySelector(".space-picker__description")).toBeNull();
    expect(dialog.querySelector(".space-picker__choice-kicker")).toBeNull();
    expect(dialog.textContent).not.toContain("Space");
    const choices = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>(".space-picker__choices button"),
    );
    expect(choices.map((button) => button.querySelector("strong")?.textContent))
      .toEqual(["思维图", "流程"]);

    await act(async () => choices[1].click());
    expect(choices[1].getAttribute("aria-checked")).toBe("true");
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => {
      dialog.querySelector<HTMLButtonElement>(".space-picker__create")!.click();
    });
    expect(onCreate).toHaveBeenCalledWith("flow");
  });

  it("creates the focused choice with Enter and supports direct double click", async () => {
    const onCreate = vi.fn();
    await act(async () => {
      root.render(
        <SpacePicker onCreate={onCreate} onClose={() => undefined} />,
      );
    });
    const choices = container.querySelectorAll<HTMLButtonElement>(
      ".space-picker__choices button",
    );
    await act(async () => {
      choices[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      choices[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onCreate.mock.calls).toEqual([["map"], ["flow"]]);
  });
});
