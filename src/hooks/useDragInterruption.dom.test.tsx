// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  releaseOwnedPointerCapture,
  useDragInterruption,
} from "./useDragInterruption";
import { useKeyboardCommands } from "./useKeyboardCommands";

function Harness({
  active,
  onCancel,
}: {
  active: boolean;
  onCancel: () => void;
}) {
  useDragInterruption({ hasActiveDrag: () => active, onCancel });
  return null;
}

function KeyboardCommandsHarness({
  onCommand,
}: {
  onCommand: (id: string) => void;
}) {
  useKeyboardCommands({
    enabled: true,
    selectionEnabled: true,
    commandTarget: "mind-node",
    onCommand,
    onBeginTyping: () => undefined,
    onPasteText: () => undefined,
  });
  return null;
}

describe("shared drag interruption lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("ignores inactive Escape and cancels every supported host interruption", async () => {
    const onCancel = vi.fn();
    await act(async () => root.render(<Harness active={false} onCancel={onCancel} />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => root.render(<Harness active onCancel={onCancel} />));
    const escape = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Escape",
    });
    window.dispatchEvent(escape);
    window.dispatchEvent(new Event("blur"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(escape.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it("keeps Escape owned by an active drag even when the drag listener mounted later", async () => {
    const onCommand = vi.fn();
    const onCancel = vi.fn();
    const keyboardContainer = document.createElement("div");
    const dragContainer = document.createElement("div");
    document.body.append(keyboardContainer, dragContainer);
    const keyboardRoot = createRoot(keyboardContainer);
    const dragRoot = createRoot(dragContainer);
    try {
      // Keyboard commands register first; the drag interruption mounts in a
      // second root afterwards, mirroring a subspace portal that appears
      // after the keyboard listener's last re-registration. Registration
      // order must not decide who wins Escape.
      await act(async () =>
        keyboardRoot.render(
          <KeyboardCommandsHarness onCommand={onCommand} />,
        ),
      );
      await act(async () =>
        dragRoot.render(<Harness active onCancel={onCancel} />),
      );

      window.dispatchEvent(
        new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }),
      );

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCommand).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        keyboardRoot.unmount();
        dragRoot.unmount();
      });
      keyboardContainer.remove();
      dragContainer.remove();
    }
  });

  it("cancels every active direct-manipulation owner with one Escape", async () => {
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    const secondContainer = document.createElement("div");
    document.body.append(secondContainer);
    const secondRoot = createRoot(secondContainer);
    try {
      await act(async () => root.render(
        <Harness active onCancel={firstCancel} />,
      ));
      await act(async () => secondRoot.render(
        <Harness active onCancel={secondCancel} />,
      ));

      window.dispatchEvent(
        new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }),
      );

      expect(firstCancel).toHaveBeenCalledOnce();
      expect(secondCancel).toHaveBeenCalledOnce();
    } finally {
      await act(async () => secondRoot.unmount());
      secondContainer.remove();
    }
  });

  it("releases capture only when the gesture still owns it", () => {
    const element = document.createElement("div");
    const hasPointerCapture = vi
      .fn<(pointerId: number) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const releasePointerCapture = vi.fn<(pointerId: number) => void>();
    Object.defineProperties(element, {
      hasPointerCapture: { configurable: true, value: hasPointerCapture },
      releasePointerCapture: {
        configurable: true,
        value: releasePointerCapture,
      },
    });

    releaseOwnedPointerCapture(element, 7);
    releaseOwnedPointerCapture(element, 7);

    expect(hasPointerCapture).toHaveBeenCalledTimes(2);
    expect(releasePointerCapture).toHaveBeenCalledOnce();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });
});
