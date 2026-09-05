// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetryableLazySection } from "./RetryableLazySection";

describe("createRetryableLazySection", () => {
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

  it("rebuilds React.lazy after a preloaded request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let attempts = 0;
    let rejectFirst: ((error: Error) => void) | undefined;
    const section = createRetryableLazySection(
      () => {
        attempts += 1;
        if (attempts === 1) {
          return new Promise((_, reject) => {
            rejectFirst = reject;
          });
        }
        return Promise.resolve({ default: () => <div>已打开</div> });
      },
      {
        errorLabel: "无法打开",
        loadingFallback: <div role="status">正在打开</div>,
      },
    );
    section.preload();

    await act(async () => root.render(<section.Component />));
    expect(container.querySelector("[role='status']")).not.toBeNull();
    await act(async () => {
      rejectFirst?.(new Error("transient chunk failure"));
      await Promise.resolve();
    });
    expect(container.querySelector("[role='alert']")?.textContent)
      .toContain("无法打开");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[role='alert'] button")!.click();
      await Promise.resolve();
    });

    expect(attempts).toBe(2);
    expect(container.textContent).toContain("已打开");
  });
});
