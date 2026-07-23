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
    code: options.code ?? "",
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

  it("matches shifted digit viewport shortcuts by physical key", () => {
    expect(
      findCommandForEvent(
        keyboardEvent("!", { shiftKey: true, code: "Digit1" }),
        "selection",
      )?.id,
    ).toBe("viewport.fit");
    expect(
      findCommandForEvent(
        keyboardEvent("@", { shiftKey: true, code: "Digit2" }),
        "selection",
      )?.id,
    ).toBe("viewport.focus");
  });

  it("matches Command-plus without treating Shift as a separate command", () => {
    expect(
      findCommandForEvent(
        keyboardEvent("+", {
          shiftKey: true,
          metaKey: true,
          code: "Equal",
        }),
        "selection",
      )?.id,
    ).toBe("viewport.zoom-in");
  });

  it("supports both macOS delete key events", () => {
    expect(
      findCommandForEvent(keyboardEvent("Backspace"), "selection")?.id,
    ).toBe("node.delete");
    expect(findCommandForEvent(keyboardEvent("Delete"), "selection")?.id).toBe(
      "node.delete",
    );
  });

  it("keeps multi-selection shortcuts in selection context", () => {
    expect(
      findCommandForEvent(
        keyboardEvent("ArrowDown", { shiftKey: true }),
        "selection",
      )?.id,
    ).toBe("selection.extend-next");
    expect(
      findCommandForEvent(
        keyboardEvent("a", { metaKey: true }),
        "selection",
      )?.id,
    ).toBe("selection.select-all");
    expect(
      findCommandForEvent(keyboardEvent("Escape"), "selection")?.id,
    ).toBe("selection.clear");
  });

  it("starts editing only for unmodified printable keys", () => {
    expect(isPrintableKey(keyboardEvent("思"))).toBe(true);
    expect(isPrintableKey(keyboardEvent("c", { metaKey: true }))).toBe(false);
    expect(isPrintableKey(keyboardEvent("ArrowRight"))).toBe(false);
  });
});
