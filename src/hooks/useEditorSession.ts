import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { listenForWindowFocusChange } from "../desktop/applicationLifecycle";
import { isBlankMindMapDocument } from "../model/document";
import { parseMarkdownDocument } from "../model/markdown";
import { isDesktopRuntime } from "../persistence/localDocumentStore";
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
  commitEdit: (id: string, value: string) => void;
  cancelEdit: (id: string) => void;
  toggleNode: (id: string) => void;
  detachNodeToCanvas: (
    id: string,
    position: { x: number; y: number },
  ) => void;
  attachNodeToParent: (
    id: string,
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
    setEditingId(rootId);
    setDraft("");
  }, []);

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

  useEffect(() => {
    if (!editingId) return;
    let active = true;
    let unlistenNativeFocus: (() => void) | undefined;
    const finishEditingForFocusLoss = () => {
      const id = editingIdRef.current;
      if (!id) return;
      const activeElement = globalThis.document.activeElement;
      if (
        activeElement instanceof HTMLTextAreaElement &&
        activeElement.classList.contains("mind-node__editor")
      ) {
        commitEdit(id, activeElement.value);
        return;
      }
      commitEdit(id, draftRef.current);
    };
    const handleVisibilityChange = () => {
      if (globalThis.document.visibilityState === "hidden") {
        finishEditingForFocusLoss();
      }
    };
    const handleWindowBlur = () => finishEditingForFocusLoss();

    globalThis.window.addEventListener("blur", handleWindowBlur);
    globalThis.document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    if (isDesktopRuntime()) {
      void listenForWindowFocusChange((focused) => {
        if (active && !focused) finishEditingForFocusLoss();
      })
        .then((unlisten) => {
          if (active) unlistenNativeFocus = unlisten;
          else unlisten();
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
      unlistenNativeFocus?.();
      globalThis.window.removeEventListener("blur", handleWindowBlur);
      globalThis.document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [commitEdit, editingId]);

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
    (id: string, parentId: string, position: number) => {
      const currentDocument = documentRef.current;
      const current = currentDocument.nodes[id];
      const parent = currentDocument.nodes[parentId];
      if (!current || !parent) return;
      const siblings = parent.children.filter((childId) => childId !== id);
      const insertAt = Math.max(0, Math.min(position, siblings.length));
      siblings.splice(insertAt, 0, id);
      const unchanged =
        current.parentId === parentId &&
        !parent.collapsed &&
        siblings.every(
          (childId, index) => parent.children[index] === childId,
        );
      if (unchanged) return;
      const parentText = currentDocument.nodes[parentId]?.text;
      applyMutation((current) =>
        attachSubtree(current.document, id, parentId, insertAt),
      );
      notify({
        message:
          current.parentId === parentId
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
      const parsed = parseMarkdownDocument(value, "粘贴内容");
      cancelledEdit.current = id;
      setEditingId(null);
      setDraft("");
      applyMutation(() => ({
        document: parsed.document,
        selection: singleSelection(parsed.document.rootId),
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
    commitEdit,
    cancelEdit,
    toggleNode,
    detachNodeToCanvas,
    attachNodeToParent,
    editSelectedFromSpace,
    pasteStructuredIntoBlankRoot,
  };
}
