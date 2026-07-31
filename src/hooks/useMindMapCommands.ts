import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import type { CommandId } from "../commands/registry";
import type {
  CanvasHandle,
} from "../components/canvas/MindMapCanvas";
import type {
  OverlayMode,
} from "../components/commands/CommandOverlay";
import {
  addToSelection,
  createSelection,
  emptySelection,
  normalizeSelectedRoots,
  visibleNodeIds,
} from "../model/selection";
import {
  adjacentSibling,
  createChild,
  createNodeId,
  createSibling,
  deleteNodePreserveChildren,
  deleteSelectedSubtrees,
  firstChildOf,
  moveNode,
  outdentNode,
  parentOf,
  setAllCollapsed,
  toggleCollapsedMany,
  type DocumentMutation,
} from "../model/tree";
import type {
  EditorSnapshot,
  MindMapDocument,
  SelectionState,
} from "../types/mindmap";
import type { AppNotice } from "../types/feedback";
import { useMindMapClipboard } from "./useMindMapClipboard";

interface MindMapCommandOptions {
  mindMap: MindMapDocument;
  selection: SelectionState;
  canUndo: boolean;
  canRedo: boolean;
  canvasRef: RefObject<CanvasHandle | null>;
  applyMutation: (
    mutate: (current: EditorSnapshot) => DocumentMutation,
    expectedDocumentSessionId?: number,
  ) => void;
  documentSessionId: number;
  isDocumentSessionCurrent: (sessionId: number) => boolean;
  selectNode: (id: string) => void;
  setSelection: (selection: SelectionState) => void;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  openOverlay: (mode: OverlayMode) => void;
  notify: (message: AppNotice) => void;
  onImport: () => void;
  onNew: () => void;
  onSaveAs: () => void;
  saveNow: () => Promise<boolean>;
  undo: () => void;
  redo: () => void;
}

const singleSelectionCommands = new Set<CommandId>([
  "node.create-sibling",
  "node.create-above",
  "node.create-child",
  "node.outdent",
  "node.delete-preserve",
  "node.move-up",
  "node.move-down",
]);

