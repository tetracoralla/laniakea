import { describe, expect, it } from "vitest";
import {
  canvasZoomFromWheel,
  maxCanvasZoom,
  minCanvasZoom,
} from "./zoom";

describe("canvas zoom", () => {
  it("preserves fine trackpad deltas instead of turning them into fixed steps", () => {
    const next = canvasZoomFromWheel(1, 1, 0, 900);

    expect(next).toBeCloseTo(0.997692, 6);
    expect(1 - next).toBeLessThan(0.003);
  });

  it("covers a useful zoom range during one continuous trackpad gesture", () => {
    let zoom = 1;

    for (let index = 0; index < 5; index += 1) {
      zoom = canvasZoomFromWheel(zoom, 24, 0, 900);
    }

    expect(zoom).toBeCloseTo(0.757858, 6);
  });

  it("keeps equal opposite deltas continuous and reversible", () => {
    const zoomedOut = canvasZoomFromWheel(1, 12, 0, 900);
    const restored = canvasZoomFromWheel(zoomedOut, -12, 0, 900);

    expect(restored).toBeCloseTo(1, 10);
  });

  it("normalizes mouse line deltas and caps a single unusually large event", () => {
    expect(canvasZoomFromWheel(1, 3, 1, 900)).toBeCloseTo(
      canvasZoomFromWheel(1, 48, 0, 900),
      10,
    );
    expect(canvasZoomFromWheel(1, 100, 0, 900)).toBeCloseTo(
      canvasZoomFromWheel(1, 60, 0, 900),
      10,
    );
  });

  it("keeps zoom inside the supported range", () => {
    expect(canvasZoomFromWheel(minCanvasZoom, 40, 0, 900)).toBe(
      minCanvasZoom,
    );
    expect(canvasZoomFromWheel(maxCanvasZoom, -40, 0, 900)).toBe(
      maxCanvasZoom,
    );
  });
});
