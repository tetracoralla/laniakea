// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useFlowEdgeLabelDrag } from "./useFlowEdgeLabelDrag";

it("captures a fast label drag on its own button and commits exactly once without recapturing on release", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  function Harness() {
    const drag = useFlowEdgeLabelDrag("space", 2, onChange);
    return <button onPointerDown={(event) => drag.begin("edge", { x: 10, y: 20 }, event)}
      onPointerMove={drag.pointerMove} onPointerUp={drag.pointerUp}
      onLostPointerCapture={drag.cancel}>Text</button>;
  }
  await act(async () => root.render(<Harness />));
  const button = container.querySelector("button")!;
  const capture = vi.fn();
  button.setPointerCapture = capture;
  button.hasPointerCapture = () => true;
  button.releasePointerCapture = vi.fn();
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 7 });
    button.dispatchEvent(event);
  };
  try {
    await act(async () => pointer("pointerdown", 100, 100));
    expect(capture).toHaveBeenCalledExactlyOnceWith(7);
    // A frame or intermediate move need not arrive before pointer-up.
    await act(async () => pointer("pointerup", 300, 200));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("edge", { x: 110, y: 70 });
    await act(async () => { pointer("pointerdown", 100, 100); pointer("pointerup", 100, 100); });
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
