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

export function clipboardTextToForest(text: string): ClipboardForest {
  const value = text.trim();
  if (!value) throw new Error("剪贴板中没有可粘贴的内容");

  if (!value.includes("\n")) {
    const document = createBlankDocument();
    document.title = "粘贴内容";
    document.nodes[document.rootId].text = value;
    return { document, rootIds: [document.rootId] };
  }

  let document: MindMapDocument;
  try {
    document = markdownToDocument(value, "粘贴内容");
  } catch {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 1) {
      document = createBlankDocument();
      document.title = "粘贴内容";
      document.nodes[document.rootId].text = lines[0];
    } else {
      document = markdownToDocument(
        lines.map((line) => `- ${line}`).join("\n"),
        "粘贴内容",
      );
    }
  }

  const root = document.nodes[document.rootId];
  if (document.title === "粘贴内容" && root) {
    document.title = root.text;
  }
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
