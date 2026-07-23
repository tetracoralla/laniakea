import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import { markdownToDocument, subtreeToMarkdown } from "./markdown";

describe("Markdown import and export", () => {
  it("exports a selected subtree with stable indentation", () => {
    const markdown = subtreeToMarkdown(createSeedDocument(), "experience");

    expect(markdown).toBe(
      [
        "- 核心体验",
        "  - 打开即输入",
        "  - 全程键盘操作",
        "  - 本地且私密",
      ].join("\n"),
    );
  });

  it("imports a Markdown list into an indexed tree", () => {
    const document = markdownToDocument(
      "- 需求分析\n  - 用户\n  - 价值\n    - 私密",
      "需求分析",
    );

    expect(document.nodes.root.text).toBe("需求分析");
    expect(document.nodes.root.children).toEqual([
      "imported-1",
      "imported-2",
    ]);
    expect(document.nodes["imported-3"].parentId).toBe("imported-2");
  });

  it("rejects prose that is not a list", () => {
    expect(() => markdownToDocument("没有列表")).toThrow(
      "没有找到可导入的 Markdown 列表",
    );
  });
});
