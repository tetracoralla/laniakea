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

function FlowViewportHarness({ includePalette = false }: { includePalette?: boolean }) {
  const controller = useFlowViewport({
    layout,
    onCanvasPointerDown: () => undefined,
    onViewportChange: handlers.onViewportChange,
    selectedId: "step-1",
    viewport,
  });
  return (
    <>
      <div
        className="flow-canvas"
        onLostPointerCapture={controller.bindings.onLostPointerCapture}
        onPointerCancel={controller.bindings.onPointerCancel}
        onPointerDown={controller.bindings.onPointerDown}
        onPointerMove={controller.bindings.onPointerMove}
        onPointerUp={controller.bindings.onPointerUp}
        ref={controller.containerRef}
      >
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
