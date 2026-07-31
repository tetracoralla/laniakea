import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  isBlankMindMapDocument,
  isMindMapDocument,
  parseMindMapDocument,
} from "./document";
import { createBlankDocument } from "../data/seed";

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

  it("migrates documents saved before floating branches existed", () => {
    const { floatingRoots: _floatingRoots, ...legacy } =
      createSeedDocument();

    expect(
      parseMindMapDocument(JSON.stringify(legacy)).floatingRoots,
    ).toEqual([]);
  });

  it("preserves real content even when it matches an old placeholder", () => {
    const document = createSeedDocument();
    document.nodes.root.text = "输入中心主题";
    document.nodes["experience-1"].text = "新节点";
    document.nodes["experience-2"].text = "未命名节点";

    const parsed = parseMindMapDocument(JSON.stringify(document));

    expect(parsed.nodes.root.text).toBe("输入中心主题");
    expect(parsed.nodes["experience-1"].text).toBe("新节点");
    expect(parsed.nodes["experience-2"].text).toBe("未命名节点");
  });

  it("only treats an untouched single root as a blank document", () => {
    const blank = createBlankDocument();
    expect(isBlankMindMapDocument(blank)).toBe(true);

    blank.nodes.root.text = "真实主题";
    expect(isBlankMindMapDocument(blank)).toBe(false);

    for (const realContent of [
      "输入中心主题",
      "未命名节点",
      "新节点",
    ]) {
      blank.nodes.root.text = realContent;
      expect(isBlankMindMapDocument(blank)).toBe(false);
    }
  });
});
