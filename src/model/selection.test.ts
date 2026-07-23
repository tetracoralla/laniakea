import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  addToSelection,
  createSelection,
  normalizeSelectedRoots,
  toggleSelectedNode,
  visibleNodeIds,
} from "./selection";

describe("multi-selection model", () => {
  it("keeps selected ids in visible document order", () => {
    const order = ["root", "a", "b", "c"];
    expect(createSelection(["c", "a"], order, "c")).toEqual({
      primaryId: "c",
      selectedIds: ["a", "c"],
    });
  });

  it("never keeps a primary node that was filtered out of selection", () => {
    expect(
      createSelection(
        ["experience", "experience-2"],
        ["root", "experience"],
        "experience-2",
      ),
    ).toEqual({
      primaryId: "experience",
      selectedIds: ["experience"],
    });
  });

  it("adds and toggles nodes without losing the active node", () => {
    const order = ["root", "a", "b"];
    const added = addToSelection(
      { primaryId: "a", selectedIds: ["a"] },
      ["b"],
      order,
    );
    expect(added).toEqual({
      primaryId: "a",
      selectedIds: ["a", "b"],
    });
    expect(toggleSelectedNode(added, "a", order)).toEqual({
      primaryId: "b",
      selectedIds: ["b"],
    });
  });

  it("normalizes a parent and child to one selected root", () => {
    const document = createSeedDocument();
    expect(
      normalizeSelectedRoots(document, [
        "experience",
        "experience-2",
        "path",
      ]),
    ).toEqual(["experience", "path"]);
  });

  it("excludes descendants of collapsed branches from visible selection", () => {
    const document = createSeedDocument();
    document.nodes.experience.collapsed = true;
    expect(visibleNodeIds(document)).toContain("experience");
    expect(visibleNodeIds(document)).not.toContain("experience-2");
  });
});
