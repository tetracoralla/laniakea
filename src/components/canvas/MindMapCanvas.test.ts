import { describe, expect, it } from "vitest";
import { draftForNode } from "./MindMapCanvas";

describe("canvas edit draft isolation", () => {
  it("changes the draft prop for only the actively edited node", () => {
    const drafts = Array.from({ length: 500 }, (_, index) =>
      draftForNode(`node-${index}`, "node-217", "正在输入"),
    );

    expect(drafts.filter(Boolean)).toEqual(["正在输入"]);
  });
});
