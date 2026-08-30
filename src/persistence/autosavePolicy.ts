import { documentToMarkdown } from "../model/markdown";
import type { MindMapDocument } from "../types/mindmap";

export function sourceContentFingerprint(
  document: MindMapDocument,
): string {
  return documentToMarkdown(document);
}

export function sharesDocumentContent(
  left: MindMapDocument,
  right: MindMapDocument,
): boolean {
  const leftSpaces = left.spaces ?? {};
  const rightSpaces = right.spaces ?? {};
  const leftSpaceIds = Object.keys(leftSpaces);
  const sameSpaceContent =
    leftSpaceIds.length === Object.keys(rightSpaces).length &&
    leftSpaceIds.every((id) => {
      const leftSpace = leftSpaces[id];
      const rightSpace = rightSpaces[id];
      const sameTypedContent =
        leftSpace?.type === "flow" && rightSpace?.type === "flow"
          ? leftSpace.edges === rightSpace.edges
          : leftSpace?.type === "map" && rightSpace?.type === "map"
            ? leftSpace.rootId === rightSpace.rootId &&
              leftSpace.floatingRoots === rightSpace.floatingRoots
            : false;
      return (
        rightSpace &&
        leftSpace.id === rightSpace.id &&
        leftSpace.type === rightSpace.type &&
        leftSpace.anchorNodeId === rightSpace.anchorNodeId &&
        leftSpace.nodes === rightSpace.nodes &&
        sameTypedContent &&
        leftSpace.updatedAt === rightSpace.updatedAt
      );
    });
  return (
    left.nodes === right.nodes &&
    sameSpaceContent &&
    left.title === right.title &&
    left.rootId === right.rootId &&
    left.floatingRoots.length === right.floatingRoots.length &&
    left.floatingRoots.every(
      (root, index) => root.id === right.floatingRoots[index]?.id,
    )
  );
}

export function shouldDeferUnboundCopyAutosave(
  document: MindMapDocument,
  documentPath: string | null,
  protectedSourceContent: string | null,
  protectedSourceDocument: MindMapDocument | null = null,
): boolean {
  return (
    documentPath === null &&
    protectedSourceContent !== null &&
    ((protectedSourceDocument !== null &&
      sharesDocumentContent(document, protectedSourceDocument)) ||
      sourceContentFingerprint(document) === protectedSourceContent)
  );
}
