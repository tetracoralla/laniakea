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
import { createSeedDocument } from "../data/seed";
import {
  createFlowSpace,
  createMapSpace,
  flowSpaceForNode,
  mapSpaceDocument,
  mergeMapSpaceDocument,
} from "../model/spaces";
import { createChild } from "../model/tree";

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

  it("rejects misspelled fields in nested creation input", () => {
    expect(() => createAgentMindMap("Draft", {
      text: "Root", children: [{ text: "Child", chidlren: [{ text: "Would be lost" }] }],
    } as unknown as AgentTreeInput)).toThrow("unknown fields");
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

  it("projects an anchored flow so an Agent can understand human flow semantics", () => {
    const created = createFlowSpace(createSeedDocument(), "path").document;
    const parsed = parseAgentMindMap(documentToMarkdown(created), "ignored");
    const view = mindMapToAgentView(parsed);
    const anchor = view.nodes.find((node) => node.text === "实现路径");

    expect(anchor?.subspace).toEqual(
      expect.objectContaining({
        type: "flow",
        nodeCount: 1,
        edgeCount: 0,
        truncated: false,
      }),
    );
    expect(anchor?.subspace?.nodes).toEqual([
      expect.objectContaining({ kind: "step", text: "实现路径" }),
    ]);
  });

  it("projects an anchored map space so an Agent can understand deeper human thinking", () => {
    const created = createMapSpace(createSeedDocument(), "path");
    const scoped = mapSpaceDocument(created.document, created.spaceId)!;
    const expanded = createChild(
      scoped,
      scoped.rootId,
      "持久化策略",
      "map-detail",
    ).document;
    const document = mergeMapSpaceDocument(
      created.document,
      created.spaceId,
      expanded,
    );
    const parsed = parseAgentMindMap(documentToMarkdown(document), "ignored");
    const anchor = mindMapToAgentView(parsed).nodes.find(
      (node) => node.text === "实现路径",
    );

    expect(anchor?.subspace).toEqual(
      expect.objectContaining({
        type: "map",
        nodeCount: 2,
        truncated: false,
      }),
    );
    expect(anchor?.subspace?.nodes.map((node) => node.text)).toEqual([
      "实现路径",
      "持久化策略",
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
    expect(view.truncationReasons).toEqual([]);
  });

  it("reports the exact structural reason when a read is truncated", () => {
    const parsed = parseAgentMindMap(
      "# Map\n\n- Root\n  - First\n    - Detail\n  - Second\n",
      "ignored",
    );

    expect(
      mindMapToAgentView(parsed, { maxDepth: 1 }).truncationReasons,
    ).toEqual(["max_depth"]);
    expect(
      mindMapToAgentView(parsed, { maxNodes: 2 }).truncationReasons,
    ).toEqual(["max_nodes"]);
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

  it("uses move positions in the destination list after removal", () => {
    const parsed = parseAgentMindMap(
      "# Map\n\n- Root\n  - First\n  - Second\n  - Third\n",
      "ignored",
    );
    const result = applyMindMapOperations(parsed, [
      {
        type: "move_subtree",
        ref: "/0/0",
        newParentRef: "/0",
        position: 2,
      },
    ]);

    expect(
      result.document.nodes[result.document.rootId].children.map(
        (id) => result.document.nodes[id].text,
      ),
    ).toEqual(["Second", "Third", "First"]);
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

  it("rejects unknown operation types instead of treating them as deletes", () => {
    const parsed = parseAgentMindMap(
      "# Map\n\n- Root\n  - Keep\n",
      "ignored",
    );

    expect(() =>
      applyMindMapOperations(parsed, [
        { type: "explode_everything" } as never,
      ]),
    ).toThrow(/Unknown operation type/);
    expect(
      mindMapToAgentView(parsed).nodes.find(({ text }) => text === "Keep"),
    ).toBeDefined();
  });

  it("caps each flow node's outgoing preview and flags the truncation", () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const space = flowSpaceForNode(created.document, "path")!;
    const hubId = Object.values(space.nodes).find(
      ({ kind }) => kind === "step",
    )!.id;
    const targets = Array.from({ length: 70 }, (_, index) => ({
      id: `flow-node-target-${index}`,
      text: `目标 ${index}`,
      kind: "step" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const hubbedSpace = {
      ...space,
      nodes: {
        ...space.nodes,
        ...Object.fromEntries(targets.map((node) => [node.id, node])),
      },
      edges: [
        ...space.edges,
        ...targets.map((node) => ({
          id: `flow-edge-${node.id}`,
          from: hubId,
          to: node.id,
          label: "",
        })),
      ],
    };
    const document = {
      ...created.document,
      spaces: { ...created.document.spaces, [hubbedSpace.id]: hubbedSpace },
    };

    const parsed = parseAgentMindMap(documentToMarkdown(document), "ignored");
    const anchor = mindMapToAgentView(parsed).nodes.find(
      (node) => node.text === "实现路径",
    );
    const subspace = anchor?.subspace;
    if (!subspace || subspace.type !== "flow") {
      throw new Error("expected a flow subspace on the anchor");
    }
    const hubView = subspace.nodes.find((node) =>
      node.ref.endsWith(hubId),
    );

    expect(hubView?.outgoing).toHaveLength(64);
    expect(hubView?.outgoingTruncated).toBe(true);
    expect(subspace).toEqual(
      expect.objectContaining({ edgeCount: 70 }),
    );
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
    expect(result.truncationReasons).toEqual([]);
  });
});
