import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { CommandId } from "../commands/registry";
import type {
  CanvasHandle,
} from "../components/canvas/MindMapCanvas";
import type {
  OverlayMode,
} from "../components/commands/CommandOverlay";
import { createBlankDocument } from "../data/seed";
import { subtreeToMarkdown } from "../model/markdown";
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

interface ToastMessage {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface MindMapCommandOptions {
  mindMap: MindMapDocument;
  selection: SelectionState;
  canUndo: boolean;
  canRedo: boolean;
  canvasRef: RefObject<CanvasHandle | null>;
  editAfterMutation: RefObject<boolean>;
  applyMutation: (
    mutate: (current: EditorSnapshot) => DocumentMutation,
  ) => void;
  replaceDocument: (document: MindMapDocument) => void;
  selectNode: (id: string) => void;
  setSelection: (selection: SelectionState) => void;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setOverlay: Dispatch<SetStateAction<OverlayMode | null>>;
  notify: (message: ToastMessage) => void;
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

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export function useMindMapCommands({
  mindMap,
  selection,
  canUndo,
  canRedo,
  canvasRef,
  editAfterMutation,
  applyMutation,
  replaceDocument,
  selectNode,
  setSelection,
  setEditingId,
  setDraft,
  setOverlay,
  notify,
  undo,
  redo,
}: MindMapCommandOptions) {
  const selectedId = selection.primaryId;
  const hasSingleSelection =
    selection.selectedIds.length === 1 && selectedId !== null;

  const createAndEdit = useCallback(
    (
      mutate: Parameters<typeof applyMutation>[0],
      feedback: string,
    ) => {
      editAfterMutation.current = true;
      applyMutation(mutate);
      notify({ message: feedback, actionLabel: "撤销", onAction: undo });
    },
    [applyMutation, editAfterMutation, notify, undo],
  );

  const copyMarkdown = useCallback(
    async (rootId?: string) => {
      const roots = rootId
        ? [rootId]
        : normalizeSelectedRoots(mindMap, selection.selectedIds);
      if (roots.length === 0) return;
      const markdown = roots
        .map((id) => subtreeToMarkdown(mindMap, id))
        .join("\n");
      await writeClipboard(markdown);
      notify({
        message:
          roots.length === 1 && roots[0] === mindMap.rootId
            ? "已复制整张图为 Markdown"
            : roots.length === 1
              ? "已复制当前分支为 Markdown"
              : `已复制 ${roots.length} 个分支为 Markdown`,
      });
    },
    [mindMap, notify, selection.selectedIds],
  );

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
            (current) =>
              createSibling(
                current.document,
                current.selection.primaryId!,
                "below",
              ),
            "已创建同级节点",
          );
          break;
        case "node.create-above":
          createAndEdit(
            (current) =>
              createSibling(
                current.document,
                current.selection.primaryId!,
                "above",
              ),
            "已创建上方节点",
          );
          break;
        case "node.create-child":
          createAndEdit(
            (current) =>
              createChild(
                current.document,
                current.selection.primaryId!,
              ),
            "已创建子节点",
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
        case "map.new": {
          const blank = createBlankDocument();
          replaceDocument(blank);
          setEditingId(blank.rootId);
          setDraft("");
          notify({
            message: "已新建空白思维",
            actionLabel: "撤销",
            onAction: undo,
          });
          break;
        }
        case "map.search":
          setOverlay("search");
          break;
        case "map.command-palette":
          setOverlay("commands");
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
      createAndEdit,
      hasSingleSelection,
      mindMap,
      notify,
      redo,
      replaceDocument,
      selectNode,
      selectedId,
      selection,
      setDraft,
      setEditingId,
      setOverlay,
      setSelection,
      undo,
    ],
  );

  return { copyMarkdown, executeCommand };
}
