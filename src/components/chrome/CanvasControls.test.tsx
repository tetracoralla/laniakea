// @vitest-environment jsdom

import { act, createRef, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasControls,
  type CanvasControlsHandle,
} from "./CanvasControls";

describe("CanvasControls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows zoom feedback briefly, including boundaries, then hides it", () => {
    const ref = createRef<CanvasControlsHandle>();
    act(() => {
      root.render(
        <CanvasControls
          onFit={vi.fn()}
          onReset={vi.fn()}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          ref={ref}
        />,
      );
    });
    expect(container.querySelector(".canvas-controls__feedback")).toBeNull();

    act(() => ref.current?.showZoom(0.52));
    let feedback = container.querySelector<HTMLOutputElement>(
      ".canvas-controls__feedback",
    )!;
    expect(feedback.textContent).toBe("52% · 最小");
    expect(feedback.getAttribute("aria-hidden")).toBe("false");
    expect(
      container
        .querySelector(".canvas-controls")
        ?.classList.contains("is-feedback-visible"),
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1500);
      ref.current?.showZoom(1);
    });
    expect(feedback.textContent).toBe("100%");
    act(() => vi.advanceTimersByTime(1599));
    expect(feedback.getAttribute("aria-hidden")).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(feedback.getAttribute("aria-hidden")).toBe("true");
    expect(
      container
        .querySelector(".canvas-controls")
        ?.classList.contains("is-feedback-visible"),
    ).toBe(false);
    act(() => vi.advanceTimersByTime(219));
    expect(container.querySelector(".canvas-controls__feedback")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".canvas-controls__feedback")).toBeNull();

    act(() => ref.current?.showZoom(1.8));
    feedback = container.querySelector<HTMLOutputElement>(
      ".canvas-controls__feedback",
    )!;
    expect(feedback.textContent).toBe("180% · 最大");
  });

  it("keeps coarse-pointer fallback actions wired to canvas commands", () => {
    const onFit = vi.fn();
    const onReset = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    act(() => {
      root.render(
        <CanvasControls
          onFit={onFit}
          onReset={onReset}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>("[aria-label='缩小']")
        ?.click();
      container
        .querySelector<HTMLButtonElement>("[aria-label='恢复 100%']")
        ?.click();
      container
        .querySelector<HTMLButtonElement>("[aria-label='放大']")
        ?.click();
      container
        .querySelector<HTMLButtonElement>("[aria-label='适应全部内容']")
        ?.click();
    });
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
  });

  it("does not rerender feedback while fine zoom stays at the same percentage", () => {
    const ref = createRef<CanvasControlsHandle>();
    let commits = 0;
    act(() => {
      root.render(
        <Profiler id="zoom-feedback" onRender={() => commits += 1}>
          <CanvasControls
            onFit={vi.fn()}
            onReset={vi.fn()}
            onZoomIn={vi.fn()}
            onZoomOut={vi.fn()}
            ref={ref}
          />
        </Profiler>,
      );
    });
    const initialCommits = commits;

    act(() => ref.current?.showZoom(0.901));
    expect(commits).toBe(initialCommits + 1);
    act(() => ref.current?.showZoom(0.904));
    expect(commits).toBe(initialCommits + 1);
    act(() => ref.current?.showZoom(0.906));
    expect(commits).toBe(initialCommits + 2);
  });
});
