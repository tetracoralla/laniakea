import type { MindMapDocument } from "../types/mindmap";
import { parseMindMapDocument } from "./document";
import { markdownToDocument } from "./markdown";

export interface ImportedDocument {
  document: MindMapDocument;
  kind: "native" | "outline";
}

export function importDocumentContent(
  fileName: string,
  content: string,
): ImportedDocument {
  if (/\.mindmap\.json$/i.test(fileName)) {
    return {
      document: parseMindMapDocument(content),
      kind: "native",
    };
  }
  return {
    document: markdownToDocument(
      content,
      fileName.replace(/\.(md|markdown|txt)$/i, ""),
    ),
    kind: "outline",
  };
}
