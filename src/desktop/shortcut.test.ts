import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayGlobalShortcut,
  shortcutFromKeyboardEvent,
} from "./shortcut";

describe("desktop global shortcut recording", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records a macOS command combination in Tauri syntax", () => {
    expect(
      shortcutFromKeyboardEvent({
        altKey: false,
        code: "KeyJ",
        ctrlKey: false,
        key: "j",
        metaKey: true,
        shiftKey: true,
      }, true),
    ).toBe("CommandOrControl+Shift+J");
  });

  it("rejects an unmodified key and formats the saved shortcut", () => {
    expect(
      shortcutFromKeyboardEvent({
        altKey: false,
        code: "KeyM",
        ctrlKey: false,
        key: "m",
        metaKey: false,
        shiftKey: false,
      }, true),
    ).toBeNull();
    expect(
      displayGlobalShortcut("CommandOrControl+Alt+Space"),
    ).toBe("⌘⌥空格");
  });

  it("preserves an explicitly pressed Control modifier alongside Command", () => {
    expect(
      shortcutFromKeyboardEvent({
        altKey: false,
        code: "KeyK",
        ctrlKey: true,
        key: "k",
        metaKey: true,
        shiftKey: false,
      }, true),
    ).toBe("CommandOrControl+Control+K");
  });

  it("shows registry Meta shortcuts as Ctrl on Windows", () => {
    vi.stubGlobal("navigator", {
      platform: "Win32",
      userAgentData: { platform: "Windows" },
    });

    expect(displayGlobalShortcut("Meta+K")).toBe("Ctrl+K");
  });

  it("rejects Super combinations instead of recording a different Ctrl shortcut", () => {
    expect(
      shortcutFromKeyboardEvent({
        altKey: false,
        code: "KeyK",
        ctrlKey: false,
        key: "k",
        metaKey: true,
        shiftKey: false,
      }, false),
    ).toBeNull();
  });
});
