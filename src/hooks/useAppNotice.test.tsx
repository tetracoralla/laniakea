// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppNotice } from "./useAppNotice";

describe("useAppNotice", () => {
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

  it("resumes a hovered notice with only its remaining lifetime", async () => {
    function Harness() {
      const { announcement, notify, pause, resume } = useAppNotice();
      return (
        <>
          <output data-testid="notice">{announcement?.message ?? ""}</output>
          <button onClick={() => notify({ message: "已完成" })}>通知</button>
          <button onClick={pause}>暂停</button>
          <button onClick={resume}>继续</button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelectorAll("button")[0].click();
      vi.advanceTimersByTime(2000);
      container.querySelectorAll("button")[1].click();
      vi.advanceTimersByTime(5000);
    });
    expect(container.querySelector("output")?.textContent).toBe("已完成");

    await act(async () => {
      container.querySelectorAll("button")[2].click();
      vi.advanceTimersByTime(1599);
    });
    expect(container.querySelector("output")?.textContent).toBe("已完成");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector("output")?.textContent).toBe("");
  });
});
