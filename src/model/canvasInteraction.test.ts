import { describe, expect, it } from "vitest";
import { createSeedDocument } from "../data/seed";
import { createMapSpace, deleteSubspaceForNode, spaceForNode } from "./spaces";
import {
  deleteSubspaceForInteractionTarget,
  isCurrentCanvasInteractionTarget,
  mindNodeInteractionTarget,
  subspacePortalInteractionTarget,
} from "./canvasInteraction";

describe("canvas interaction targets", () => {
  it("identifies the exact space represented by a portal", () => {
    const created = createMapSpace(createSeedDocument(), "path");
    const target = subspacePortalInteractionTarget(created.document, "path");

    expect(target).toEqual({
      kind: "subspace-portal",
      anchorNodeId: "path",
      spaceId: created.spaceId,
    });
    expect(isCurrentCanvasInteractionTarget(created.document, target!)).toBe(
      true,
    );
  });

  it("rejects a stale portal target instead of falling through to node behavior", () => {
    const created = createMapSpace(createSeedDocument(), "path");
    const target = subspacePortalInteractionTarget(created.document, "path")!;
    const deleted = deleteSubspaceForNode(created.document, "path");

    expect(isCurrentCanvasInteractionTarget(deleted, target)).toBe(false);
    expect(isCurrentCanvasInteractionTarget(deleted, mindNodeInteractionTarget))
      .toBe(true);
  });

  it("does not delete a replacement space from a stale confirmation", () => {
    const first = createMapSpace(createSeedDocument(), "path");
    const staleTarget = subspacePortalInteractionTarget(first.document, "path")!;
    const withoutFirst = deleteSubspaceForNode(first.document, "path");
    const replacement = createMapSpace(withoutFirst, "path");

    const result = deleteSubspaceForInteractionTarget(
      replacement.document,
      staleTarget,
    );

    expect(result).toBe(replacement.document);
    expect(spaceForNode(result, "path")?.id).toBe(replacement.spaceId);
  });
});
