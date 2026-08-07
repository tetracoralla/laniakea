import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  type CanvasHandle,
  MindMapCanvas,
} from "./components/canvas/MindMapCanvas";
import {
  CanvasControls,
  type CanvasControlsHandle,
} from "./components/chrome/CanvasControls";
import { TopBar } from "./components/chrome/TopBar";
import {
  type OverlayMode,
  CommandOverlay,
} from "./components/commands/CommandOverlay";
import { StatusBar } from "./components/feedback/StatusBar";
import { restoreFocus } from "./components/overlays/focus";
import { ShortcutSettings } from "./components/settings/ShortcutSettings";
import {
  readDesktopRuntimeStatus,
  updateDesktopGlobalShortcut,
  type DesktopRuntimeStatus,
} from "./desktop/runtime";
import { displayGlobalShortcut } from "./desktop/shortcut";
import { useAppNotice } from "./hooks/useAppNotice";
import { useBrowserStorageNotice } from "./hooks/useBrowserStorageNotice";
import { useDocumentWorkflow } from "./hooks/useDocumentWorkflow";
import { useEditorSession } from "./hooks/useEditorSession";
import { useKeyboardCommands } from "./hooks/useKeyboardCommands";
import { useMindMap } from "./hooks/useMindMap";
import { useMindMapCommands } from "./hooks/useMindMapCommands";
import {
  isDesktopRuntime,
} from "./persistence/localDocumentStore";
import {
  setDocumentTitle,
  revealNode,
} from "./model/tree";

