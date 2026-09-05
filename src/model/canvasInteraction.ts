import type { MindMapDocument } from "../types/mindmap";
import { deleteSubspaceForNode, spaceForNode } from "./spaces";

export const mindNodeInteractionTarget = {
  kind: "mind-node",
} as const;

export interface SubspacePortalInteractionTarget {
  kind: "subspace-portal";
  anchorNodeId: string;
  spaceId: string;
}

export type CanvasInteractionTarget =
  | typeof mindNodeInteractionTarget
  | SubspacePortalInteractionTarget;

export function subspacePortalInteractionTarget(
  document: MindMapDocument,
  anchorNodeId: string,
): SubspacePortalInteractionTarget | null {
  const space = spaceForNode(document, anchorNodeId);
  return space
    ? { kind: "subspace-portal", anchorNodeId, spaceId: space.id }
    : null;
}

export function isCurrentCanvasInteractionTarget(
  document: MindMapDocument,
  target: CanvasInteractionTarget,
): boolean {
  if (target.kind === "mind-node") return true;
  const space = spaceForNode(document, target.anchorNodeId);
  return space?.id === target.spaceId;
}

export function deleteSubspaceForInteractionTarget(
  document: MindMapDocument,
  target: SubspacePortalInteractionTarget,
): MindMapDocument {
  return isCurrentCanvasInteractionTarget(document, target)
    ? deleteSubspaceForNode(document, target.anchorNodeId)
    : document;
}
