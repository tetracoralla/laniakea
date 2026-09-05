// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasBlankMenu } from "./CanvasBlankMenu";

describe("CanvasBlankMenu", () => {
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
    vi.restoreAllMocks();
  });

  it("uses layout size rather than animated visual bounds at viewport edges", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 114.84,
      left: 0,
      right: 217.8,
      toJSON: () => ({}),
      top: 0,
      width: 217.8,
      x: 0,
      y: 0,
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(220);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(116);
    await act(async () => {
      root.render(
        <CanvasBlankMenu
          clientX={window.innerWidth - 2}
          clientY={window.innerHeight - 2}
          onClose={() => undefined}
          onCreateNode={() => undefined}
          onFit={() => undefined}
          onPaste={() => undefined}
        />,
      );
    });

    const menu = container.querySelector<HTMLElement>("[role='menu']")!;
    expect(Number(menu.style.left.replace("px", "")))
      .toBeLessThanOrEqual(window.innerWidth - 220 - 12);
    expect(Number(menu.style.top.replace("px", "")))
      .toBeLessThanOrEqual(window.innerHeight - 116 - 12);
  });

  it("closes without stealing focus for an outside pointer", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <CanvasBlankMenu
          clientX={40}
          clientY={40}
          onClose={onClose}
          onCreateNode={() => undefined}
          onFit={() => undefined}
          onPaste={() => undefined}
        />,
      );
    });

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
