// @vitest-environment jsdom

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowShapePalette } from "../components/canvas/FlowShapePalette";
import type { FlowLayoutResult } from "../model/flowLayout";
import type { Viewport } from "../types/mindmap";
import { useFlowKeyboardCommands } from "./useFlowKeyboardCommands";
import { useFlowAutoPan } from "./useFlowAutoPan";
import { useFlowViewport } from "./useFlowViewport";

const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
const layout = {
  height: 400,
  minX: 0,
  minY: 0,
  nodes: {
    "step-1": { height: 44, width: 120, x: 80, y: 80 },
  },
  width: 600,
} as unknown as FlowLayoutResult;

function FlowKeyboardHarness({ children }: { children: ReactNode }) {
  useFlowKeyboardCommands({
    enabled: true,
    selectedId: "step-1",
    onAddNext: () => undefined,
    onAddBranch: () => undefined,
    onBeginEdit: () => undefined,
    onDelete: () => undefined,
    onNavigate: () => undefined,
    onBack: handlers.onBack,
    onUndo: () => undefined,
    onRedo: () => undefined,
  });
  return children;
}

function FlowViewportHarness({ includePalette = false, layoutOverride = layout }: {
  includePalette?: boolean;
  layoutOverride?: FlowLayoutResult;
}) {
  const controller = useFlowViewport({
    layout: layoutOverride,
    onCanvasPointerDown: () => undefined,
    onViewportChange: handlers.onViewportChange,
    selectedId: "step-1",
    viewport,
  });
  return (
    <>
      <button onClick={controller.fit}>Fit content</button>
      <button onClick={() => controller.revealEditor(controller.contentRef.current!)}>
        Reveal editor
      </button>
      <div
        className="flow-canvas"
        onLostPointerCapture={controller.bindings.onLostPointerCapture}
        onPointerCancel={controller.bindings.onPointerCancel}
        onPointerDown={controller.bindings.onPointerDown}
        onPointerMove={controller.bindings.onPointerMove}
        onPointerUp={controller.bindings.onPointerUp}
        ref={controller.containerRef}
      >
        <div className="canvas-pan-surface" ref={controller.panSurfaceRef} />
        <div
          className="flow-canvas__content"
          ref={controller.contentRef}
          style={{ transform: "translate3d(0px, 0px, 0) scale(1)" }}
        />
      </div>
      {includePalette && (
        <FlowShapePalette
          onDrop={() => undefined}
          onInsert={() => undefined}
        />
      )}
    </>
  );
}

function AutoPanHarness() {
  const containerRef = { current: document.createElement("div") };
  const autoPan = useFlowAutoPan(containerRef);
  useEffect(() => {
    autoPan.update(1, 1, handlers.onAutoPan);
  }, [autoPan.update]);
  return null;
}

function makeHandlers() {
  return {
    onAutoPan: vi.fn(),
    onBack: vi.fn(),
    onViewportChange: vi.fn(),
  };
}

let handlers = makeHandlers();

