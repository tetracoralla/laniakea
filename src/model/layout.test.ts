import { describe, expect, it } from "vitest";
import type { MindMapDocument, MindNode } from "../types/mindmap";
import {
  applyDraftWidth,
  computeLayout,
  shareStableLayout,
  sizeForNode,
} from "./layout";

function largeDocument(count: number): MindMapDocument {
  const now = "2026-07-23T00:00:00.000Z";
  const nodes: Record<string, MindNode> = {
    root: {
      id: "root",
      text: "性能测试",
      parentId: null,
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
  };

  for (let index = 1; index < count; index += 1) {
    const id = `node-${index}`;
    nodes[id] = {
      id,
      text: `节点 ${index}`,
      parentId: "root",
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };
    nodes.root.children.push(id);
  }

  return {
    formatVersion: 1,
    title: "性能测试",
    rootId: "root",
    nodes,
    floatingRoots: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: now,
  };
}

describe("automatic layout", () => {
  it("lays out all visible nodes with increasing depth coordinates", () => {
    const layout = computeLayout(largeDocument(20));
    expect(layout.visibleIds).toHaveLength(20);
    expect(layout.nodes["node-1"].x).toBeGreaterThan(layout.nodes.root.x);
  });

  it("handles a 1,000-node file within the interaction budget", () => {
    const startedAt = performance.now();
    const layout = computeLayout(largeDocument(1_000));
    const elapsed = performance.now() - startedAt;

    expect(layout.visibleIds).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(50);
  });

  it("keeps a 5,000-node layout within the large-document budget", () => {
    const startedAt = performance.now();
    const layout = computeLayout(largeDocument(5_000));
    const elapsed = performance.now() - startedAt;

    expect(layout.visibleIds).toHaveLength(5_000);
    expect(elapsed).toBeLessThan(150);
  });

  it("grows long and multiline nodes without overlapping siblings", () => {
    const document = largeDocument(3);
    document.nodes["node-1"].text =
      "这是一个需要完整显示的很长节点，它应该自动换行并增高，而不是被固定高度裁掉。".repeat(
        3,
      );
    document.nodes["node-2"].text = "第一行\n第二行\n第三行";

    const layout = computeLayout(document);
    const first = layout.nodes["node-1"];
    const second = layout.nodes["node-2"];

    expect(first.height).toBeGreaterThan(48);
    expect(second.height).toBeGreaterThan(48);
    expect(first.y + first.height).toBeLessThanOrEqual(second.y);
  });

  it("uses visible placeholders as the empty width and caps child content", () => {
    const document = largeDocument(3);
    document.nodes.root.text = "";
    document.nodes["node-1"].text = "";
    document.nodes["node-2"].text = "一段明显更长的一级子主题";

    const layout = computeLayout(document);

    expect(layout.nodes.root.width).toBe(130);
    expect(layout.nodes["node-1"].width).toBe(108);
    expect(layout.nodes.root.height).toBe(48);
    expect(layout.nodes["node-1"].height).toBe(48);
    expect(layout.nodes["node-2"].width).toBeGreaterThan(
      layout.nodes["node-1"].width,
    );
    expect(sizeForNode(1, "很长的一级主题".repeat(40)).width).toBe(
      440,
    );
    expect(
      sizeForNode(1, "很长的一级主题".repeat(40)).height,
    ).toBeGreaterThan(48);
  });

  it("keeps the main root on one line unless text contains a newline", () => {
    const singleLine = sizeForNode(
      0,
      "这是一个会持续变宽但不会自动换行的中心主题".repeat(5),
      "main",
    );
    const multiline = sizeForNode(
      0,
      "第一行中心主题\n第二行中心主题",
      "main",
    );

    expect(singleLine.width).toBeGreaterThan(1_000);
    expect(singleLine.height).toBe(48);
    expect(multiline.height).toBeGreaterThan(48);
  });

  it("keeps second-level nodes compact without sacrificing text padding", () => {
    expect(sizeForNode(0, "中心主题", "main").height).toBe(48);
    expect(sizeForNode(1, "一级主题").height).toBe(48);
    expect(sizeForNode(2, "二级主题").height).toBe(44);
    expect(sizeForNode(4, "更深层主题").height).toBe(44);
    expect(sizeForNode(2, "第一行\n第二行\n第三行").height).toBe(83);
  });

  it("keeps a short connector gap and pushes descendants when a parent widens", () => {
    const document = largeDocument(3);
    document.nodes.root.children = ["node-1"];
    document.nodes["node-1"].children = ["node-2"];
    document.nodes["node-2"].parentId = "node-1";
    const shortLayout = computeLayout(document);

    document.nodes.root.text =
      "明显更长的中心主题会把后续所有层级一起推开";
    const wideLayout = computeLayout(document);

    const shortRootGap =
      shortLayout.nodes["node-1"].x -
      (shortLayout.nodes.root.x + shortLayout.nodes.root.width);
    const wideRootGap =
      wideLayout.nodes["node-1"].x -
      (wideLayout.nodes.root.x + wideLayout.nodes.root.width);
    const descendantGap =
      wideLayout.nodes["node-2"].x -
      (wideLayout.nodes["node-1"].x +
        wideLayout.nodes["node-1"].width);

    expect(shortRootGap).toBe(168);
    expect(wideRootGap).toBe(168);
    expect(descendantGap).toBe(150);
    expect(wideLayout.nodes["node-1"].x).toBeGreaterThan(
      shortLayout.nodes["node-1"].x,
    );
    expect(wideLayout.nodes["node-2"].x).toBeGreaterThan(
      shortLayout.nodes["node-2"].x,
    );
  });

  it("updates only the editing node width from its draft", () => {
    const document = largeDocument(20);
    document.nodes["node-1"].text = "";
    const layout = computeLayout(document);
    const withDraft = applyDraftWidth(
      layout,
      document,
      "node-1",
      "编辑时也会跟随内容伸展",
    );

    expect(withDraft.nodes["node-1"].width).toBeGreaterThan(
      layout.nodes["node-1"].width,
    );
    expect(withDraft.nodes["node-2"]).toBe(layout.nodes["node-2"]);
  });

  it("shifts an editing node's descendants without lengthening its connector", () => {
    const document = largeDocument(3);
    document.nodes.root.children = ["node-1"];
    document.nodes["node-1"].children = ["node-2"];
    document.nodes["node-2"].parentId = "node-1";
    const layout = computeLayout(document);
    const withDraft = applyDraftWidth(
      layout,
      document,
      "node-1",
      "编辑时变宽的父节点",
    );

    expect(
      withDraft.nodes["node-2"].x -
        (withDraft.nodes["node-1"].x +
          withDraft.nodes["node-1"].width),
    ).toBe(150);
  });

  it("reflows siblings when an editing draft wraps onto more lines", () => {
    const document = largeDocument(3);
    document.nodes["node-1"].text = "";
    const base = computeLayout(document);
    const draftLayout = computeLayout(document, {
      id: "node-1",
      text: "编辑中的长文案需要在达到最大宽度后换行并实时增高。".repeat(
        10,
      ),
    });

    expect(draftLayout.nodes["node-1"].height).toBeGreaterThan(
      base.nodes["node-1"].height,
    );
    expect(
      draftLayout.nodes["node-1"].y +
        draftLayout.nodes["node-1"].height,
    ).toBeLessThanOrEqual(draftLayout.nodes["node-2"].y);
  });

  it("keeps a floating branch root at its saved canvas position", () => {
    const document = largeDocument(3);
    document.nodes.root.children = ["node-1"];
    document.nodes["node-2"].parentId = null;
    document.floatingRoots = [{ id: "node-2", x: 720, y: 180 }];

    const layout = computeLayout(document);

    expect(layout.nodes["node-2"]).toMatchObject({
      x: 720,
      y: 180,
      rootKind: "floating",
    });
    expect(layout.nodes.root.rootKind).toBe("main");
  });

  it("preserves layout object identities for nodes that did not move", () => {
    const document = largeDocument(20);
    document.nodes.root.children = document.nodes.root.children.filter(
      (id) => id !== "node-19",
    );
    document.nodes["node-19"].parentId = null;
    document.floatingRoots = [{ id: "node-19", x: 900, y: 200 }];
    const previous = computeLayout(document);
    const changed = {
      ...document,
      floatingRoots: [{ id: "node-19", x: 940, y: 200 }],
    };
    const next = shareStableLayout(previous, computeLayout(changed));

    expect(next.nodes["node-19"]).not.toBe(previous.nodes["node-19"]);
    expect(next.nodes["node-2"]).toBe(previous.nodes["node-2"]);
  });
});
