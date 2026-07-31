import { describe, expect, it } from "vitest";
import {
  createBlankDocument,
  createSeedDocument,
} from "../data/seed";
import {
  documentToMarkdown,
  markdownToDocument,
  parseMarkdownDocument,
  subtreeToMarkdown,
} from "./markdown";
import { deleteSubtree, setNodeText } from "./tree";

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

  it("parses a 5,000-node outline within the large-document budget", () => {
    const markdown = [
      "- 大图性能样本",
      ...Array.from(
        { length: 4_999 },
        (_, index) => `  - 节点 ${index + 1}`,
      ),
    ].join("\n");
    const startedAt = performance.now();
    const parsed = parseMarkdownDocument(markdown, "性能样本");
    const elapsed = performance.now() - startedAt;

    expect(Object.keys(parsed.document.nodes)).toHaveLength(5_000);
    // Keep enough headroom for Vitest's parallel workers while still catching
    // a material regression beyond the 1,000-node / 1-second product target.
    expect(elapsed).toBeLessThan(1_500);
  });

  it("round-trips the editable Markdown outline without changing its tree", () => {
    const source = createSeedDocument();
    const parsed = parseMarkdownDocument(
      documentToMarkdown(source),
      "ignored filename",
    );

    expect(parsed.canOverwriteSource).toBe(true);
    expect(parsed.document.title).toBe(source.title);
    expect(parsed.document.nodes[parsed.document.rootId].text).toBe(
      source.nodes[source.rootId].text,
    );
    expect(
      parsed.document.nodes[parsed.document.rootId].children.map(
        (id) => parsed.document.nodes[id].text,
      ),
    ).toEqual(["使用场景", "核心体验", "实现路径", "第一版边界"]);
  });

  it("round-trips empty nodes without turning placeholders into content", () => {
    const source = createBlankDocument();
    const child = {
      id: "empty-child",
      text: "",
      parentId: source.rootId,
      children: [],
      collapsed: false,
      createdAt: source.updatedAt,
      updatedAt: source.updatedAt,
    };
    source.nodes[child.id] = child;
    source.nodes.root.children = [child.id];

    const markdown = documentToMarkdown(source);
    const reopened = parseMarkdownDocument(markdown, "ignored");
    const reopenedRoot = reopened.document.nodes[reopened.document.rootId];

    expect(markdown).toContain("\n- \n  - ");
    expect(reopened.canOverwriteSource).toBe(true);
    expect(reopenedRoot.text).toBe("");
    expect(
      reopened.document.nodes[reopenedRoot.children[0]].text,
    ).toBe("");
  });

  it("round-trips floating branches as ordinary top-level Markdown items", () => {
    const source = createSeedDocument();
    source.nodes.root.children = source.nodes.root.children.filter(
      (id) => id !== "path",
    );
    source.nodes.path.parentId = null;
    source.floatingRoots = [{ id: "path", x: 840, y: 220 }];

    const markdown = documentToMarkdown(source);
    const reopened = markdownToDocument(markdown, "ignored");

    expect(markdown).toContain("\n- 做一个思维导图 APP");
    expect(markdown).toContain("\n- 实现路径");
    expect(reopened.floatingRoots).toHaveLength(1);
    expect(
      reopened.nodes[reopened.floatingRoots[0].id].text,
    ).toBe("实现路径");
    expect(reopened.nodes[reopened.floatingRoots[0].id].children).toHaveLength(
      3,
    );
  });

  it("imports indented plain text with spaces or tabs", () => {
    const document = markdownToDocument(
      "需求分析\n    用户\n        私密需求\n\t价值",
      "需求分析",
    );

    expect(document.nodes.root.text).toBe("需求分析");
    expect(document.nodes.root.children).toEqual([
      "imported-1",
      "imported-3",
    ]);
    expect(document.nodes["imported-2"].parentId).toBe("imported-1");
  });

  it("renders headings, prose, lists, code, and GFM tables as a tree", () => {
    const parsed = parseMarkdownDocument(
      [
        "# 产品方案",
        "",
        "背景说明。",
        "",
        "## 用户",
        "",
        "- [ ] 访谈",
        "- 验证",
        "",
        "```ts",
        "const ready = true",
        "```",
        "",
        "| 指标 | 目标 |",
        "| --- | --- |",
        "| 打开 | 1s |",
      ].join("\n"),
      "方案",
    );

    const labels = Object.values(parsed.document.nodes).map(
      (node) => node.text,
    );
    expect(parsed.canOverwriteSource).toBe(false);
    expect(parsed.document.nodes.root.text).toBe("产品方案");
    expect(labels).toContain("背景说明。");
    expect(labels).toContain("☐ 访谈");
    expect(labels.some((text) => text.includes("const ready = true"))).toBe(
      true,
    );
    expect(labels.some((text) => text.includes("| 指标 | 目标 |"))).toBe(
      true,
    );
  });

  it("keeps non-tree Markdown as ordinary editable and deletable nodes", () => {
    const parsed = parseMarkdownDocument(
      [
        "# 方案",
        "",
        "<widget data-mode=\"raw\">保留我</widget>",
        "",
        "> 暂时无法映射的引用",
      ].join("\n"),
      "方案",
    );
    const rawNode = Object.values(parsed.document.nodes).find(
      (node) => node.text.includes("<widget"),
    );

    expect(rawNode?.parentId).toBe(parsed.document.rootId);
    expect(rawNode?.text).toBe(
      '<widget data-mode="raw">保留我</widget>',
    );

    const edited = setNodeText(
      parsed.document,
      rawNode!.id,
      "已经人工整理",
    );
    expect(edited.document.nodes[rawNode!.id].text).toBe("已经人工整理");

    const deleted = deleteSubtree(edited.document, rawNode!.id);
    expect(deleted.document.nodes[rawNode!.id]).toBeUndefined();
  });

  it("renders plain prose instead of rejecting valid Markdown", () => {
    const parsed = parseMarkdownDocument("没有列表，但仍是 Markdown。", "随笔");

    expect(parsed.canOverwriteSource).toBe(false);
    expect(parsed.document.nodes.root.text).toBe("随笔");
    expect(
      Object.values(parsed.document.nodes).some(
        (node) => node.text === "没有列表，但仍是 Markdown。",
      ),
    ).toBe(true);
  });

  it("normalizes rendered rich blocks into a reopenable Markdown outline", () => {
    const rich = parseMarkdownDocument(
      [
        "# 复杂内容",
        "",
        "```ts",
        "const ready = true",
        "```",
        "",
        "| 能力 | 状态 |",
        "| --- | --- |",
        "| 渲染 | 完成 |",
      ].join("\n"),
      "复杂内容",
    );
    const reopened = parseMarkdownDocument(
      documentToMarkdown(rich.document),
      "ignored filename",
    );

    expect(reopened.canOverwriteSource).toBe(true);
    expect(
      Object.values(reopened.document.nodes).map((node) => node.text),
    ).toEqual(
      Object.values(rich.document.nodes).map((node) => node.text),
    );
  });
});
