import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  unlistenWindow: vi.fn(),
  onFocusChanged: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: mocks.onFocusChanged,
  }),
}));

import {
  applicationExitRequestedEvent,
  listenForApplicationExit,
  listenForWindowFocusChange,
  resolveApplicationExit,
} from "./applicationLifecycle";

describe("desktop application lifecycle bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
    mocks.listen.mockReset();
    mocks.unlisten.mockReset();
    mocks.unlistenWindow.mockReset();
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.onFocusChanged.mockReset();
    mocks.onFocusChanged.mockResolvedValue(mocks.unlistenWindow);
  });

  it("registers the listener before declaring the frontend ready", async () => {
    const handler = vi.fn();

    const unlisten = await listenForApplicationExit(handler);

    expect(mocks.listen).toHaveBeenCalledWith(
      applicationExitRequestedEvent,
      handler,
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "register_application_exit_listener",
    );
    expect(unlisten).toBe(mocks.unlisten);
  });

  it("reports whether the pending save allows or cancels the exit", async () => {
    await resolveApplicationExit(false);
    await resolveApplicationExit(true);

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "resolve_application_exit",
      { saved: false },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "resolve_application_exit",
      { saved: true },
    );
  });

  it("projects native window focus changes into a boolean callback", async () => {
    const handler = vi.fn();

    const unlisten = await listenForWindowFocusChange(handler);
    const webviewHandler = mocks.onFocusChanged.mock.calls[0][0];
    webviewHandler({ payload: false });
    webviewHandler({ payload: true });

    expect(handler).toHaveBeenNthCalledWith(1, false);
    expect(handler).toHaveBeenNthCalledWith(2, true);
    unlisten();
    expect(mocks.unlistenWindow).toHaveBeenCalledOnce();
  });
});
