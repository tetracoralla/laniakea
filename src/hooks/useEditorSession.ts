import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  adoptRootTextTitle,
  importedPasteTitle,
} from "../model/clipboard";
import { isBlankMindMapDocument } from "../model/document";
import { parseMarkdownDocument } from "../model/markdown";
import { singleSelection } from "../model/selection";
import {
  attachSubtrees,
  detachSubtrees,
  normalizeNodeText,
  setNodeText,
  toggleCollapsed,
  type DocumentMutation,
} from "../model/tree";
import type { AppNotice } from "../types/feedback";
import type {
  EditorSnapshot,
  MindMapDocument,
  SelectionState,
} from "../types/mindmap";

interface EditorSessionOptions {
  document: MindMapDocument;
  selection: SelectionState;
  applyMutation: (
    mutate: (current: EditorSnapshot) => DocumentMutation,
  ) => void;
  selectNode: (id: string) => void;
  notify: (notice: AppNotice) => void;
  undo: () => void;
}

interface EditorSession {
  editingId: string | null;
  draft: string;
  fitRequest: number;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  beginEdit: (id: string, replacement?: string) => void;
  beginBlankDocument: (rootId: string) => void;
  finishDocumentSwitch: (fitContent: boolean) => void;
  finishEdit: () => void;
  commitEdit: (id: string, value: string) => void;
  cancelEdit: (id: string) => void;
  toggleNode: (id: string) => void;
  detachNodeToCanvas: (
    positions: readonly { id: string; x: number; y: number }[],
  ) => void;
  attachNodeToParent: (
    ids: readonly string[],
    parentId: string,
    position: number,
  ) => void;
  editSelectedFromSpace: () => void;
  pasteStructuredIntoBlankRoot: (id: string, value: string) => boolean;
}

