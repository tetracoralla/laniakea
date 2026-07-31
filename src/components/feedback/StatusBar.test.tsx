// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
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

  function renderStatusBar(
    props: Partial<React.ComponentProps<typeof StatusBar>> = {},
  ) {
    const defaults: React.ComponentProps<typeof StatusBar> = {
      notice: null,
      onNoticeActionComplete: vi.fn(),
      onPauseNotice: vi.fn(),
      onResumeNotice: vi.fn(),
      onRetrySave: vi.fn(),
      saveError: null,
      saveState: "saved",
    };
    act(() => {
      root.render(<StatusBar {...defaults} {...props} />);
    });
  }

  it("keeps a compact saved state visible without a second message carrier", () => {
    renderStatusBar();

    expect(container.querySelectorAll(".status-bar")).toHaveLength(1);
    expect(container.textContent).toBe("已保存");
    expect(container.querySelector(".status-bar__divider")).toBeNull();
  });

  it("extends the same carrier when an actionable notice appears", () => {
    const onAction = vi.fn();
    const onComplete = vi.fn();
    renderStatusBar({
      notice: {
        message: "已删除 3 个节点",
        actionLabel: "撤销",
        onAction,
      },
      onNoticeActionComplete: onComplete,
    });

    expect(container.querySelectorAll(".status-bar")).toHaveLength(1);
    expect(container.textContent).toContain("已保存");
    expect(container.textContent).toContain("已删除 3 个节点");
    expect(container.querySelector(".status-bar__divider")).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".status-bar__action")
        ?.click();
    });
    expect(onAction).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("moves between measured widths so notice changes can animate", () => {
    let contentWidth = 66;
    const originalScrollWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return this.classList.contains("status-bar__content")
          ? contentWidth
          : 0;
      },
    });

    const sharedProps: React.ComponentProps<typeof StatusBar> = {
      notice: null,
      onNoticeActionComplete: vi.fn(),
      onPauseNotice: vi.fn(),
      onResumeNotice: vi.fn(),
      onRetrySave: vi.fn(),
      saveError: null,
      saveState: "saved",
    };
    act(() => root.render(<StatusBar {...sharedProps} />));
    const statusBar = container.querySelector<HTMLElement>(".status-bar")!;
    expect(statusBar.style.width).toBe("68px");
    expect(statusBar.classList.contains("is-measured")).toBe(true);

    contentWidth = 246;
    act(() =>
      root.render(
        <StatusBar
          {...sharedProps}
          notice={{ message: "已复制整张图为 Markdown" }}
        />,
      ),
    );
    expect(statusBar.style.width).toBe("248px");

    if (originalScrollWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollWidth",
        originalScrollWidth,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
    }
  });

  it("keeps save failure retryable after a transient notice disappears", () => {
    const onRetrySave = vi.fn();
    renderStatusBar({
      saveError: "磁盘暂时不可写",
      saveState: "error",
      onRetrySave,
    });

    const retry = container.querySelector<HTMLButtonElement>(
      ".status-bar__save--error",
    );
    expect(retry?.textContent).toBe("保存失败");
    expect(retry?.title).toBe("磁盘暂时不可写");

    act(() => retry?.click());
    expect(onRetrySave).toHaveBeenCalledOnce();
  });
});
