import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  createChild,
  deleteNodePreserveChildren,
  deleteSelectedSubtrees,
  deleteSubtree,
  indentNode,
  moveNode,
  outdentNode,
  revealNode,
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