export function useEditorSession({
  document,
  selection,
  applyMutation,
  selectNode,
  notify,
  undo,
}: EditorSessionOptions): EditorSession {
  const [editingId, setEditingIdState] = useState<string | null>(null);
  const [draft, setDraftState] = useState("");
  const [fitRequest, setFitRequest] = useState(0);
  const editingIdRef = useRef<string | null>(null);
  const draftRef = useRef("");
  const cancelledEdit = useRef<string | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;
  editingIdRef.current = editingId;
  draftRef.current = draft;

  const setEditingId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (next) => {
      const value =
        typeof next === "function" ? next(editingIdRef.current) : next;
      editingIdRef.current = value;
      setEditingIdState(value);
    },
    [],
  );
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => {
      const value = typeof next === "function" ? next(draftRef.current) : next;
      draftRef.current = value;
      setDraftState(value);
    },
    [],
  );

  const beginEdit = useCallback(
    (id: string, replacement?: string) => {
      const node = documentRef.current.nodes[id];
      if (!node) return;
      selectNode(id);
      cancelledEdit.current = null;
      setEditingId(id);
      setDraft(replacement ?? node.text);
    },
    [selectNode],
  );

  const beginBlankDocument = useCallback((rootId: string) => {
    cancelledEdit.current = null;
    selectNode(rootId);
    setEditingId(rootId);
    setDraft("");
    // 空白稿没有可恢复的视口：请求一次画布 fit，把唯一的主原点居中呈现。
    // 令牌由画布挂载后的 layout effect 消费，早于挂载发出也不会丢失。
    setFitRequest((current) => current + 1);
  }, [selectNode]);

  const finishDocumentSwitch = useCallback((fitContent: boolean) => {
    cancelledEdit.current = null;
    setEditingId(null);
    setDraft("");
    if (fitContent) setFitRequest((current) => current + 1);
  }, []);

  const commitEdit = useCallback(
    (id: string, value: string) => {
      if (editingIdRef.current !== id) return;
      if (cancelledEdit.current === id) {
        cancelledEdit.current = null;
        return;
      }
      const current = documentRef.current.nodes[id];
      const nextText = normalizeNodeText(value);
      setEditingId((editing) => (editing === id ? null : editing));
      if (!current || current.text === nextText) return;
      applyMutation((currentSnapshot) =>
        setNodeText(currentSnapshot.document, id, nextText),
      );
    },
    [applyMutation],
  );

  const finishEdit = useCallback(() => {
    const id = editingIdRef.current;
    if (id) commitEdit(id, draftRef.current);
  }, [commitEdit]);

  const cancelEdit = useCallback((id: string) => {
    if (editingIdRef.current !== id) return;
    cancelledEdit.current = id;
    setEditingId((editing) => (editing === id ? null : editing));
  }, []);

  const toggleNode = useCallback(
    (id: string) =>
      applyMutation((current) =>
        toggleCollapsed(current.document, id),
      ),
    [applyMutation],
  );

  const detachNodeToCanvas = useCallback(
    (positions: readonly { id: string; x: number; y: number }[]) => {
      if (positions.length === 0) return;
      const currentDocument = documentRef.current;
      const unchanged = positions.every((position) => {
        const existing = currentDocument.floatingRoots.find(
          (root) => root.id === position.id,
        );
        return (
          existing &&
          existing.x === Math.round(position.x) &&
          existing.y === Math.round(position.y)
        );
      });
      if (unchanged) {
        return;
      }
      applyMutation((current) =>
        detachSubtrees(current.document, positions, current.selection),
      );
      notify({
        message:
          positions.length === 1
            ? "已移到画布空白处"
            : `已将 ${positions.length} 个分支移到画布空白处`,
        actionLabel: "撤销",
        onAction: undo,
      });
    },
    [applyMutation, notify, undo],
  );

  const attachNodeToParent = useCallback(
    (ids: readonly string[], parentId: string, position: number) => {
      const currentDocument = documentRef.current;
      const parent = currentDocument.nodes[parentId];
      const roots = ids.filter((id) => currentDocument.nodes[id]);
      if (roots.length === 0 || !parent) return;
      const rootSet = new Set(roots);
      const siblings = parent.children.filter(
        (childId) => !rootSet.has(childId),
      );
      const insertAt = Math.max(0, Math.min(position, siblings.length));
      siblings.splice(insertAt, 0, ...roots);
      const unchanged =
        roots.every(
          (id) => currentDocument.nodes[id]?.parentId === parentId,
        ) &&
        !parent.collapsed &&
        siblings.length === parent.children.length &&
        siblings.every(
          (childId, index) => parent.children[index] === childId,
        );
      if (unchanged) return;
      const parentText = currentDocument.nodes[parentId]?.text;
      applyMutation((current) =>
        attachSubtrees(
          current.document,
          roots,
          parentId,
          insertAt,
          current.selection,
        ),
      );
      notify({
        message:
          roots.length > 1
            ? roots.every(
                (id) => currentDocument.nodes[id]?.parentId === parentId,
              )
              ? `已调整 ${roots.length} 个同级分支的顺序`
              : parentText
                ? `已将 ${roots.length} 个分支移入“${parentText}”`
                : `已将 ${roots.length} 个分支移入新的父节点`
            : currentDocument.nodes[roots[0]]?.parentId === parentId
              ? "已调整同级顺序"
            : parentText
              ? `已移入“${parentText}”`
              : "已移入新的父节点",
        actionLabel: "撤销",
        onAction: undo,
      });
    },
    [applyMutation, notify, undo],
  );

  const selectedId = selection.primaryId;
  const hasSingleSelection =
    selection.selectedIds.length === 1 && selectedId !== null;
  const editSelectedFromSpace = useCallback(() => {
    if (hasSingleSelection && selectedId) beginEdit(selectedId);
  }, [beginEdit, hasSingleSelection, selectedId]);

  const pasteStructuredIntoBlankRoot = useCallback(
    (id: string, value: string): boolean => {
      const currentDocument = documentRef.current;
      if (
        id !== currentDocument.rootId ||
        !isBlankMindMapDocument(currentDocument) ||
        !value.trim() ||
        !value.includes("\n")
      ) {
        return false;
      }
      const parsed = parseMarkdownDocument(value, importedPasteTitle);
      const document = adoptRootTextTitle(parsed.document, importedPasteTitle);
      cancelledEdit.current = id;
      setEditingId(null);
      setDraft("");
      applyMutation(() => ({
        document,
        selection: singleSelection(document.rootId),
      }));
      notify({ message: "已从 Markdown 生成思维导图" });
      setFitRequest((current) => current + 1);
      return true;
    },
    [applyMutation, notify],
  );

  return {
    editingId,
    draft,
    fitRequest,
    setEditingId,
    setDraft,
    beginEdit,
    beginBlankDocument,
    finishDocumentSwitch,
    finishEdit,
    commitEdit,
    cancelEdit,
    toggleNode,
    detachNodeToCanvas,
    attachNodeToParent,
    editSelectedFromSpace,
    pasteStructuredIntoBlankRoot,
  };
}
