import { useCallback, useRef } from "react";
import {
  clipboardTextToForest,
  pasteClipboardForest,
  type ClipboardForest,
} from "../model/clipboard";
import {
  isBlankMindMapDocument,
  topLevelRootIds,
} from "../model/document";
import { subtreeToMarkdown } from "../model/markdown";
import { normalizeSelectedRoots } from "../model/selection";
import {
  deleteSelectedSubtrees,
  type DocumentMutation,
} from "../model/tree";
import { writeTextClipboard } from "../desktop/clipboard";
import type {
  EditorSnapshot,
  MindMapDocument,
  SelectionState,
} from "../types/mindmap";
import type { AppNotice } from "../types/feedback";

interface MindMapClipboardOptions {
  mindMap: MindMapDocument;
  selection: SelectionState;
  applyMutation: (
    mutate: (current: EditorSnapshot) => DocumentMutation,
    expectedDocumentSessionId?: number,
  ) => void;
  documentSessionId: number;
  isDocumentSessionCurrent: (sessionId: number) => boolean;
  notify: (message: AppNotice) => void;
  undo: () => void;
}

interface InternalClipboard {
  markdown: string;
}

async function readClipboard(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export function useMindMapClipboard({
  mindMap,
  selection,
  applyMutation,
  documentSessionId,
  isDocumentSessionCurrent,
  notify,
  undo,
}: MindMapClipboardOptions) {
  const clipboardRef = useRef<InternalClipboard | null>(null);
  const mindMapRef = useRef(mindMap);
  const selectionRef = useRef(selection);
  mindMapRef.current = mindMap;
  selectionRef.current = selection;

  const copyRoots = useCallback(
    async (
      roots: string[],
      expectedDocumentSessionId?: number,
    ): Promise<boolean> => {
      if (roots.length === 0) {
        notify({ message: "请先选择节点" });
        return false;
      }
      const markdown = roots
        .map((id) => subtreeToMarkdown(mindMap, id))
        .join("\n");
      const copied = await writeTextClipboard(markdown);
      if (
        expectedDocumentSessionId !== undefined &&
        !isDocumentSessionCurrent(expectedDocumentSessionId)
      ) {
        return false;
      }
      if (!copied) {
        notify({ message: "无法写入系统剪贴板", tone: "error" });
        return false;
      }
      clipboardRef.current = {
        markdown,
      };
      return true;
    },
    [isDocumentSessionCurrent, mindMap, notify],
  );

  const copyMarkdown = useCallback(
    async (rootId?: string) => {
      const roots = rootId
        ? [rootId]
        : normalizeSelectedRoots(mindMap, selection.selectedIds);
      if (!(await copyRoots(roots))) return;
      notify({
        message:
          roots.length === 1 && roots[0] === mindMap.rootId
            ? "已复制整张图为 Markdown"
            : roots.length === 1
              ? "已复制当前分支为 Markdown"
              : `已复制 ${roots.length} 个分支为 Markdown`,
      });
    },
    [copyRoots, mindMap.rootId, notify, selection.selectedIds],
  );

  const copyDocumentMarkdown = useCallback(async () => {
    if (!(await copyRoots(topLevelRootIds(mindMap)))) return;
    notify({ message: "已复制整张图为 Markdown" });
  }, [copyRoots, mindMap, notify]);

  const cutSelection = useCallback(async () => {
    const operationSessionId = documentSessionId;
    const roots = normalizeSelectedRoots(
      mindMap,
      selection.selectedIds.filter((id) => id !== mindMap.rootId),
    );
    if (roots.length === 0) {
      notify({
        message: selection.selectedIds.includes(mindMap.rootId)
          ? "根节点不能剪切"
          : "请先选择节点",
      });
      return;
    }
    if (!(await copyRoots(roots, operationSessionId))) return;
    if (!isDocumentSessionCurrent(operationSessionId)) return;
    applyMutation(
      (current) =>
        deleteSelectedSubtrees(current.document, {
          primaryId: roots[0],
          selectedIds: roots,
        }),
      operationSessionId,
    );
    if (!isDocumentSessionCurrent(operationSessionId)) return;
    notify({
      message:
        roots.length === 1
          ? "已剪切节点"
          : `已剪切 ${roots.length} 个分支`,
      actionLabel: "撤销",
      onAction: undo,
    });
  }, [
    applyMutation,
    copyRoots,
    documentSessionId,
    isDocumentSessionCurrent,
    mindMap,
    notify,
    selection.selectedIds,
    undo,
  ]);

  const readClipboardForest = useCallback(
    async (
      expectedDocumentSessionId: number,
    ): Promise<ClipboardForest | null> => {
      const clipboardText = await readClipboard();
      if (!isDocumentSessionCurrent(expectedDocumentSessionId)) {
        return null;
      }
      const internal = clipboardRef.current;
      const value = clipboardText?.trim()
        ? clipboardText
        : internal?.markdown;
      if (!value?.trim()) {
        notify({ message: "剪贴板中没有可粘贴的节点" });
        return null;
      }
      try {
        return clipboardTextToForest(value);
      } catch (error) {
        notify({
          message:
            error instanceof Error
              ? error.message
              : "剪贴板内容无法粘贴为节点",
          tone: "error",
        });
        return null;
      }
    },
    [isDocumentSessionCurrent, notify],
  );

  const pasteClipboard = useCallback(async () => {
    const operationSessionId = documentSessionId;
    const forest = await readClipboardForest(operationSessionId);
    if (!forest) return;
    if (!isDocumentSessionCurrent(operationSessionId)) return;
    const currentDocument = mindMapRef.current;
    const currentSelection = selectionRef.current;
    const destinationId =
      currentSelection.primaryId ?? currentDocument.rootId;
    const roots = forest.rootIds;

    const replacingBlankDocument =
      isBlankMindMapDocument(currentDocument);
    applyMutation(
      (current) =>
        pasteClipboardForest(current.document, destinationId, forest),
      operationSessionId,
    );
    if (!isDocumentSessionCurrent(operationSessionId)) return;
    notify({
      message:
        replacingBlankDocument
          ? "已从 Markdown 生成思维导图"
          : roots.length === 1
            ? "已粘贴节点"
            : `已粘贴 ${roots.length} 个分支`,
      actionLabel: "撤销",
      onAction: undo,
    });
  }, [
    applyMutation,
    documentSessionId,
    isDocumentSessionCurrent,
    notify,
    readClipboardForest,
    undo,
  ]);

  return {
    copyDocumentMarkdown,
    copyMarkdown,
    cutSelection,
    pasteClipboard,
  };
}