export function App() {
  const desktopRuntime = isDesktopRuntime();
  const prepareForLifecycleSave = useCallback(() => {
    flushSync(() => {
      const activeElement = globalThis.document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
    });
  }, []);
  const {
    snapshot,
    documentPath,
    sourceDocumentPath,
    protectedBrowserSourceName,
    documentSessionId,
    saveState,
    saveError,
    saveWarning,
    startupNotice,
    startupMode,
    recentDocuments,
    canUndo,
    canRedo,
    applyMutation,
    isDocumentSessionCurrent,
    newDocument,
    openDocument,
    moveRecentDocument,
    deleteBrowserDocument,
    removeRecentDocument,
    replaceDocument,
    saveDocumentAs,
    selectNode,
    setSelection,
    setViewport,
    retrySave,
    preserveCurrentAsBrowserCopy,
    refreshBrowserDocuments,
    restoreActiveDocument,
    saveBeforeSwitch,
    undo,
    redo,
  } = useMindMap({ prepareForLifecycleSave });
  const { document: mindMap, selection } = snapshot;
  const selectedId = selection.primaryId;
  const hasSingleSelection =
    selection.selectedIds.length === 1 && selectedId !== null;
  const canvasRef = useRef<CanvasHandle>(null);
  const canvasControlsRef = useRef<CanvasControlsHandle>(null);
  const showZoomPreview = useCallback((zoom: number) => {
    canvasControlsRef.current?.showZoom(zoom);
  }, []);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const initialEditStarted = useRef(false);
  const [overlay, setOverlay] = useState<OverlayMode | null>(null);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] =
    useState(false);
  const [desktopRuntimeStatus, setDesktopRuntimeStatus] =
    useState<DesktopRuntimeStatus | null>(null);
  const {
    announcement,
    notify,
    dismiss: dismissAnnouncement,
    pause: pauseAnnouncement,
    resume: resumeAnnouncement,
  } = useAppNotice();
  useBrowserStorageNotice({
    announcement,
    desktopRuntime,
    notify,
    saveState,
  });
  const {
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
  } = useEditorSession({
    document: mindMap,
    selection,
    canvasRef,
    applyMutation,
    selectNode,
    notify,
    undo,
  });
  const openOverlay = useCallback((
    mode: OverlayMode,
    returnFocus?: HTMLElement | null,
  ) => {
    const active = document.activeElement;
    overlayReturnFocusRef.current =
      returnFocus ??
      (active instanceof HTMLElement &&
      active !== document.body
        ? active
        : null);
    setOverlay(mode);
  }, []);

  const closeOverlay = useCallback(() => {
    const returnFocus = overlayReturnFocusRef.current;
    overlayReturnFocusRef.current = null;
    setOverlay(null);
    restoreFocus(
      returnFocus,
      () => canvasRef.current?.focusCanvas(),
    );
  }, []);

  const openShortcutSettings = useCallback((returnFocus: HTMLElement) => {
    settingsReturnFocusRef.current = returnFocus;
    setShortcutSettingsOpen(true);
  }, []);

  const closeShortcutSettings = useCallback(() => {
    const returnFocus = settingsReturnFocusRef.current;
    settingsReturnFocusRef.current = null;
    setShortcutSettingsOpen(false);
    restoreFocus(
      returnFocus,
      () => canvasRef.current?.focusCanvas(),
    );
  }, []);

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
    if (startupMode === "loading" || !desktopRuntime) return;
    void readDesktopRuntimeStatus().then((status) => {
      setDesktopRuntimeStatus(status);
      if (status && !status.globalShortcutRegistered) {
        notify({
          message: `唤醒快捷键 ${displayGlobalShortcut(status.globalShortcut)} 被占用，可在“更多”中更换`,
          tone: "error",
        });
      }
    });
  }, [desktopRuntime, notify, startupMode]);

  const {
    importInputRef,
    backupInputRef,
    openImport,
    openRecentDocument,
    revealRecentDocument,
    copyRecentDocumentPath,
    forgetRecentDocument,
    moveRecentDocumentToDirectory,
    createNewDocument,
    saveAsMarkdownDocument,
    saveCurrentDocument,
    importFile,
    exportFullBackup,
    openFullBackupRestore,
    restoreFullBackup,
    deleteBrowserLibraryDocument,
    resolveSaveError,
    saveErrorActionLabel,
  } = useDocumentWorkflow({
    document: mindMap,
    documentPath,
    currentDocumentPath: sourceDocumentPath ?? documentPath,
    documentSessionId,
    isDocumentSessionCurrent,
    recentDocuments,
    saveState,
    saveError,
    saveWarning,
    protectedBrowserSourceName,
    notify,
    newDocument,
    openDocument,
    replaceDocument,
    saveDocumentAs,
    retrySave,
    saveBeforeSwitch,
    beginBlankDocument,
    finishDocumentSwitch,
    moveRecentDocument,
    deleteBrowserDocument,
    removeRecentDocument,
    refreshBrowserDocuments,
    preserveCurrentAsBrowserCopy,
    restoreActiveDocument,
  });

  const { copyDocumentMarkdown, executeCommand } = useMindMapCommands({
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
    onImport: openImport,
    onNew: createNewDocument,
    onSaveAs: () => void saveAsMarkdownDocument(),
    saveNow: saveCurrentDocument,
    undo,
    redo,
  });

  useKeyboardCommands({
    enabled:
      startupMode !== "loading" &&
      overlay === null &&
      !shortcutSettingsOpen,
    selectionEnabled: editingId === null,
    onCommand: executeCommand,
    onBeginTyping: (character) => {
      if (hasSingleSelection && selectedId) {
        beginEdit(selectedId, character);
      }
    },
  });

  const saveGlobalShortcut = useCallback(
    async (shortcut: string): Promise<boolean> => {
      try {
        const status = await updateDesktopGlobalShortcut(shortcut);
        setDesktopRuntimeStatus(status);
        notify({ message: "唤醒快捷键已更新" });
        return true;
      } catch (error) {
        notify({
          message:
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : "无法更新唤醒快捷键",
          tone: "error",
        });
        return false;
      }
    },
    [notify],
  );

  return (
    <main className="app-shell">
      <TopBar
        currentDocumentPath={sourceDocumentPath ?? documentPath}
        onCopyMarkdown={() => void copyDocumentMarkdown()}
        onImport={openImport}
        onNew={createNewDocument}
        onCopyRecentPath={copyRecentDocumentPath}
        onForgetRecent={forgetRecentDocument}
        onDeleteDocument={
          desktopRuntime ? undefined : deleteBrowserLibraryDocument
        }
        onExportFullBackup={() => void exportFullBackup()}
        onMoveRecent={moveRecentDocumentToDirectory}
        onOpenRecent={(path) => void openRecentDocument(path)}
        onRevealRecent={revealRecentDocument}
        onRestoreFullBackup={openFullBackupRestore}
        onSave={() => void saveCurrentDocument()}
        onSaveAs={() => void saveAsMarkdownDocument()}
        onSearch={(returnFocus) => openOverlay("search", returnFocus)}
        onShortcutSettings={openShortcutSettings}
        onTitleChange={(title) =>
          applyMutation((current) =>
            setDocumentTitle(
              current.document,
              title,
              current.selection,
            ),
          )
        }
        recentDocuments={recentDocuments}
        showDesktopActions={desktopRuntime}
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
        onAttachNode={attachNodeToParent}
        onDetachNode={detachNodeToCanvas}
        onPasteStructured={pasteStructuredIntoBlankRoot}
        onSelectionChange={setSelection}
        onSpaceTap={editSelectedFromSpace}
        onToggle={toggleNode}
        onViewportChange={setViewport}
        onZoomPreview={showZoomPreview}
        ref={canvasRef}
        selection={selection}
      />

      <CanvasControls
        onFit={() => canvasRef.current?.fit()}
        onReset={() => canvasRef.current?.resetZoom()}
        onZoomIn={() => canvasRef.current?.zoomIn()}
        onZoomOut={() => canvasRef.current?.zoomOut()}
        ref={canvasControlsRef}
      />

      <StatusBar
        notice={announcement}
        onNoticeActionComplete={dismissAnnouncement}
        onPauseNotice={pauseAnnouncement}
        onResumeNotice={resumeAnnouncement}
        onRetrySave={resolveSaveError}
        saveError={saveError}
        saveState={saveState}
        saveErrorActionLabel={saveErrorActionLabel}
      />

      {overlay && (
        <CommandOverlay
          document={mindMap}
          mode={overlay}
          onClose={closeOverlay}
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

      {shortcutSettingsOpen && (
        <ShortcutSettings
          currentShortcut={
            desktopRuntimeStatus?.globalShortcut ??
            "CommandOrControl+Shift+M"
          }
          onClose={closeShortcutSettings}
          onSave={saveGlobalShortcut}
          registered={
            desktopRuntimeStatus?.globalShortcutRegistered ?? false
          }
        />
      )}

      <input
        accept=".mindmap.json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.currentTarget.value = "";
        }}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept="application/json,.json"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void restoreFullBackup(file);
          event.currentTarget.value = "";
        }}
        ref={backupInputRef}
        tabIndex={-1}
        type="file"
      />
    </main>
  );
}
