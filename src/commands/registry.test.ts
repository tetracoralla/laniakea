import { describe, expect, it } from "vitest";
import { findCommandForEvent, isPrintableKey } from "./registry";

function keyboardEvent(
  key: string,
  options: KeyboardEventInit = {},
): KeyboardEvent {
  return {
    key,
    shiftKey: Boolean(options.shiftKey),
    altKey: Boolean(options.altKey),
    metaKey: Boolean(options.metaKey),
    ctrlKey: Boolean(options.ctrlKey),
  } as KeyboardEvent;
}

describe("command registry context isolation", () => {
  it("routes Enter to structure creation only in selection context", () => {
    const event = keyboardEvent("Enter");
    expect(findCommandForEvent(event, "selection")?.id).toBe(
      "node.create-sibling",
    );
    expect(findCommandForEvent(event, "editing")).toBeUndefined();
  });

  it("keeps Shift+Enter distinct from Enter", () => {
    const event = keyboardEvent("Enter", { shiftKey: true });
    expect(findCommandForEvent(event, "selection")?.id).toBe(
      "node.create-above",
    );
  });

  it("normalizes macOS command shortcuts", () => {
    const event = keyboardEvent("k", { metaKey: true });
    expect(findCommandForEvent(event, "selection")?.id).toBe(
      "map.command-palette",
    );
  });

  it("supports both macOS delete key events", () => {
    expect(
      findCommandForEvent(keyboardEvent("Backspace"), "selection")?.id,
    ).toBe("node.delete");
    expect(findCommandForEvent(keyboardEvent("Delete"), "selection")?.id).toBe(
      "node.delete",
    );
  });

  it("starts editing only for unmodified printable keys", () => {
    expect(isPrintableKey(keyboardEvent("思"))).toBe(true);
    expect(isPrintableKey(keyboardEvent("c", { metaKey: true }))).toBe(false);
    expect(isPrintableKey(keyboardEvent("ArrowRight"))).toBe(false);
  });
});
