// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "../components/feedback/StatusBar";
import type { AppNotice } from "../types/feedback";
import type { SaveState } from "../types/mindmap";
import { useAppNotice } from "./useAppNotice";
import { useBrowserStorageNotice } from "./useBrowserStorageNotice";

interface HarnessProps {
  announcement: AppNotice | null;
  desktopRuntime?: boolean;
  notify: (notice: AppNotice) => void;
  saveState: SaveState;
}

function Harness({
  announcement,
  desktopRuntime = false,
  notify,
  saveState,
}: HarnessProps) {
  useBrowserStorageNotice({
    announcement,
    desktopRuntime,
    notify,
    saveState,
  });
  return null;
}

function IntegratedHarness({ saveState }: { saveState: SaveState }) {
  const {
    announcement,
    dismiss,
    notify,
    pause,
    resume,
  } = useAppNotice();
  useBrowserStorageNotice({
    announcement,
    desktopRuntime: false,
    notify,
    saveState,
  });

  return (
    <>
      <button
        onClick={() => notify({ message: "已复制整张图为 Markdown" })}
        type="button"
      >
        复制
      </button>
      <StatusBar
        notice={announcement}
        onNoticeActionComplete={dismiss}
        onPauseNotice={pause}
        onResumeNotice={resume}
        onRetrySave={vi.fn()}
        saveError={null}
        saveState={saveState}
      />
    </>
  );
}

describe("useBrowserStorageNotice", () => {
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
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(props: HarnessProps) {
    act(() => root.render(<Harness {...props} />));
  }

  it("defers the first-save reminder until an operation notice is gone", () => {
    const notify = vi.fn();
    const operationNotice = { message: "已粘贴 3 个节点" };

    render({ announcement: null, notify, saveState: "saved" });
    render({ announcement: operationNotice, notify, saveState: "saving" });
    render({ announcement: operationNotice, notify, saveState: "saved" });

    expect(notify).not.toHaveBeenCalled();

    render({ announcement: null, notify, saveState: "saved" });

    expect(notify).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(259));
    expect(notify).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      message: "已保存在此浏览器，可在“更多”中导出完整备份",
    });
    expect(
      window.localStorage.getItem("laniakea:browser-storage-notice-seen"),
    ).toBeNull();

    const storageNotice = notify.mock.calls[0][0];
    render({ announcement: storageNotice, notify, saveState: "saved" });
    render({ announcement: null, notify, saveState: "saved" });
    expect(
      window.localStorage.getItem("laniakea:browser-storage-notice-seen"),
    ).toBe("true");
  });

  it("shows the reminder immediately when saving finishes without another notice", () => {
    const notify = vi.fn();

    render({ announcement: null, notify, saveState: "saved" });
    render({ announcement: null, notify, saveState: "saving" });
    render({ announcement: null, notify, saveState: "saved" });

    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not duplicate a reminder when another save finishes during handoff", () => {
    const notify = vi.fn();
    const operationNotice = { message: "已粘贴 3 个节点" };

    render({ announcement: operationNotice, notify, saveState: "saving" });
    render({ announcement: operationNotice, notify, saveState: "saved" });
    render({ announcement: null, notify, saveState: "saved" });
    render({ announcement: null, notify, saveState: "saving" });
    render({ announcement: null, notify, saveState: "saved" });

    act(() => vi.advanceTimersByTime(260));
    expect(notify).toHaveBeenCalledOnce();
  });

  it("requeues the reminder when another notice replaces it", () => {
    const notify = vi.fn();

    render({ announcement: null, notify, saveState: "saving" });
    render({ announcement: null, notify, saveState: "saved" });
    const firstStorageNotice = notify.mock.calls[0][0];

    render({
      announcement: firstStorageNotice,
      notify,
      saveState: "saved",
    });
    render({
      announcement: { message: "已复制整张图为 Markdown" },
      notify,
      saveState: "saved",
    });
    render({ announcement: null, notify, saveState: "saved" });

    expect(notify).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(260));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(
      window.localStorage.getItem("laniakea:browser-storage-notice-seen"),
    ).toBeNull();

    const secondStorageNotice = notify.mock.calls[1][0];
    render({
      announcement: secondStorageNotice,
      notify,
      saveState: "saved",
    });
    render({ announcement: null, notify, saveState: "saved" });
    expect(
      window.localStorage.getItem("laniakea:browser-storage-notice-seen"),
    ).toBe("true");
  });

  it("does not repeat a remembered reminder or show it on desktop", () => {
    const notify = vi.fn();
    window.localStorage.setItem(
      "laniakea:browser-storage-notice-seen",
      "true",
    );

    render({ announcement: null, notify, saveState: "saving" });
    render({ announcement: null, notify, saveState: "saved" });
    expect(notify).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    window.localStorage.clear();
    render({
      announcement: null,
      desktopRuntime: true,
      notify,
      saveState: "saving",
    });
    render({
      announcement: null,
      desktopRuntime: true,
      notify,
      saveState: "saved",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("shows the deferred storage reminder after an overriding notice expires", () => {
    act(() =>
      root.render(
        <StrictMode>
          <IntegratedHarness saveState="saving" />
        </StrictMode>,
      ),
    );
    act(() =>
      root.render(
        <StrictMode>
          <IntegratedHarness saveState="saved" />
        </StrictMode>,
      ),
    );
    act(() => vi.advanceTimersByTime(16));
    expect(container.textContent).toContain("已保存在此浏览器");

    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    act(() => vi.advanceTimersByTime(16));
    expect(container.textContent).toContain("已复制整张图为 Markdown");

    act(() => vi.advanceTimersByTime(3600));
    act(() => vi.advanceTimersByTime(259));
    expect(container.textContent).not.toContain("已保存在此浏览器");
    act(() => vi.advanceTimersByTime(1));
    act(() => vi.advanceTimersByTime(16));

    expect(container.textContent).toContain("已保存在此浏览器");
    expect(
      container
        .querySelector(".status-bar__notice")
        ?.classList.contains("is-visible"),
    ).toBe(true);
  });
});