export function useMindMapCommands({
  mindMap,
  selection,
  canUndo,
  canRedo,
  canvasRef,
  applyMutation,
  documentSessionId,
  isDocumentSessionCurrent,
  selectNode,
  setSelection,
  setEditingId,
  setDraft,
  openOverlay,
  notify,
  onImport,
  onNew,
  onSaveAs,
  saveNow,
  undo,
  redo,
}: MindMapCommandOptions) {
  const selectedId = selection.primaryId;
  const hasSingleSelection =
    selection.selectedIds.length === 1 && selectedId !== null;

  const createAndEdit = useCallback(
    (
      mutate: (
        current: EditorSnapshot,
        createdId: string,
      ) => DocumentMutation,
    ) => {
      const createdId = createNodeId();
      // Commit the node and its editor before this key event returns. This
      // keeps the next keystroke in a rapid Tab/Enter sequence inside the new
      // editor instead of letting the canvas-level handler consume it.
      flushSync(() => {
        setEditingId(createdId);
        setDraft("");
        applyMutation((current) => mutate(current, createdId));
      });
    },
    [applyMutation, setDraft, setEditingId],
  );

  const {
    copyDocumentMarkdown,
    copyMarkdown,
    cutSelection,
    pasteClipboard,
  } = useMindMapClipboard({
      mindMap,
      selection,
      applyMutation,
      documentSessionId,
      isDocumentSessionCurrent,
      notify,
      undo,
    });

  const executeCommand = useCallback(
    (id: CommandId) => {
      setEditingId(null);
      if (singleSelectionCommands.has(id) && !hasSingleSelection) {
        notify({ message: "请先只选择一个节点" });
        return;
      }

      switch (id) {
        case "node.create-sibling":
          createAndEdit(
            (current, createdId) =>
              createSibling(
                current.document,
                current.selection.primaryId!,
                "below",
                "",
                createdId,
              ),
          );
          break;
        case "node.create-above":
          createAndEdit(
            (current, createdId) =>
              createSibling(
                current.document,
                current.selection.primaryId!,
                "above",
                "",
                createdId,
              ),
          );
          break;
        case "node.create-child":
          createAndEdit(
            (current, createdId) =>
              createChild(
                current.document,
                current.selection.primaryId!,
                "",
                createdId,
              ),
          );
          break;
        case "node.outdent":
          applyMutation((current) =>
            outdentNode(
              current.document,
              current.selection.primaryId!,
            ),
          );
          break;
        case "node.delete": {
          const deletableRoots = normalizeSelectedRoots(
            mindMap,
            selection.selectedIds.filter(
              (nodeId) => nodeId !== mindMap.rootId,
            ),
          );
          if (deletableRoots.length === 0) {
            if (selection.selectedIds.includes(mindMap.rootId)) {
              notify({ message: "根节点不能删除" });
            }
            break;
          }
          applyMutation((current) =>
            deleteSelectedSubtrees(
              current.document,
              current.selection,
            ),
          );
          notify({
            message:
              deletableRoots.length === 1
                ? "已删除节点"
                : `已删除 ${deletableRoots.length} 个分支`,
            actionLabel: "撤销",
            onAction: undo,
          });
          break;
        }
        case "node.delete-preserve":
          applyMutation((current) =>
            deleteNodePreserveChildren(
              current.document,
              current.selection.primaryId!,
            ),
          );
          notify({
            message: "已删除节点并保留子节点",
            actionLabel: "撤销",
            onAction: undo,
          });
          break;
        case "node.parent": {
          if (!selectedId) {
            selectNode(mindMap.rootId);
            break;
          }
          selectNode(parentOf(mindMap, selectedId) ?? selectedId);
          break;
        }
        case "node.child": {
          if (!selectedId) {
            selectNode(mindMap.rootId);
            break;
          }
          selectNode(firstChildOf(mindMap, selectedId) ?? selectedId);
          break;
        }
        case "node.previous": {
          if (!selectedId) {
            selectNode(mindMap.rootId);
            break;
          }
          selectNode(
            adjacentSibling(mindMap, selectedId, -1) ?? selectedId,
          );
          break;
        }
        case "node.next": {
          if (!selectedId) {
            selectNode(mindMap.rootId);
            break;
          }
          selectNode(
            adjacentSibling(mindMap, selectedId, 1) ?? selectedId,
          );
          break;
        }
        case "selection.extend-parent":
        case "selection.extend-child":
        case "selection.extend-previous":
        case "selection.extend-next": {
          let target: string | null = mindMap.rootId;
          if (selectedId) {
            if (id === "selection.extend-parent") {
              target = parentOf(mindMap, selectedId);
            } else if (id === "selection.extend-child") {
              target = firstChildOf(mindMap, selectedId);
            } else if (id === "selection.extend-previous") {
              target = adjacentSibling(mindMap, selectedId, -1);
            } else {
              target = adjacentSibling(mindMap, selectedId, 1);
            }
          }
          if (target) {
            const order = visibleNodeIds(mindMap);
            const expanded = addToSelection(selection, [target], order);
            setSelection({ ...expanded, primaryId: target });
          }
          break;
        }
        case "selection.select-all": {
          const order = visibleNodeIds(mindMap);
          setSelection(
            createSelection(order, order, selection.primaryId),
          );
          break;
        }
        case "selection.clear":
          setSelection(emptySelection());
          break;
        case "node.copy":
          void copyMarkdown();
          break;
        case "node.cut":
          void cutSelection();
          break;
        case "node.paste":
          void pasteClipboard();
          break;
        case "node.move-up":
          applyMutation((current) =>
            moveNode(
              current.document,
              current.selection.primaryId!,
              -1,
            ),
          );
          break;
        case "node.move-down":
          applyMutation((current) =>
            moveNode(
              current.document,
              current.selection.primaryId!,
              1,
            ),
          );
          break;
        case "node.toggle":
          applyMutation((current) =>
            toggleCollapsedMany(
              current.document,
              current.selection,
            ),
          );
          break;
        case "map.collapse-all":
          applyMutation((current) =>
            setAllCollapsed(
              current.document,
              true,
              current.selection,
            ),
          );
          break;
        case "map.expand-all":
          applyMutation((current) =>
            setAllCollapsed(
              current.document,
              false,
              current.selection,
            ),
          );
          break;
        case "history.undo":
          if (canUndo) undo();
          break;
        case "history.redo":
          if (canRedo) redo();
          break;
        case "map.copy-markdown":
          void copyMarkdown();
          break;
        case "map.new":
          onNew();
          break;
        case "map.open":
          onImport();
          break;
        case "map.save":
          void saveNow();
          break;
        case "map.save-as":
          onSaveAs();
          break;
        case "map.search":
          openOverlay("search");
          break;
        case "map.command-palette":
          openOverlay("commands");
          break;
        case "viewport.fit":
          canvasRef.current?.fit();
          break;
        case "viewport.focus":
          canvasRef.current?.focusSelected();
          break;
        case "viewport.zoom-in":
          canvasRef.current?.zoomIn();
          break;
        case "viewport.zoom-out":
          canvasRef.current?.zoomOut();
          break;
        case "viewport.reset":
          canvasRef.current?.resetZoom();
          break;
      }
    },
    [
      applyMutation,
      canRedo,
      canUndo,
      canvasRef,
      copyMarkdown,
      copyDocumentMarkdown,
      createAndEdit,
      cutSelection,
      hasSingleSelection,
      mindMap,
      notify,
      onImport,
      onNew,
      onSaveAs,
      pasteClipboard,
      redo,
      saveNow,
      selectNode,
      selectedId,
      selection,
      setDraft,
      setEditingId,
      openOverlay,
      setSelection,
      undo,
    ],
  );

  return { copyDocumentMarkdown, copyMarkdown, executeCommand };
}
