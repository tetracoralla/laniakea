import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandId } from "./commands/registry";
import {
  type OverlayMode,
  CommandOverlay,
} from "./components/commands/CommandOverlay";
import {
  type CanvasHandle,
  MindMapCanvas,
} from "./components/canvas/MindMapCanvas";
import { CanvasControls } from "./components/chrome/CanvasControls";
import { KeyboardHints } from "./components/chrome/KeyboardHints";
import { TopBar } from "./components/chrome/TopBar";
import { Toast } from "./components/feedback/Toast";
import { createBlankDocument } from "./data/seed";
import { useKeyboardCommands } from "./hooks/useKeyboardCommands";
import { useMindMap } from "./hooks/useMindMap";
import { markdownToDocument, subtreeToMarkdown } from "./model/markdown";
import {
  adjacentSibling,
  createChild,
  createSibling,
  deleteNodePreserveChildren,
  deleteSubtree,
  firstChildOf,
  moveNode,
  outdentNode,
  parentOf,
  setAllCollapsed,
  setDocumentTitle,
  setNodeText,
  toggleCollapsed,
} from "./model/tree";

interface ToastState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "未命名思维";
}

export function App() {
  const {
    snapshot,
    saveState,
    canUndo,
    canRedo,
    applyMutation,
    replaceDocument,
    selectNode,
    setViewport,
    undo,
    redo,
  } = useMindMap();
  const { document: mindMap, selectedId } = snapshot;
  const canvasRef = useRef<CanvasHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editAfterMutation = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [overlay, setOverlay] = useState<OverlayMode | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((next: ToastState) => {
    setToast(next);
    window.setTimeout(() => {
      setToast((current) => (current === next ? null : current));
    }, 4200);
  }, []);

  const beginEdit = useCallback(
    (id: string, replacement?: string) => {
      const node = mindMap.nodes[id];
      if (!node) return;
      selectNode(id);
      setEditingId(id);
      setDraft(replacement ?? node.text);
    },
    [mindMap.nodes, selectNode],
  );

  useEffect(() => {
    if (!editAfterMutation.current) return;
    const node = mindMap.nodes[selectedId];
    if (!node) return;
    editAfterMutation.current = false;
    setEditingId(selectedId);
    setDraft(node.text === "新节点" ? "" : node.text);
  }, [mindMap.nodes, selectedId]);

  const createAndEdit = useCallback(
    (
      mutate: Parameters<typeof applyMutation>[0],
      feedback: string,
    ) => {
      editAfterMutation.current = true;
      applyMutation(mutate);
      notify({ message: feedback, actionLabel: "撤销", onAction: undo });
    },
    [applyMutation, notify, undo],
  );

  const copyMarkdown = useCallback(
    async (rootId = selectedId) => {
      const markdown = subtreeToMarkdown(mindMap, rootId);
      try {
        await navigator.clipboard.writeText(markdown);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = markdown;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      notify({
        message:
          rootId === mindMap.rootId
            ? "已复制整张图为 Markdown"
            : "已复制当前分支为 Markdown",
      });
    },
    [mindMap, notify, selectedId],
  );

  const executeCommand = useCallback(
    (id: CommandId) => {
      setEditingId(null);
      switch (id) {
        case "node.create-sibling":
          createAndEdit(
            (current) =>
              createSibling(
                current.document,
                current.selectedId,
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
                current.selectedId,
                "above",
              ),
            "已创建上方节点",
          );
          break;
        case "node.create-child":
          createAndEdit(
            (current) =>
              createChild(current.document, current.selectedId),
            "已创建子节点",
          );
          break;
        case "node.outdent":
          applyMutation((current) =>
            outdentNode(current.document, current.selectedId),
          );
          break;
        case "node.delete":
          applyMutation((current) =>
            deleteSubtree(current.document, current.selectedId),
          );
          notify({
            message: "已删除节点",
            actionLabel: "撤销",
            onAction: undo,
          });
          break;
        case "node.delete-preserve":
          applyMutation((current) =>
            deleteNodePreserveChildren(
              current.document,
              current.selectedId,
            ),
          );
          notify({
            message: "已删除节点并保留子节点",
            actionLabel: "撤销",
            onAction: undo,
          });
          break;
        case "node.parent": {
          const target = parentOf(mindMap, selectedId);
          if (target) selectNode(target);
          break;
        }
        case "node.child": {
          const target = firstChildOf(mindMap, selectedId);
          if (target) selectNode(target);
          break;
        }
        case "node.previous": {
          const target = adjacentSibling(mindMap, selectedId, -1);
          if (target) selectNode(target);
          break;
        }
        case "node.next": {
          const target = adjacentSibling(mindMap, selectedId, 1);
          if (target) selectNode(target);
          break;
        }
        case "node.move-up":
          applyMutation((current) =>
            moveNode(current.document, current.selectedId, -1),
          );
          break;
        case "node.move-down":
          applyMutation((current) =>
            moveNode(current.document, current.selectedId, 1),
          );
          break;
        case "node.toggle":
          applyMutation((current) =>
            toggleCollapsed(current.document, current.selectedId),
          );
          break;
        case "map.collapse-all":
          applyMutation((current) =>
            setAllCollapsed(
              current.document,
              true,
              current.selectedId,
            ),
          );
          break;
        case "map.expand-all":
          applyMutation((current) =>
            setAllCollapsed(
              current.document,
              false,
              current.selectedId,
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
      copyMarkdown,
      createAndEdit,
      mindMap,
      notify,
      redo,
      replaceDocument,
      selectNode,
      selectedId,
      undo,
    ],
  );

  useKeyboardCommands({
    enabled: editingId === null && overlay === null,
    onCommand: executeCommand,
    onBeginTyping: (character) =>
      beginEdit(selectedId, character === " " ? undefined : character),
  });

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const current = mindMap.nodes[editingId];
    const nextText = draft.trim() || "未命名节点";
    setEditingId(null);
    if (!current || current.text === nextText) return;
    applyMutation((snapshot) =>
      setNodeText(snapshot.document, editingId, nextText),
    );
  }, [applyMutation, draft, editingId, mindMap.nodes]);

  const importMarkdown = async (file: File) => {
    try {
      const content = await file.text();
      const title = file.name.replace(/\.(md|markdown|txt)$/i, "");
      const imported = markdownToDocument(content, title);
      replaceDocument(imported);
      notify({
        message: `已导入 ${Object.keys(imported.nodes).length} 个节点`,
        actionLabel: "撤销",
        onAction: undo,
      });
      window.setTimeout(() => canvasRef.current?.fit(), 0);
    } catch (error) {
      notify({
        message:
          error instanceof Error ? error.message : "无法导入这个文件",
      });
    }
  };

  return (
    <main className="app-shell">
      <TopBar
        onExport={() => void copyMarkdown(mindMap.rootId)}
        onExportMarkdown={() =>
          downloadText(
            `${safeFilename(mindMap.title)}.md`,
            subtreeToMarkdown(mindMap),
            "text/markdown;charset=utf-8",
          )
        }
        onExportJson={() =>
          downloadText(
            `${safeFilename(mindMap.title)}.mindmap.json`,
            JSON.stringify(mindMap, null, 2),
            "application/json;charset=utf-8",
          )
        }
        onImport={() => importInputRef.current?.click()}
        onNew={() => executeCommand("map.new")}
        onSearch={() => setOverlay("search")}
        onTitleChange={(title) =>
          applyMutation((current) =>
            setDocumentTitle(
              current.document,
              title,
              current.selectedId,
            ),
          )
        }
        saveState={saveState}
        title={mindMap.title}
      />

      <MindMapCanvas
        document={mindMap}
        draft={draft}
        editingId={editingId}
        onBeginEdit={(id) => beginEdit(id)}
        onCancelEdit={() => setEditingId(null)}
        onCommitEdit={commitEdit}
        onDraftChange={setDraft}
        onSelect={selectNode}
        onToggle={(id) =>
          applyMutation((current) =>
            toggleCollapsed(current.document, id),
          )
        }
        onViewportChange={setViewport}
        ref={canvasRef}
        selectedId={selectedId}
      />

      <KeyboardHints />
      <CanvasControls
        onFit={() => canvasRef.current?.fit()}
        onReset={() => canvasRef.current?.resetZoom()}
        onZoomIn={() => canvasRef.current?.zoomIn()}
        onZoomOut={() => canvasRef.current?.zoomOut()}
        zoom={mindMap.viewport.zoom}
      />

      {toast && (
        <Toast
          actionLabel={toast.actionLabel}
          message={toast.message}
          onAction={toast.onAction}
        />
      )}

      {overlay && (
        <CommandOverlay
          document={mindMap}
          mode={overlay}
          onClose={() => setOverlay(null)}
          onExecute={executeCommand}
          onSelectNode={(id) => {
            selectNode(id);
            window.setTimeout(
              () => canvasRef.current?.focusSelected(),
              0,
            );
          }}
        />
      )}

      <input
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importMarkdown(file);
          event.currentTarget.value = "";
        }}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />
    </main>
  );
}
