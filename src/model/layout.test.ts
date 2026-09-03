import { describe, expect, it } from "vitest";
import type { MindMapDocument, MindNode } from "../types/mindmap";
import {
  applyDraftWidth,
  computeLayout,
  mainBranchAnchorForCollapseTransition,
  shareStableLayout,
  sizeForNode,
  stabilizeMainBranchAnchor,
} from "./layout";
import { createMapSpace, mapSpaceForNode } from "./spaces";

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

function deepDocument(count: number): MindMapDocument {
  const document = largeDocument(count);
  document.nodes.root.children = count > 1 ? ["node-1"] : [];
  for (let index = 1; index < count; index += 1) {
    const id = `node-${index}`;
    const childId = index + 1 < count ? `node-${index + 1}` : null;
    document.nodes[id].parentId = index === 1 ? "root" : `node-${index - 1}`;
    document.nodes[id].children = childId ? [childId] : [];
  }
  return document;
}

describe("automatic layout", () => {
  it("lays out a subspace preview as a real visual child without overlapping siblings", () => {
    const created = createMapSpace(largeDocument(3), "node-1");
    const space = mapSpaceForNode(created.document, "node-1")!;
    const child: MindNode = {
      id: "map-child",
      text: "下层主题",
      parentId: space.rootId,
      children: [],
      collapsed: false,
      createdAt: space.updatedAt,
      updatedAt: space.updatedAt,
    };
    const document = {
      ...created.document,
      spaces: {
        ...created.document.spaces,
        [space.id]: {
          ...space,
          nodes: {
            ...space.nodes,
            [space.rootId]: {
              ...space.nodes[space.rootId],
              children: [child.id],
            },
            [child.id]: child,
          },
        },
      },
    };

    const layout = computeLayout(document);
    const portal = layout.portals?.["node-1"];

    expect(portal).toBeDefined();
    expect(portal!.x).toBeGreaterThan(
      layout.nodes["node-1"].x + layout.nodes["node-1"].width,
    );
    expect(portal!.y + portal!.height).toBeLessThanOrEqual(
      layout.nodes["node-2"].y,
    );
  });

  it("hides the subspace preview with its collapsed anchor branch", () => {
    const created = createMapSpace(largeDocument(2), "node-1");
    const expanded = computeLayout(created.document);
    const collapsed = computeLayout({
      ...created.document,
      nodes: {
        ...created.document.nodes,
        "node-1": { ...created.document.nodes["node-1"], collapsed: true },
      },
    });

    expect(expanded.portals?.["node-1"]).toBeDefined();
    expect(collapsed.portals?.["node-1"]).toBeUndefined();
  });

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

  it("lays out a 10,000-node deep branch without overflowing the stack", () => {
    const layout = computeLayout(deepDocument(10_000));

    expect(layout.visibleIds).toHaveLength(10_000);
    expect(layout.nodes["node-9999"].depth).toBe(9_999);
    expect(layout.nodes["node-9999"].x).toBeGreaterThan(
      layout.nodes.root.x,
    );
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
      600,
    );
    expect(
      sizeForNode(1, "很长的一级主题".repeat(40)).height,
    ).toBeGreaterThan(48);
  });

  it("uses a runtime text measurer so mixed-script editing grows before wrapping", () => {
    const measured = sizeForNode(
      2,
      "H2A、 A2A互动平台",
      null,
      (text) => (text === "H2A、 A2A互动平台" ? 142 : 0),
    );

    expect(measured.width).toBe(186);
    expect(measured.height).toBe(44);
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

  it("keeps third-level and deeper nodes visibly tighter than second-level nodes", () => {
    expect(sizeForNode(0, "中心主题", "main").height).toBe(48);
    expect(sizeForNode(1, "一级主题").height).toBe(48);
    expect(sizeForNode(2, "二级主题").height).toBe(44);
    expect(sizeForNode(3, "三级主题").height).toBe(36);
    expect(sizeForNode(4, "更深层主题").height).toBe(36);
    expect(sizeForNode(2, "同样文字").width).toBeGreaterThan(
      sizeForNode(3, "同样文字").width,
    );
    expect(sizeForNode(2, "第一行\n第二行\n第三行").height).toBe(83);
  });

  it("budgets continuous emoji text as wide glyphs", () => {
    const emoji = sizeForNode(2, "😀".repeat(800));
    const latin = sizeForNode(2, "a".repeat(800));

    expect(emoji.height).toBeGreaterThan(latin.height);
    expect(emoji.height).toBeGreaterThan(400);
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

  it("keeps the affected first-level branch anchored across collapse", () => {
    const document = largeDocument(8);
    document.nodes.root.children = ["node-1", "node-2"];
    document.nodes["node-1"].children = ["node-3", "node-4"];
    document.nodes["node-3"].children = ["node-5", "node-6", "node-7"];
    document.nodes["node-2"].parentId = "root";
    for (const id of ["node-3", "node-4"]) {
      document.nodes[id].parentId = "node-1";
    }
    for (const id of ["node-5", "node-6", "node-7"]) {
      document.nodes[id].parentId = "node-3";
    }
    const expanded = computeLayout(document);
    const collapsedDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        "node-3": { ...document.nodes["node-3"], collapsed: true },
      },
    };
    const compact = computeLayout(collapsedDocument);
    const transition = mainBranchAnchorForCollapseTransition(
      document,
      collapsedDocument,
    );
    const anchored = stabilizeMainBranchAnchor(
      expanded,
      compact,
      collapsedDocument,
      transition,
    );

    expect(transition).toEqual({ anchorId: "node-1", collapsed: true });
    expect(compact.nodes["node-2"].y).not.toBe(expanded.nodes["node-2"].y);
    expect(anchored.nodes["node-1"].y).toBe(expanded.nodes["node-1"].y);
    expect(anchored.nodes["node-2"].y).toBe(expanded.nodes["node-2"].y);
    expect(anchored.nodes.root.y).toBe(expanded.nodes.root.y);
    expect(anchored.nodes["node-1"].y + anchored.nodes["node-1"].height)
      .toBeLessThanOrEqual(anchored.nodes["node-2"].y);
  });

  it("keeps the main root anchored when collapsing a tall branch set", () => {
    const branchCount = 40;
    const childrenPerBranch = 30;
    const document = largeDocument(
      1 + branchCount + branchCount * childrenPerBranch,
    );
    document.nodes.root.children = Array.from(
      { length: branchCount },
      (_, index) => `node-${index + 1}`,
    );
    let childIndex = branchCount + 1;
    document.nodes.root.children.forEach((branchId) => {
      const children = Array.from({ length: childrenPerBranch }, () => {
        const childId = `node-${childIndex++}`;
        document.nodes[childId].parentId = branchId;
        return childId;
      });
      document.nodes[branchId].parentId = "root";
      document.nodes[branchId].children = children;
    });
    const expanded = computeLayout(document);
    const collapsedDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        "node-20": { ...document.nodes["node-20"], collapsed: true },
      },
    };
    const compact = computeLayout(collapsedDocument);
    const anchored = stabilizeMainBranchAnchor(
      expanded,
      compact,
      collapsedDocument,
      mainBranchAnchorForCollapseTransition(document, collapsedDocument),
    );

    expect(compact.nodes.root.y).not.toBe(expanded.nodes.root.y);
    expect(anchored.nodes.root.y).toBe(expanded.nodes.root.y);
    document.nodes.root.children.forEach((branchId) => {
      expect(anchored.nodes[branchId].y).toBe(expanded.nodes[branchId].y);
    });
  });

  it("does not apply collapse anchoring to a structural reorder", () => {
    const document = largeDocument(4);
    const reordered = {
      ...document,
      nodes: {
        ...document.nodes,
        root: {
          ...document.nodes.root,
          children: ["node-2", "node-1", "node-3"],
        },
      },
    };

    expect(mainBranchAnchorForCollapseTransition(document, reordered)).toBeNull();
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
