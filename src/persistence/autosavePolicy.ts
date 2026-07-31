import { documentToMarkdown } from "../model/markdown";
import type { MindMapDocument } from "../types/mindmap";

export function sourceContentFingerprint(
  document: MindMapDocument,
): string {
  return documentToMarkdown(document);
}

export function shouldDeferUnboundCopyAutosave(
  document: MindMapDocument,
  documentPath: string | null,
  protectedSourceContent: string | null,
): boolean {
  return (
    documentPath === null &&
    protectedSourceContent !== null &&
    sourceContentFingerprint(document) === protectedSourceContent
  );
}
