import { describe, expect, it } from "vitest";
import {
  moveOverlayIndex,
  overlayItemLimit,
} from "./CommandOverlay";

describe("command overlay visible selection", () => {
  it("never advances the keyboard index beyond rendered results", () => {
    let index = 0;
    for (let step = 0; step < 30; step += 1) {
      index = moveOverlayIndex(index, 1, overlayItemLimit);
    }
    expect(index).toBe(overlayItemLimit - 1);
  });

  it("keeps an empty result set at index zero", () => {
    expect(moveOverlayIndex(4, 1, 0)).toBe(0);
  });
});
