import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { CanvasHandle } from "../components/canvas/MindMapCanvas";
import { isBlankMindMapDocument } from "../model/document";
import { parseMarkdownDocument } from "../model/markdown";
import { singleSelection } from "../model/selection";
import {
  attachSubtree,
  detachSubtree,
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
  canvasRef: RefObject<CanvasHandle | null>;
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
  setEditingId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  beginEdit: (id: string, replacement?: string) => void;
  beginBlankDocument: (rootId: string) => void;
  finishDocumentSwitch: (fitContent: boolean) => void;
  commitEdit: (id: string, value: string) => void;
  cancelEdit: (id: string) => void;
  toggleNode: (id: string) => void;
  detachNodeToCanvas: (
    id: string,
    position: { x: number; y: number },
  ) => void;
  attachNodeToParent: (id: string, parentId: string) => void;
  editSelectedFromSpace: () => void;
  pasteStructuredIntoBlankRoot: (id: string, value: string) => boolean;
}

export function useEditorSession({
  document,
  selection,
  canvasRef,
  applyMutation,
  selectNode,
  notify,
  undo,
}: EditorSessionOptions): EditorSession {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cancelledEdit = useRef<string | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;

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
    setEditingId(rootId);
    setDraft("");
  }, []);

  const finishDocumentSwitch = useCallback(
    (fitContent: boolean) => {
      cancelledEdit.current = null;
      setEditingId(null);
      setDraft("");
      if (fitContent) {
        window.setTimeout(() => canvasRef.current?.fit(), 0);
      }
    },
    [canvasRef],
  );

  const commitEdit = useCallback(
    (id: string, value: string) => {
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

  const cancelEdit = useCallback((id: string) => {
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
    (id: string, position: { x: number; y: number }) => {
      const existing = documentRef.current.floatingRoots.find(
        (root) => root.id === id,
      );
      if (
        existing &&
        existing.x === Math.max(32, Math.round(position.x)) &&
        existing.y === Math.max(32, Math.round(position.y))
      ) {
        return;
      }
      applyMutation((current) =>
        detachSubtree(current.document, id, position),
      );
      notify({
        message: "已移到画布空白处",
        actionLabel: "撤销",
        onAction: undo,
      });
    },
    [applyMutation, notify, undo],
  );

  const attachNodeToParent = useCallback(
    (id: string, parentId: string) => {
      const currentDocument = documentRef.current;
      if (currentDocument.nodes[id]?.parentId === parentId) return;
      const parentText = currentDocument.nodes[parentId]?.text;
      applyMutation((current) =>
        attachSubtree(current.document, id, parentId),
      );
      notify({
        message: parentText
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
      const parsed = parseMarkdownDocument(value, "粘贴内容");
      cancelledEdit.current = id;
      setEditingId(null);
      setDraft("");
      applyMutation(() => ({
        document: parsed.document,
        selection: singleSelection(parsed.document.rootId),
      }));
      notify({ message: "已从 Markdown 生成思维导图" });
      window.setTimeout(() => canvasRef.current?.fit(), 0);
      return true;
    },
    [applyMutation, canvasRef, notify],
  );

  return {
    editingId,
    draft,
    setEditingId,
    setDraft,
    beginEdit,
    beginBlankDocument,
    finishDocumentSwitch,
    commitEdit,
    cancelEdit,
    toggleNode,
    detachNodeToCanvas,
    attachNodeToParent,
    editSelectedFromSpace,
    pasteStructuredIntoBlankRoot,
  };
}
