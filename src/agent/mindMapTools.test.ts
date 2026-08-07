import { describe, expect, it } from "vitest";
import {
  applyMindMapOperations,
  createAgentMindMap,
  MAX_AGENT_DEPTH,
  mindMapToAgentView,
  parseAgentMindMap,
  searchAgentMindMap,
  type AgentTreeInput,
} from "./mindMapTools";
import { documentToMarkdown } from "../model/markdown";

describe("Laniakea Agent mind-map tools", () => {
  it("creates a human-readable Markdown outline from structured input", () => {
    const document = createAgentMindMap("Launch", {
      text: "Release",
      children: [
        { text: "Product", children: [{ text: "Scope" }] },
        { text: "Risk" },
      ],
    });

    expect(documentToMarkdown(document)).toBe(
      [
        "# Launch",
        "",
        "- Release",
        "  - Product",
        "    - Scope",
        "  - Risk",
        "",
      ].join("\n"),
    );
  });

  it("uses structural refs to distinguish repeated node labels", () => {
    const parsed = parseAgentMindMap(
      "# Risks\n\n- Root\n  - Risk\n  - Risk\n",
      "ignored",
    );
    const view = mindMapToAgentView(parsed);

    expect(view.nodes.filter((node) => node.text === "Risk")).toEqual([
      expect.objectContaining({ ref: "/0/0" }),
      expect.objectContaining({ ref: "/0/1" }),
    ]);
  });

  it("returns a complete requested subtree without calling it truncated", () => {
    const parsed = parseAgentMindMap(
      [
        "# Map",
        "",
        "- Root",
        "  - First",
        "    - Detail",
        "  - Second",
        "",
      ].join("\n"),
      "ignored",
    );
    const view = mindMapToAgentView(parsed, { rootRef: "/0/0" });

    expect(view.nodes.map((node) => node.text)).toEqual(["First", "Detail"]);
    expect(view.truncated).toBe(false);
  });

  it("keeps original refs valid throughout one coherent mutation batch", () => {
    const parsed = parseAgentMindMap(
      [
        "# Shared",
        "",
        "- Root",
        "  - Group",
        "    - Remove me",
        "  - Duplicate",
        "  - Later",
        "",
      ].join("\n"),
      "ignored",
    );
    const result = applyMindMapOperations(parsed, [
      {
        type: "move_subtree",
        ref: "/0/2",
        newParentRef: "/0/0",
        position: 0,
      },
      { type: "set_text", ref: "/0/1", text: "Renamed" },
      { type: "delete_subtree", ref: "/0/0/0" },
      {
        type: "add_child",
        parentRef: "/0/0",
        node: { text: "Added", children: [{ text: "Detail" }] },
      },
    ]);

    expect(result.markdown).toContain(
      [
        "  - Group",
        "    - Later",
        "    - Added",
        "      - Detail",
        "  - Renamed",
      ].join("\n"),
    );
    expect(result.markdown).not.toContain("Remove me");
  });

  it("creates and promotes top-level floating branches", () => {
    const parsed = parseAgentMindMap(
      [
        "# Shared",
        "",
        "- Root",
        "  - Promote me",
        "- Existing floating",
        "",
      ].join("\n"),
      "ignored",
    );
    const result = applyMindMapOperations(parsed, [
      {
        type: "add_sibling",
        siblingRef: "/1",
        placement: "before",
        node: { text: "New floating", children: [{ text: "Detail" }] },
      },
      {
        type: "move_subtree",
        ref: "/0/0",
        newParentRef: null,
        position: 1,
      },
    ]);

    expect(
      result.document.floatingRoots.map(
        ({ id }) => result.document.nodes[id].text,
      ),
    ).toEqual(["New floating", "Promote me", "Existing floating"]);
    expect(result.markdown).toContain(
      [
        "- Root",
        "- New floating",
        "  - Detail",
        "- Promote me",
        "- Existing floating",
      ].join("\n"),
    );
  });

  it("rejects cycles and protects the main root", () => {
    const parsed = parseAgentMindMap(
      "# Map\n\n- Root\n  - Parent\n    - Child\n",
      "ignored",
    );

    expect(() =>
      applyMindMapOperations(parsed, [
        {
          type: "move_subtree",
          ref: "/0/0",
          newParentRef: "/0/0/0",
        },
      ]),
    ).toThrow(/descendants/);
    expect(() =>
      applyMindMapOperations(parsed, [
        { type: "delete_subtree", ref: "/0" },
      ]),
    ).toThrow(/main root/);
  });

  it("reads rich Markdown but refuses lossy in-place mutation", () => {
    const parsed = parseAgentMindMap(
      "# Rich\n\n| Key | Value |\n| --- | --- |\n| Keep | Me |\n",
      "ignored",
    );

    expect(mindMapToAgentView(parsed).canUpdate).toBe(false);
    expect(() =>
      applyMindMapOperations(parsed, [
        { type: "set_title", title: "Overwrite" },
      ]),
    ).toThrow(/rich content/);
  });

  it("returns a structured depth error before recursive construction", () => {
    let input: AgentTreeInput = { text: "Leaf" };
    for (let depth = 0; depth <= MAX_AGENT_DEPTH; depth += 1) {
      input = { text: `Level ${depth}`, children: [input] };
    }

    expect(() => createAgentMindMap("Too deep", input)).toThrow(
      new RegExp(`${MAX_AGENT_DEPTH} levels`),
    );
  });

  it("searches every accepted node beyond the 10,000-node edit limit", () => {
    const markdown = [
      "# Large",
      "",
      "- Root",
      ...Array.from({ length: 10_001 }, (_, index) =>
        `  - ${index === 10_000 ? "Needle at the end" : `Node ${index}`}`,
      ),
      "",
    ].join("\n");
    const result = searchAgentMindMap(
      parseAgentMindMap(markdown, "ignored"),
      "needle",
    );

    expect(result.nodes).toEqual([
      expect.objectContaining({ text: "Needle at the end" }),
    ]);
    expect(result.nodeCount).toBe(10_002);
    expect(result.truncated).toBe(false);
  });
});
