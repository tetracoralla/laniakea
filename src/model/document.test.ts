import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import { isMindMapDocument, parseMindMapDocument } from "./document";

describe("persisted document validation", () => {
  it("accepts a complete reachable mind map", () => {
    expect(isMindMapDocument(createSeedDocument())).toBe(true);
  });

  it("rejects broken parent references and unreachable nodes", () => {
    const brokenParent = createSeedDocument();
    brokenParent.nodes["experience-1"].parentId = "path";
    expect(isMindMapDocument(brokenParent)).toBe(false);

    const unreachable = createSeedDocument();
    unreachable.nodes.root.children = unreachable.nodes.root.children.filter(
      (id) => id !== "boundary",
    );
    expect(isMindMapDocument(unreachable)).toBe(false);
  });

  it("rejects malformed JSON instead of treating it as saved data", () => {
    expect(() => parseMindMapDocument("{not-json")).toThrow();
  });
});
