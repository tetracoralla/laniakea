import { describe, expect, it } from "vitest";
import { ignoresSpaceShortcut } from "./useCanvasGestures";

function fakeTarget(options: {
  input?: boolean;
  button?: boolean;
  canvas?: boolean;
  dialog?: boolean;
}): EventTarget {
  return {
    matches: (selector: string) =>
      (options.input && selector.includes("input")) ||
      (options.button && selector.includes("button")),
    closest: (selector: string) => {
      if (options.dialog && selector.includes("[role='dialog']")) return {};
      if (options.canvas && selector.includes(".mindmap-canvas")) return {};
      if (options.button && selector.includes("button")) return {};
      return null;
    },
  } as unknown as EventTarget;
}

describe("canvas Space shortcut target isolation", () => {
  it("leaves Space activation to toolbar buttons", () => {
    expect(ignoresSpaceShortcut(fakeTarget({ button: true }))).toBe(true);
  });

  it("keeps Space-to-edit on node buttons inside the canvas", () => {
    expect(
      ignoresSpaceShortcut(fakeTarget({ button: true, canvas: true })),
    ).toBe(false);
  });

  it("never handles text fields or dialog controls", () => {
    expect(ignoresSpaceShortcut(fakeTarget({ input: true }))).toBe(true);
    expect(ignoresSpaceShortcut(fakeTarget({ dialog: true }))).toBe(true);
  });
});
