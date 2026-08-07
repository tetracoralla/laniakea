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
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      window.clearTimeout(handle);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function finishEntrance() {
    act(() => vi.advanceTimersByTime(16));
  }

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

  it("keeps the canvas clear while the saved state is idle", () => {
    renderStatusBar();

    expect(container.querySelector(".status-bar")).toBeNull();
  });

  it("shows an actionable notice without repeating the idle save state", () => {
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
    expect(container.textContent).not.toContain("已保存");
    expect(container.textContent).toContain("已删除 3 个节点");
    expect(container.querySelector(".status-bar__divider")).toBeNull();
    expect(
      container.querySelector(".status-bar")?.classList.contains("is-expanded"),
    ).toBe(false);

    finishEntrance();
    expect(
      container.querySelector(".status-bar")?.classList.contains("is-expanded"),
    ).toBe(true);
    expect(
      container
        .querySelector(".status-bar__notice")
        ?.classList.contains("is-visible"),
    ).toBe(true);

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
    act(() =>
      root.render(
        <StatusBar
          {...sharedProps}
          notice={{ message: "已复制节点" }}
        />,
      ),
    );
    const statusBar = container.querySelector<HTMLElement>(".status-bar")!;
    expect(statusBar.style.width).toBe("38px");
    expect(statusBar.classList.contains("is-measured")).toBe(true);
    finishEntrance();
    expect(statusBar.style.width).toBe("68px");

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

  it("waits one second before showing animated save progress", () => {
    renderStatusBar({ saveState: "saving" });

    expect(container.querySelector(".status-bar")).toBeNull();
    act(() => vi.advanceTimersByTime(999));
    expect(container.querySelector(".status-bar")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).toContain("正在保存");
    expect(container.querySelector(".status-bar__spinner")).not.toBeNull();
    finishEntrance();
    expect(
      container
        .querySelector(".status-bar__save")
        ?.classList.contains("is-visible"),
    ).toBe(true);

    renderStatusBar({ saveState: "saved" });
    expect(container.textContent).toContain("正在保存");
    expect(
      container
        .querySelector(".status-bar__save")
        ?.classList.contains("is-visible"),
    ).toBe(false);
    act(() => vi.advanceTimersByTime(160));
    expect(container.textContent).not.toContain("正在保存");
    expect(container.querySelector(".status-bar")).not.toBeNull();
    act(() => vi.advanceTimersByTime(239));
    expect(container.querySelector(".status-bar")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".status-bar")).toBeNull();
  });

  it("shows a save failure immediately and cancels delayed progress", () => {
    renderStatusBar({ saveState: "saving" });

    renderStatusBar({
      saveError: "浏览器存储不可写",
      saveState: "error",
    });
    expect(container.textContent).toContain("保存失败 · 重试");
    expect(container.querySelector(".status-bar__error-icon")).not.toBeNull();

    act(() => vi.advanceTimersByTime(1200));
    expect(container.querySelector(".status-bar__spinner")).toBeNull();
    expect(container.textContent).toContain("保存失败 · 重试");
  });

  it("fades a notice before collapsing and removing its frame", () => {
    const sharedProps: React.ComponentProps<typeof StatusBar> = {
      notice: { message: "已复制整张图为 Markdown" },
      onNoticeActionComplete: vi.fn(),
      onPauseNotice: vi.fn(),
      onResumeNotice: vi.fn(),
      onRetrySave: vi.fn(),
      saveError: null,
      saveState: "saved",
    };
    act(() => root.render(<StatusBar {...sharedProps} />));
    finishEntrance();

    const statusBar = container.querySelector<HTMLElement>(".status-bar")!;
    const noticeContent = container.querySelector<HTMLElement>(
      ".status-bar__notice",
    )!;
    expect(statusBar.classList.contains("is-expanded")).toBe(true);
    expect(noticeContent.classList.contains("is-visible")).toBe(true);

    act(() =>
      root.render(<StatusBar {...sharedProps} notice={null} />),
    );
    expect(noticeContent.classList.contains("is-visible")).toBe(false);
    expect(statusBar.classList.contains("is-expanded")).toBe(true);

    act(() => vi.advanceTimersByTime(159));
    expect(container.textContent).toContain("已复制整张图为 Markdown");
    act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).not.toContain("已复制整张图为 Markdown");
    expect(statusBar.classList.contains("is-expanded")).toBe(false);
    expect(statusBar.style.width).toBe("38px");

    act(() => vi.advanceTimersByTime(239));
    expect(container.querySelector(".status-bar")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".status-bar")).toBeNull();
  });

  it("keeps a new notice visible when it replaces one during its exit", () => {
    const sharedProps: React.ComponentProps<typeof StatusBar> = {
      notice: { message: "已复制节点" },
      onNoticeActionComplete: vi.fn(),
      onPauseNotice: vi.fn(),
      onResumeNotice: vi.fn(),
      onRetrySave: vi.fn(),
      saveError: null,
      saveState: "saved",
    };
    act(() => root.render(<StatusBar {...sharedProps} />));
    finishEntrance();

    act(() =>
      root.render(<StatusBar {...sharedProps} notice={null} />),
    );
    act(() =>
      root.render(
        <StatusBar
          {...sharedProps}
          notice={{
            message: "已保存在此浏览器，可在‘更多’中导出完整备份",
          }}
        />,
      ),
    );
    finishEntrance();
    act(() => vi.advanceTimersByTime(400));

    expect(container.textContent).not.toContain("已复制节点");
    expect(container.textContent).toContain("已保存在此浏览器");
    expect(
      container
        .querySelector(".status-bar__notice")
        ?.classList.contains("is-visible"),
    ).toBe(true);
    expect(
      container.querySelector(".status-bar")?.classList.contains("is-expanded"),
    ).toBe(true);
  });

  it("keeps save failure retryable after a transient notice disappears", () => {
    const onRetrySave = vi.fn();
    renderStatusBar({
      saveError: "磁盘暂时不可写",
      saveState: "error",
      notice: { message: "无法完成刚才的操作" },
      onRetrySave,
    });
    finishEntrance();

    renderStatusBar({
      saveError: "磁盘暂时不可写",
      saveState: "error",
      notice: null,
      onRetrySave,
    });
    act(() => vi.advanceTimersByTime(160));

    const retry = container.querySelector<HTMLButtonElement>(
      ".status-bar__save--error",
    );
    expect(retry?.textContent).toBe("保存失败 · 重试");
    expect(retry?.title).toBe("磁盘暂时不可写");
    expect(
      container.querySelector(".status-bar")?.classList.contains("is-expanded"),
    ).toBe(true);
    expect(container.textContent).not.toContain("无法完成刚才的操作");

    act(() => retry?.click());
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("keeps conflict resolution visible after its notice disappears", () => {
    const onResolve = vi.fn();
    renderStatusBar({
      saveError: "另一个标签页已有更新",
      saveErrorActionLabel: "保留为副本",
      saveState: "error",
      onRetrySave: onResolve,
    });

    const resolve = container.querySelector<HTMLButtonElement>(
      ".status-bar__save--error",
    )!;
    expect(resolve.textContent).toBe("保存失败 · 保留为副本");
    expect(resolve.getAttribute("aria-label")).toBe(
      "保存失败，保留为副本",
    );
    act(() => resolve.click());
    expect(onResolve).toHaveBeenCalledOnce();
  });
});
