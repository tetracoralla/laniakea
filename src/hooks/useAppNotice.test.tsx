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

  it("keeps a recovery decision visible until it is explicitly dismissed", async () => {
    function Harness() {
      const { announcement, notify, dismiss } = useAppNotice();
      return (
        <>
          <output>{announcement?.message ?? ""}</output>
          <button onClick={() => notify({
            message: "已恢复上次中断前的内容",
            persistent: true,
          })}>恢复</button>
          <button onClick={dismiss}>关闭</button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelectorAll("button")[0].click();
      vi.advanceTimersByTime(60_000);
    });
    expect(container.querySelector("output")?.textContent).toContain("已恢复");

    await act(async () => container.querySelectorAll("button")[1].click());
    expect(container.querySelector("output")?.textContent).toBe("");
  });

  it("restores a persistent decision bar after a transient notice fades", async () => {
    function Harness() {
      const { announcement, notify } = useAppNotice();
      return (
        <>
          <output>{announcement?.message ?? ""}</output>
          <button onClick={() => notify({
            message: "已恢复上次中断前的内容",
            persistent: true,
          })}>恢复</button>
          <button onClick={() => notify({ message: "已保存" })}>保存</button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelectorAll("button")[0].click());
    expect(container.querySelector("output")?.textContent).toContain("已恢复");

    await act(async () => {
      container.querySelectorAll("button")[1].click();
      vi.advanceTimersByTime(100);
    });
    expect(container.querySelector("output")?.textContent).toBe("已保存");

    await act(async () => vi.advanceTimersByTime(3600));
    expect(container.querySelector("output")?.textContent).toContain("已恢复");
  });

  it("clearPersistentNotice retires a resolved decision without touching transients", async () => {
    function Harness() {
      const { announcement, notify, clearPersistentNotice } = useAppNotice();
      return (
        <>
          <output>{announcement?.message ?? ""}</output>
          <button onClick={() => notify({
            message: "已恢复上次中断前的内容",
            persistent: true,
          })}>恢复</button>
          <button onClick={() => notify({ message: "已保存" })}>保存</button>
          <button onClick={clearPersistentNotice}>提交完成</button>
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelectorAll("button")[0].click());
    await act(async () => {
      container.querySelectorAll("button")[1].click();
      vi.advanceTimersByTime(100);
    });
    expect(container.querySelector("output")?.textContent).toBe("已保存");

    await act(async () => container.querySelectorAll("button")[2].click());
    expect(container.querySelector("output")?.textContent).toBe("已保存");

    await act(async () => vi.advanceTimersByTime(3600));
    expect(container.querySelector("output")?.textContent).toBe("");
  });
});
