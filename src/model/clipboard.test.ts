import { describe, expect, it } from "vitest";
import { createBlankDocument, createSeedDocument } from "../data/seed";
import {
  clipboardTextToForest,
  pasteClipboardForest,
} from "./clipboard";

describe("clipboard text import", () => {
  it("keeps multiple Markdown roots as multiple pasted branches", () => {
    const forest = clipboardTextToForest("- 需求\n- 方案");

    expect(forest.rootIds).toHaveLength(2);
    expect(forest.rootIds.map((id) => forest.document.nodes[id].text)).toEqual([
      "需求",
      "方案",
    ]);
  });

  it("preserves an indented plain-text hierarchy", () => {
    const forest = clipboardTextToForest(
      "需求\n  用户\n    场景\n  目标",
    );
    const root = forest.document.nodes[forest.rootIds[0]];

    expect(root.text).toBe("需求");
    expect(root.children.map((id) => forest.document.nodes[id].text)).toEqual([
      "用户",
      "目标",
    ]);
    expect(
      forest.document.nodes[root.children[0]].children.map(
        (id) => forest.document.nodes[id].text,
      ),
    ).toEqual(["场景"]);
  });

  it("turns one plain line into one node", () => {
    const forest = clipboardTextToForest("一个新节点");

    expect(forest.rootIds).toHaveLength(1);
    expect(forest.document.nodes[forest.rootIds[0]].text).toBe("一个新节点");
  });

  it("replaces an untouched blank document with pasted Markdown", () => {
    const forest = clipboardTextToForest(
      "# 新方案\n\n- 原点\n  - 路径",
    );
    const pasted = pasteClipboardForest(
      createBlankDocument(),
      "root",
      forest,
    );

    expect(pasted.document.title).toBe("新方案");
    expect(pasted.document.nodes[pasted.document.rootId].text).toBe(
      "原点",
    );
    expect(Object.keys(pasted.document.nodes)).toHaveLength(2);
  });

  it("keeps normal paste scoped under the selected node", () => {
    const destination = createSeedDocument();
    const forest = clipboardTextToForest("- 新分支\n  - 子节点");
    const pasted = pasteClipboardForest(
      destination,
      "experience",
      forest,
    );

    const appendedId = pasted.document.nodes.experience.children.at(-1);
    expect(pasted.document.nodes[appendedId!].text).toBe("新分支");
    expect(pasted.document.nodes[appendedId!].parentId).toBe("experience");
  });
});
