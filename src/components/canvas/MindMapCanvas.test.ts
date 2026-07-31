import { describe, expect, it } from "vitest";
import {
  draftForNode,
  nodeIdsRequiredInDom,
} from "../../model/canvasRender";

describe("canvas edit draft isolation", () => {
  it("changes the draft prop for only the actively edited node", () => {
    const drafts = Array.from({ length: 500 }, (_, index) =>
      draftForNode(`node-${index}`, "node-217", "正在输入"),
    );

    expect(drafts.filter(Boolean)).toEqual(["正在输入"]);
  });

  it("pins only the primary and transient interaction nodes in the DOM", () => {
    const pinned = nodeIdsRequiredInDom(
      "primary",
      "editing",
      "dragging",
      "drop-target",
    );

    expect([...pinned]).toEqual([
      "primary",
      "editing",
      "dragging",
      "drop-target",
    ]);
    expect(pinned.has("another-selected-node")).toBe(false);
  });
});
