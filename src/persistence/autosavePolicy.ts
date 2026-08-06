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
  return (
    left.nodes === right.nodes &&
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
