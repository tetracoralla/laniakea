import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import {
  createChild,
  deleteNodePreserveChildren,
  deleteSubtree,
  indentNode,
  moveNode,
  outdentNode,
} from "./tree";

describe("tree mutations", () => {
  it("creates a child without mutating the previous document", () => {
    const document = createSeedDocument();
    const originalChildren = document.nodes.experience.children;
    const result = createChild(document, "experience", "新的体验");

    expect(document.nodes.experience.children).toBe(originalChildren);
    expect(document.nodes.experience.children).toHaveLength(3);
    expect(result.document.nodes.experience.children).toHaveLength(4);
    expect(result.document.nodes[result.selectedId].parentId).toBe(
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
});
