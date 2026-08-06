import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import { importDocumentContent } from "./import";

describe("document file import routing", () => {
  it("reopens a native file without turning JSON lines into nodes", () => {
    const source = createSeedDocument();
    const imported = importDocumentContent(
      "方案.mindmap.json",
      JSON.stringify(source, null, 2),
    );

    expect(imported.kind).toBe("native");
    expect(imported.canOverwriteSource).toBe(false);
    expect(imported.document.rootId).toBe(source.rootId);
    expect(Object.keys(imported.document.nodes)).toHaveLength(
      Object.keys(source.nodes).length,
    );
    expect(imported.document.nodes[source.rootId].text).toBe(
      source.nodes[source.rootId].text,
    );
  });

  it("keeps Markdown and indented text on the outline route", () => {
    const imported = importDocumentContent(
      "方案.txt",
      "原点\n  路径 A\n  路径 B",
    );

    expect(imported.kind).toBe("outline");
    expect(Object.keys(imported.document.nodes)).toHaveLength(3);
  });

  it("marks rich Markdown as protected from source overwrite", () => {
    const imported = importDocumentContent(
      "研究.md",
      "# 研究\n\n| 项目 | 结论 |\n| --- | --- |\n| A | B |\n",
    );

    expect(imported.kind).toBe("outline");
    expect(imported.canOverwriteSource).toBe(false);
  });
});
