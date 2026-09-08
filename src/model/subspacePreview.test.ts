import { describe, expect, it } from "vitest";
import type { FlowSpace, MapSpace, MindNode } from "../types/mindmap";
import { subspacePreview } from "./subspacePreview";

const now = "2026-09-03T00:00:00.000Z";

function mindNode(
  id: string,
  text: string,
  parentId: string | null,
  children: string[] = [],
): MindNode {
  return {
    id,
    text,
    parentId,
    children,
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

function mapSpace(): MapSpace {
  return {
    id: "map-space",
    type: "map",
    anchorNodeId: "anchor",
    rootId: "root",
    nodes: {
      root: mindNode("root", "主题", null, ["one", "two", "three", "four"]),
      one: mindNode("one", "二级节点1", "root", ["deep"]),
      two: mindNode("two", "二级节点2", "root"),
      three: mindNode("three", "二级节点3", "root"),
      four: mindNode("four", "二级节点4", "root"),
      deep: mindNode("deep", "不应显示的深层节点", "one"),
    },
    floatingRoots: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: now,
  };
}

function flowSpace(stepCount: number): FlowSpace {
  const nodes: FlowSpace["nodes"] = {
    start: {
      id: "start",
      text: "开始",
      kind: "start",
      createdAt: now,
      updatedAt: now,
    },
  };
  const edges: FlowSpace["edges"] = [];
  let previous = "start";
  for (let index = 1; index <= stepCount; index += 1) {
    const id = `step-${index}`;
    nodes[id] = {
      id,
      text: `步骤${index}`,
      kind: "step",
      createdAt: now,
      updatedAt: now,
    };
    edges.push({ id: `edge-${index}`, from: previous, to: id, label: "" });
    previous = id;
  }
  nodes.end = {
    id: "end",
    text: "结束",
    kind: "end",
    createdAt: now,
    updatedAt: now,
  };
  edges.push({ id: "edge-end", from: previous, to: "end", label: "" });
  return {
    id: "flow-space",
    type: "flow",
    anchorNodeId: "anchor",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: now,
  };
}

describe("subspace preview", () => {
  it("shows only the first three direct map children and an ellipsis", () => {
    const preview = subspacePreview(mapSpace());

    expect(preview.text).toBe("-二级节点1\n-二级节点2\n-二级节点3\n...");
    expect(preview.text).not.toContain("二级节点4");
    expect(preview.text).not.toContain("深层节点");
    expect(preview.text).not.toContain("主题");
  });

  it("does not imply a connection between free-standing flow ideas", () => {
    const flow = flowSpace(3);
    flow.edges = [{ id: "a", from: "step-1", to: "step-2", label: "" }];
    const preview = subspacePreview(flow);
    expect(preview.text).not.toContain("步骤1→步骤3");
    expect(preview.text).not.toContain("步骤3→步骤2");
    expect(preview.text).toContain(" · ");
    flow.edges = [];
    expect(subspacePreview(flow).text).toBe("步骤1 · 步骤2 · 步骤3");
    flow.nodes = {};
    expect(subspacePreview(flow).text).toBe("暂无步骤");
  });

  it("shows all four flow steps when the fourth is the final step", () => {
    expect(subspacePreview(flowSpace(4)).text).toBe(
      "步骤1→步骤2→步骤3→步骤4",
    );
  });

  it("shows the first three and final flow step when more steps remain", () => {
    const preview = subspacePreview(flowSpace(6));

    expect(preview.text).toBe("步骤1→步骤2→步骤3...→步骤6");
    expect(preview.text).not.toContain("开始");
    expect(preview.text).not.toContain("结束");
    expect(preview.text).not.toContain("步骤4");
    expect(preview.text).not.toContain("步骤5");
  });

  it("keeps looped flows deterministic instead of dropping their nodes", () => {
    const flow = flowSpace(3);
    flow.edges = [
      { id: "a", from: "step-1", to: "step-2", label: "" },
      { id: "b", from: "step-2", to: "step-3", label: "" },
      { id: "c", from: "step-3", to: "step-1", label: "" },
    ];

    expect(subspacePreview(flow).text).toBe("步骤1→步骤2→步骤3");
  });
});
