import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CanvasHandle,
  MindMapCanvas,
} from "./components/canvas/MindMapCanvas";
import { CanvasControls } from "./components/chrome/CanvasControls";
import { KeyboardHints } from "./components/chrome/KeyboardHints";
import { TopBar } from "./components/chrome/TopBar";
import {
  type OverlayMode,
  CommandOverlay,
} from "./components/commands/CommandOverlay";
import { Toast } from "./components/feedback/Toast";
import { readDesktopRuntimeStatus } from "./desktop/runtime";
import { useKeyboardCommands } from "./hooks/useKeyboardCommands";
import { useMindMap } from "./hooks/useMindMap";
import { useMindMapCommands } from "./hooks/useMindMapCommands";
import { markdownToDocument, subtreeToMarkdown } from "./model/markdown";
import {
  setDocumentTitle,
  setNodeText,
  revealNode,
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
    saveError,
    startupNotice,
    startupMode,
    canUndo,
    canRedo,
    applyMutation,
    replaceDocument,
    selectNode,
    setSelection,
    setViewport,
    retrySave,
    undo,
    redo,
  } = useMindMap();
  const { document: mindMap, selection } = snapshot;
  const selectedId = selection.primaryId;
  const hasSingleSelection =
    selection.selectedIds.length === 1 && selectedId !== null;
  const canvasRef = useRef<CanvasHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editAfterMutation = useRef(false);
  const initialEditStarted = useRef(false);
  const cancelledEdit = useRef<string | null>(null);
  const mindMapRef = useRef(mindMap);
  mindMapRef.current = mindMap;
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
      cancelledEdit.current = null;
      setEditingId(id);
      setDraft(replacement ?? node.text);
    },
    [mindMap.nodes, selectNode],
  );

  useEffect(() => {
    if (startupMode !== "fresh" || initialEditStarted.current) return;
    initialEditStarted.current = true;
    beginEdit(mindMap.rootId, "");
  }, [beginEdit, mindMap.rootId, startupMode]);

  useEffect(() => {
    if (!startupNotice) return;
    notify({ message: startupNotice });
  }, [notify, startupNotice]);

  useEffect(() => {
    if (startupMode === "loading") return;
    void readDesktopRuntimeStatus().then((status) => {
      if (status && !status.globalShortcutRegistered) {
        notify({
          message: `全局快捷键 ${status.globalShortcut.replace("CommandOrControl", "⌘")} 被占用，可继续从 Dock 打开`,
        });
      }
    });
  }, [notify, startupMode]);

  useEffect(() => {
    if (!editAfterMutation.current || !selectedId) return;
    const node = mindMap.nodes[selectedId];
    if (!node) return;
    editAfterMutation.current = false;
    setEditingId(selectedId);
    setDraft(node.text === "新节点" ? "" : node.text);
  }, [mindMap.nodes, selectedId]);

  const { copyMarkdown, executeCommand } = useMindMapCommands({
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
  });

  useKeyboardCommands({
    enabled:
      startupMode !== "loading" &&
      editingId === null &&
      overlay === null,
    onCommand: executeCommand,
    onBeginTyping: (character) => {
      if (hasSingleSelection && selectedId) {
        beginEdit(selectedId, character);
      }
    },
  });

  const commitEdit = useCallback((id: string, value: string) => {
    if (cancelledEdit.current === id) {
      cancelledEdit.current = null;
      return;
    }
    const current = mindMapRef.current.nodes[id];
    const nextText =
      value.trim() ||
      (current?.text === "输入中心主题"
        ? "输入中心主题"
        : "未命名节点");
    setEditingId((editing) => (editing === id ? null : editing));
    if (!current || current.text === nextText) return;
    applyMutation((currentSnapshot) =>
      setNodeText(currentSnapshot.document, id, nextText),
    );
  }, [applyMutation]);

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

  const editSelectedFromSpace = useCallback(() => {
    if (hasSingleSelection && selectedId) beginEdit(selectedId);
  }, [beginEdit, hasSingleSelection, selectedId]);

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
              current.selection,
            ),
          )
        }
        saveState={saveState}
        saveError={saveError}
        onRetrySave={() => void retrySave()}
        title={mindMap.title}
      />

      <MindMapCanvas
        document={mindMap}
        draft={draft}
        editingId={editingId}
        onBeginEdit={beginEdit}
        onCancelEdit={cancelEdit}
        onCommitEdit={commitEdit}
        onDraftChange={setDraft}
        onSelectionChange={setSelection}
        onSpaceTap={editSelectedFromSpace}
        onToggle={toggleNode}
        onViewportChange={setViewport}
        ref={canvasRef}
        selection={selection}
      />

      <KeyboardHints selectionCount={selection.selectedIds.length} />
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
            applyMutation((current) =>
              revealNode(current.document, id),
            );
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(() =>
                canvasRef.current?.focusSelected(),
              ),
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
