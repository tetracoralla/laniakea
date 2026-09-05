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

  it("rejects an unmodified key", () => {
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
  });

  it.each([
    ["MacIntel", "macOS", "⌘⌥空格"],
    ["Win32", "Windows", "Ctrl+Alt+空格"],
    ["Linux x86_64", "Linux", "Ctrl+Alt+空格"],
  ])("formats the saved shortcut for %s", (platform, operatingSystem, expected) => {
    vi.stubGlobal("navigator", {
      platform,
      userAgentData: { platform: operatingSystem },
    });
    expect(displayGlobalShortcut("CommandOrControl+Alt+Space")).toBe(expected);
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