describe("flow viewport interruption", () => {
  let container: HTMLDivElement;
  let root: Root;
  let animationFrames: FrameRequestCallback[];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    handlers = makeHandlers();
    animationFrames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: {
        configurable: true,
        value: vi.fn(() => true),
      },
      releasePointerCapture: {
        configurable: true,
        value: vi.fn(),
      },
      setPointerCapture: {
        configurable: true,
        value: vi.fn(),
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps a five-step flow readable when Fit is clicked instead of fitting render padding", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
      width: 1280, height: 720, toJSON: () => ({}),
    });
    // The observed five-node graph occupies 464 by 514 pixels and its render
    // surface adds 140 pixels around each side. Only actual content must fit.
    const fiveStepLayout = { ...layout, width: 744, height: 794 };
    await act(async () => root.render(<FlowViewportHarness layoutOverride={fiveStepLayout} />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(handlers.onViewportChange).toHaveBeenLastCalledWith({ zoom: 1, x: 268, y: -37 });
  });

  it("cancels a Flow canvas pan before Escape can return to the parent", async () => {
    await act(async () => root.render(
      <FlowKeyboardHarness>
        <FlowViewportHarness />
      </FlowKeyboardHarness>,
    ));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 11,
      }));
    });

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    })));

    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(11);

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    })));
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  it("coalesces pan samples into one paint and commits the release position with a stable cursor", async () => {
    await act(async () => root.render(<FlowViewportHarness />));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    const content = container.querySelector<HTMLElement>(".flow-canvas__content")!;
    const surface = container.querySelector<HTMLElement>(".canvas-pan-surface")!;
    await act(async () => canvas.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " })));
    expect(surface.dataset.panCursor).toBe("grab");
    await act(async () => {
      surface.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, button: 0, pointerId: 1, clientX: 100, clientY: 100,
      }));
      for (let index = 1; index <= 20; index += 1) {
        canvas.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, pointerId: 1, clientX: 100 + index, clientY: 100 + index,
        }));
      }
    });
    expect(surface.dataset.panCursor).toBe("grabbing");
    expect(content.style.transform).toContain("translate3d(0px, 0px");
    expect(animationFrames).toHaveLength(1);
    await act(async () => animationFrames.splice(0).forEach((frame) => frame(16)));
    expect(content.style.transform).toContain("translate3d(20px, 20px");
    await act(async () => {
      canvas.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
    });
    expect(surface.dataset.panCursor).toBe("grabbing");
    await act(async () => {
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, pointerId: 1, clientX: 130, clientY: 135,
      }));
    });
    expect(surface.dataset.panCursor).toBeUndefined();
    expect(content.style.transform).toContain("translate3d(30px, 35px");
    expect(handlers.onViewportChange).toHaveBeenLastCalledWith({ x: 30, y: 35, zoom: 1 });
  });

  it("measures editor reveal in the latest coalesced wheel position, not the last paint", async () => {
    await act(async () => root.render(<FlowViewportHarness />));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    const content = container.querySelector<HTMLElement>(".flow-canvas__content")!;
    await act(async () => {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
        ctrlKey: true,
        deltaY: 100,
      }));
    });
    // The zoomed viewport is committed live but still waits for its frame.
    expect(content.style.transform).toContain("scale(1)");
    expect(handlers.onViewportChange).not.toHaveBeenCalled();
    const revealButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reveal editor",
    )!;
    await act(async () => revealButton.click());
    // Revealing measured the editor after painting the pending zoom, so the
    // painted transform already reflects the wheel sample.
    expect(content.style.transform).toContain("scale(0.81225239635");
  });

  it("clears a Flow canvas pan when pointer capture is lost", async () => {
    await act(async () => root.render(<FlowViewportHarness />));
    const canvas = container.querySelector<HTMLElement>(".flow-canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 21,
      }));
      canvas.dispatchEvent(new PointerEvent("lostpointercapture", {
        bubbles: true,
        pointerId: 21,
      }));
    });

    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(21);
    const escape = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Escape",
    });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("keeps the viewport fixed while a palette shape owns the pointer", async () => {
    await act(async () => root.render(<FlowViewportHarness includePalette />));
    const shape = container.querySelector<HTMLElement>(
      ".flow-shape-palette__item",
    )!;
    const content = container.querySelector<HTMLElement>(
      ".flow-canvas__content",
    )!;
    await act(async () => shape.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 12,
    })));
    const before = content.style.transform;

    await act(async () => container.querySelector<HTMLElement>(".flow-canvas")!
      .dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
      })));

    expect(content.style.transform).toBe(before);
  });

  it("stops edge auto-pan when host interruption cancels the gesture", async () => {
    await act(async () => root.render(<AutoPanHarness />));
    expect(animationFrames).toHaveLength(1);

    const escape = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Escape",
    });
    await act(async () => window.dispatchEvent(escape));
    animationFrames.splice(0).forEach((callback) => callback(16));

    expect(escape.defaultPrevented).toBe(true);
    expect(handlers.onAutoPan).not.toHaveBeenCalled();
  });
});
