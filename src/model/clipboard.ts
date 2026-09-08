import { createBlankDocument } from "../data/seed";
import type { MindMapDocument } from "../types/mindmap";
import {
  isBlankMindMapDocument,
  topLevelRootIds,
} from "./document";
import { markdownToDocument } from "./markdown";
import { singleSelection } from "./selection";
import {
  pasteSubtrees,
  type DocumentMutation,
} from "./tree";

export interface ClipboardForest {
  document: MindMapDocument;
  rootIds: string[];
}

export const importedPasteTitle = "粘贴内容";

export function adoptRootTextTitle(
  document: MindMapDocument,
  importMarker: string,
): MindMapDocument {
  const rootText = document.nodes[document.rootId]?.text;
  if (document.title !== importMarker || !rootText.trim()) return document;
  return { ...document, title: rootText };
}

export function clipboardTextToForest(text: string, importTitle = importedPasteTitle): ClipboardForest {
  const value = text.trim();
  if (!value) throw new Error("剪贴板中没有可粘贴的内容");

  const oneLineMarkdownList = /^(?:[-+*]|\d+[.)])\s+\S/u.test(value);
  if (!value.includes("\n") && !oneLineMarkdownList) {
    const document = createBlankDocument();
    document.title = importTitle;
    document.nodes[document.rootId].text = value;
    return {
      document: adoptRootTextTitle(document, importTitle),
      rootIds: [document.rootId],
    };
  }

  let document: MindMapDocument;
  try {
    document = markdownToDocument(value, importTitle);
  } catch {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 1) {
      document = createBlankDocument();
      document.title = importTitle;
      document.nodes[document.rootId].text = lines[0];
    } else {
      document = markdownToDocument(
        lines.map((line) => `- ${line}`).join("\n"),
        importTitle,
      );
    }
  }

  document = adoptRootTextTitle(document, importTitle);
  return {
    document,
    rootIds: topLevelRootIds(document),
  };
}

export function pasteClipboardForest(
  destination: MindMapDocument,
  destinationId: string,
  forest: ClipboardForest,
): DocumentMutation {
  if (isBlankMindMapDocument(destination)) {
    return {
      document: forest.document,
      selection: singleSelection(forest.document.rootId),
    };
  }
  return pasteSubtrees(
    destination,
    destination.nodes[destinationId]
      ? destinationId
      : destination.rootId,
    forest.document,
    forest.rootIds,
  );
}
