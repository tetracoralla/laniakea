import { describe, expect, it } from "vitest";
import {
  isCanvasCommandTarget,
  isDialogTarget,
  isNativeTextEditingTarget,
  shouldRunGlobalCommand,
} from "./useKeyboardCommands";

function fakeTarget(options: {
  input?: boolean;
  textarea?: boolean;
  editable?: boolean;
  dialog?: boolean;
  canvas?: boolean;
  body?: boolean;
}): EventTarget {
  return {
    matches: (selector: string) =>
      (options.input && selector.includes("input")) ||
      (options.textarea && selector.includes("textarea")) ||
      (options.editable && selector.includes("contenteditable")) ||
      (options.body && selector.includes("body")),
    closest: (selector: string) =>
      (options.dialog && selector.includes("[role='dialog']")) ||
      (options.canvas && selector.includes(".mindmap-canvas"))
        ? ({} as Element)
        : null,
  } as unknown as EventTarget;
}

describe("keyboard command focus isolation", () => {
  it("leaves native select, copy, cut, and paste to text editors", () => {
    expect(isNativeTextEditingTarget(fakeTarget({ input: true }))).toBe(true);
    expect(isNativeTextEditingTarget(fakeTarget({ textarea: true }))).toBe(
      true,
    );
    expect(isNativeTextEditingTarget(fakeTarget({ editable: true }))).toBe(
      true,
    );
  });

  it("leaves keyboard handling inside overlays to the overlay", () => {
    expect(isDialogTarget(fakeTarget({ dialog: true }))).toBe(true);
  });

  it("routes structural commands only from the canvas or unfocused page", () => {
    expect(isCanvasCommandTarget(fakeTarget({ canvas: true }))).toBe(true);
    expect(isCanvasCommandTarget(fakeTarget({ body: true }))).toBe(true);
    expect(isCanvasCommandTarget(fakeTarget({}))).toBe(false);
    expect(isCanvasCommandTarget(null)).toBe(true);
  });

  it("keeps printable Shift shortcuts inside text editors", () => {
    expect(
      shouldRunGlobalCommand(
        { metaKey: false, ctrlKey: false },
        "viewport.fit",
        true,
      ),
    ).toBe(false);
    expect(
      shouldRunGlobalCommand(
        { metaKey: false, ctrlKey: false },
        "viewport.focus",
        true,
      ),
    ).toBe(false);
  });

  it("still allows command-modified app shortcuts while editing text", () => {
    expect(
      shouldRunGlobalCommand(
        { metaKey: true, ctrlKey: false },
        "map.search",
        true,
      ),
    ).toBe(true);
    expect(
      shouldRunGlobalCommand(
        { metaKey: true, ctrlKey: false },
        "history.undo",
        true,
      ),
    ).toBe(false);
  });
});
