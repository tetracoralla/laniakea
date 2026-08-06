import type { MindMapDocument } from "../types/mindmap";
import { parseMindMapDocument } from "./document";
import { parseMarkdownDocument } from "./markdown";

export interface ImportedDocument {
  document: MindMapDocument;
  kind: "native" | "outline";
  canOverwriteSource: boolean;
}

export function importDocumentContent(
  fileName: string,
  content: string,
): ImportedDocument {
  if (/\.mindmap\.json$/i.test(fileName)) {
    return {
      document: parseMindMapDocument(content),
      kind: "native",
      canOverwriteSource: false,
    };
  }
  const parsed = parseMarkdownDocument(
    content,
    fileName.replace(/\.(md|markdown|txt)$/i, ""),
  );
  return {
    document: parsed.document,
    kind: "outline",
    canOverwriteSource: parsed.canOverwriteSource,
  };
}
