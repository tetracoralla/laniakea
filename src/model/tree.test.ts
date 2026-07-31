import { describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  adjacentSibling,
  attachSubtree,
  createChild,
  detachSubtree,
  deleteNodePreserveChildren,
  deleteSelectedSubtrees,
  deleteSubtree,
  indentNode,
  moveNode,
  outdentNode,
  pasteSubtrees,
  revealNode,
  setNodeText,
  toggleCollapsedMany,
} from "./tree";
import { singleSelection } from "./selection";

describe("tree mutations", () => {
  it("creates a child without mutating the previous document", () => {
    const document = createSeedDocument();
    const originalChildren = document.nodes.experience.children;
    const result = createChild(document, "experience", "新的体验");

    expect(document.nodes.experience.children).toBe(originalChildren);
    expect(document.nodes.experience.children).toHaveLength(3);
    expect(result.document.nodes.experience.children).toHaveLength(4);
    expect(
      result.document.nodes[result.selection.primaryId!].parentId,
    ).toBe(
      "experience",
    );
  });

  it("uses a caller-provided id so editing can start in the creation event", () => {
    const document = createSeedDocument();
    const result = createChild(
      document,
      "experience",
      "新节点",
      "node-created-before-edit",
    );

    expect(result.selection.primaryId).toBe("node-created-before-edit");
    expect(result.document.nodes["node-created-before-edit"].text).toBe(
      "新节点",
    );
  });

  it("preserves intentional empty node content", () => {
    const document = createSeedDocument();
    const created = createChild(document, "root");
    const createdId = created.selection.primaryId!;
    expect(created.document.nodes[createdId].text).toBe("");

    const cleared = setNodeText(
      created.document,
      createdId,
      "   ",
    );
    expect(cleared.document.nodes[createdId].text).toBe("");
  });

  it("indents under the previous sibling and can outdent again", () => {
    const document = createSeedDocument();
    const indented = indentNode(document, "experience-2");

    expect(indented.document.nodes["experience-2"].parentId).toBe(
      "experience-1",
    );
    expect(indented.document.nodes["experience-1"].children).toContain(
      "experience-2",
    );

    const restored = outdentNode(indented.document, "experience-2");
    expect(restored.document.nodes["experience-2"].parentId).toBe(
      "experience",
    );
    expect(restored.document.nodes.experience.children).toEqual([
      "experience-1",
      "experience-2",
      "experience-3",
    ]);
  });

  it("deletes a node while preserving and reparenting its children", () => {
    const document = createSeedDocument();
    const result = deleteNodePreserveChildren(document, "experience");

    expect(result.document.nodes.experience).toBeUndefined();
    expect(result.document.nodes.root.children).toContain("experience-1");
    expect(result.document.nodes["experience-1"].parentId).toBe("root");
  });

  it("removes a complete subtree but never removes the root", () => {
    const document = createSeedDocument();
    const result = deleteSubtree(document, "boundary");

    expect(result.document.nodes.boundary).toBeUndefined();
    expect(result.document.nodes["boundary-3"]).toBeUndefined();
    expect(result.document.nodes.root.children).not.toContain("boundary");
    expect(deleteSubtree(document, "root").document).toBe(document);
  });

  it("detaches a complete subtree and attaches it beneath another node", () => {
    const document = createSeedDocument();
    const detached = detachSubtree(document, "experience", {
      x: 740,
      y: 260,
    });

    expect(detached.document.nodes.experience.parentId).toBeNull();
    expect(detached.document.nodes.root.children).not.toContain("experience");
    expect(detached.document.floatingRoots).toEqual([
      { id: "experience", x: 740, y: 260 },
    ]);
    expect(detached.document.nodes["experience-2"].parentId).toBe(
      "experience",
    );

    const attached = attachSubtree(
      detached.document,
      "experience",
      "path",
    );
    expect(attached.document.floatingRoots).toEqual([]);
    expect(attached.document.nodes.experience.parentId).toBe("path");
    expect(attached.document.nodes.path.children).toContain("experience");
  });

  it("does not allow attaching a branch beneath its own descendant", () => {
    const document = createSeedDocument();
    const detached = detachSubtree(document, "experience", {
      x: 740,
      y: 260,
    });

    expect(
      attachSubtree(
        detached.document,
        "experience",
        "experience-2",
      ).document,
    ).toBe(detached.document);
  });

  it("deletes a floating branch without deleting the main root", () => {
    const document = detachSubtree(
      createSeedDocument(),
      "boundary",
      { x: 760, y: 280 },
    ).document;
    const result = deleteSubtree(document, "boundary");

    expect(result.document.nodes.boundary).toBeUndefined();
    expect(result.document.floatingRoots).toEqual([]);
    expect(result.document.nodes.root).toBeDefined();
  });

  it("reorders siblings without changing their parent", () => {
    const document = createSeedDocument();
    const result = moveNode(document, "path-2", -1);

    expect(result.document.nodes.path.children).toEqual([
      "path-2",
      "path-1",
      "path-3",
    ]);
    expect(result.document.nodes["path-2"].parentId).toBe("path");
  });

  it("navigates between the main root and floating roots", () => {
    const withFirstFloating = detachSubtree(
      createSeedDocument(),
      "experience",
      { x: 740, y: 260 },
    ).document;
    const document = detachSubtree(
      withFirstFloating,
      "path",
      { x: 760, y: 520 },
    ).document;

    expect(adjacentSibling(document, "root", 1)).toBe("experience");
    expect(adjacentSibling(document, "experience", -1)).toBe("root");
    expect(adjacentSibling(document, "experience", 1)).toBe("path");
    expect(adjacentSibling(document, "path", 1)).toBeNull();
  });

  it("reorders floating roots with the same keyboard command as siblings", () => {
    const withFirstFloating = detachSubtree(
      createSeedDocument(),
      "experience",
      { x: 740, y: 260 },
    ).document;
    const document = detachSubtree(
      withFirstFloating,
      "path",
      { x: 760, y: 520 },
    ).document;
    const result = moveNode(document, "path", -1);

    expect(result.document.floatingRoots.map(({ id }) => id)).toEqual([
      "path",
      "experience",
    ]);
    expect(result.selection).toEqual(singleSelection("path"));
  });

  it("pastes independent copies of complete subtrees", () => {
    const document = createSeedDocument();
    const sourceChildren = [...document.nodes.experience.children];
    const result = pasteSubtrees(
      document,
      "path-1",
      document,
      ["experience"],
    );
    const pastedId = result.selection.primaryId!;
    const pasted = result.document.nodes[pastedId];

    expect(pastedId).not.toBe("experience");
    expect(pasted.text).toBe("核心体验");
    expect(pasted.parentId).toBe("path-1");
    expect(pasted.children).toHaveLength(sourceChildren.length);
    expect(pasted.children).not.toEqual(sourceChildren);
    expect(
      pasted.children.map((id) => result.document.nodes[id].text),
    ).toEqual(sourceChildren.map((id) => document.nodes[id].text));
    expect(document.nodes["path-1"].children).toEqual([]);
    expect(result.document.nodes["path-1"].children).toContain(pastedId);
  });

  it("keeps every pasted node unique even when the id source collides", () => {
    vi.stubGlobal("crypto", undefined);
    const now = vi.spyOn(Date, "now").mockReturnValue(123);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    try {
      const document = createSeedDocument();
      const sourceIds = [
        "experience",
        ...document.nodes.experience.children,
      ];
      const beforeCount = Object.keys(document.nodes).length;

      const result = pasteSubtrees(
        document,
        "path-1",
        document,
        ["experience"],
      );
      const pastedRootId = result.selection.primaryId!;
      const pastedIds = [
        pastedRootId,
        ...result.document.nodes[pastedRootId].children,
      ];

      expect(new Set(pastedIds).size).toBe(sourceIds.length);
      expect(Object.keys(result.document.nodes)).toHaveLength(
        beforeCount + sourceIds.length,
      );
      expect(result.document.nodes["path-1"].children).toEqual([
        pastedRootId,
      ]);
    } finally {
      now.mockRestore();
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("deletes selected roots once and protects the root node", () => {
    const document = createSeedDocument();
    const result = deleteSelectedSubtrees(document, {
      primaryId: "experience-2",
      selectedIds: ["root", "experience", "experience-2", "path"],
    });

    expect(result.document.nodes.root).toBeDefined();
    expect(result.document.nodes.experience).toBeUndefined();
    expect(result.document.nodes["experience-2"]).toBeUndefined();
    expect(result.document.nodes.path).toBeUndefined();
    expect(result.document.nodes.scenario).toBeDefined();
    expect(result.selection).toEqual(singleSelection("root"));
  });

  it("drops descendants that become hidden after a batch collapse", () => {
    const document = createSeedDocument();
    const result = toggleCollapsedMany(document, {
      primaryId: "experience",
      selectedIds: ["experience", "experience-2"],
    });

    expect(result.document.nodes.experience.collapsed).toBe(true);
    expect(result.selection).toEqual(singleSelection("experience"));
  });

  it("reveals every collapsed ancestor before selecting a search result", () => {
    const document = createSeedDocument();
    document.nodes.experience.collapsed = true;
    document.nodes.root.collapsed = true;

    const result = revealNode(document, "experience-2");

    expect(result.document.nodes.root.collapsed).toBe(false);
    expect(result.document.nodes.experience.collapsed).toBe(false);
    expect(result.selection).toEqual(singleSelection("experience-2"));
  });
});
