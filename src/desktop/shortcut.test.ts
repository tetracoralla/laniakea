import { describe, expect, it } from "vitest";
import {
  displayGlobalShortcut,
  shortcutFromKeyboardEvent,
} from "./shortcut";

describe("desktop global shortcut recording", () => {
  it("records a macOS command combination in Tauri syntax", () => {
    expect(
      shortcutFromKeyboardEvent({
        altKey: false,
        code: "KeyJ",
        ctrlKey: false,
        key: "j",
        metaKey: true,
        shiftKey: true,
      }),
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
      }),
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
      }),
    ).toBe("CommandOrControl+Control+K");
  });
});
