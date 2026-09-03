import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { OverlayMode } from "./components/commands/CommandOverlay";
import { StatusBar } from "./components/feedback/StatusBar";
import { restoreFocus } from "./components/overlays/focus";
import { NodeSpaceMenu } from "./components/spaces/NodeSpaceMenu";
import { SpacePicker } from "./components/spaces/SpacePicker";
import type { SpaceTypeChoice } from "./components/spaces/SpacePicker";
import type { FlowWorkspaceHandle } from "./components/spaces/FlowWorkspace";
import {
  readDesktopRuntimeStatus,
  updateDesktopGlobalShortcut,
  type DesktopRuntimeStatus,
} from "./desktop/runtime";
import { displayGlobalShortcut } from "./desktop/shortcut";
import { prepareEditableFieldsForLifecycleSave } from "./desktop/prepareForLifecycleSave";
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
  type DocumentMutation,
} from "./model/tree";
import {
  createMapSpace,
  createFlowSpace,
  deleteSubspaceForNode,
  documentSpaces,
  findMindNode,
  flowSpaceForNode,
  mapSpaceDocument,
  mergeMapSpaceDocument,
  spaceForNode,
  updateFlowSpace,
} from "./model/spaces";
import {
  selectionForContextTarget,
  singleSelection,
} from "./model/selection";
import type {
  FlowSpace,
  EditorSnapshot,
  MindMapDocument,
  SelectionState,
  Viewport,
} from "./types/mindmap";

interface MapSurface {
  kind: "map";
  spaceId: string | null;
}

interface FlowSurface {
  kind: "flow";
  spaceId: string;
  anchorNodeId: string;
  entryRequest: number;
  fitOnMount: boolean;
  initialEditing: boolean;
  initialSelectedId: string | null;
}

type EditorSurface = MapSurface | FlowSurface;

interface SurfaceRestorePoint {
  surface: EditorSurface;
  selection: SelectionState;
}

const rootMapSurface: MapSurface = {
  kind: "map",
  spaceId: null,
};

let flowWorkspaceModule: Promise<
  typeof import("./components/spaces/FlowWorkspace")
> | null = null;

function loadFlowWorkspace() {
  flowWorkspaceModule ??= import("./components/spaces/FlowWorkspace");
  return flowWorkspaceModule;
}

function preloadFlowWorkspace() {
  const request = loadFlowWorkspace();
  void request.catch(() => {
    if (flowWorkspaceModule === request) flowWorkspaceModule = null;
  });
}

const LazyFlowWorkspace = lazy(() =>
  loadFlowWorkspace().then(({ FlowWorkspace }) => ({
    default: FlowWorkspace,
  })),
);

let commandOverlayModule: Promise<
  typeof import("./components/commands/CommandOverlay")
> | null = null;

function loadCommandOverlay() {
  commandOverlayModule ??= import("./components/commands/CommandOverlay");
  return commandOverlayModule;
}

function preloadCommandOverlay() {
  const request = loadCommandOverlay();
  void request.catch(() => {
    if (commandOverlayModule === request) commandOverlayModule = null;
  });
}

const LazyCommandOverlay = lazy(() =>
  loadCommandOverlay().then(({ CommandOverlay }) => ({
    default: CommandOverlay,
  })),
);

let shortcutSettingsModule: Promise<
  typeof import("./components/settings/ShortcutSettings")
> | null = null;

function loadShortcutSettings() {
  shortcutSettingsModule ??= import("./components/settings/ShortcutSettings");
  return shortcutSettingsModule;
}

function preloadShortcutSettings() {
  const request = loadShortcutSettings();
  void request.catch(() => {
    if (shortcutSettingsModule === request) shortcutSettingsModule = null;
  });
}

const LazyShortcutSettings = lazy(() =>
  loadShortcutSettings().then(({ ShortcutSettings }) => ({
    default: ShortcutSettings,
  })),
);

export function App() {
  const desktopRuntime = isDesktopRuntime();
  const prepareForLifecycleSave = useCallback(() => {
    flushSync(() => {
      prepareEditableFieldsForLifecycleSave();
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
    recoveryError,
    recoveredWorkPending,
    lifecycleSaveBlockedRequest,
    startupNotice,
    startupMode,
    recentDocuments,
    canUndo,
    canRedo,
    applyMutation,
    protectEditorDraft,
    finishEditorDraft,
    keepRecoveredWork,
    discardRecoveredWork,
    retryRecoveryProtection,
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
    setFlowPositions,
    setFlowViewport,
    setMapSpaceViewport,
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
  const flowWorkspaceRef = useRef<FlowWorkspaceHandle>(null);
  const flowEntryRequestRef = useRef(0);
  const canvasControlsRef = useRef<CanvasControlsHandle>(null);
  const showZoomPreview = useCallback((zoom: number) => {
    canvasControlsRef.current?.showZoom(zoom);
  }, []);
  const overlayReturnFocusRef = useRef<HTMLElement | null>(null);
  const suppressOverlayRestoreRef = useRef(false);
  const drillDownReturnFocusRef = useRef<HTMLElement | null>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const initialEditStarted = useRef(false);
  const [overlay, setOverlay] = useState<OverlayMode | null>(null);
  const [drillDownNodeId, setDrillDownNodeId] = useState<string | null>(null);
  const [nodeSpaceMenu, setNodeSpaceMenu] = useState<{
    nodeId: string;
    targetRect: { left: number; right: number; top: number; bottom: number };
    returnFocus: HTMLElement;
  } | null>(null);
  const [surface, setSurface] = useState<EditorSurface>(rootMapSurface);
  const [surfaceStack, setSurfaceStack] = useState<SurfaceRestorePoint[]>([]);
  const [shortcutSettingsOpen, setShortcutSettingsOpen] =
    useState(false);
  const [desktopRuntimeStatus, setDesktopRuntimeStatus] =
    useState<DesktopRuntimeStatus | null>(null);
  const {
    announcement,
    notify,
    dismiss: dismissAnnouncement,
    clearPersistentNotice,
    pause: pauseAnnouncement,
    resume: resumeAnnouncement,
  } = useAppNotice();
  useBrowserStorageNotice({
    announcement,
    desktopRuntime,
    notify,
    saveState,
  });
  useEffect(() => {
    if (lifecycleSaveBlockedRequest === 0) return;
    notify({
      message: "未能保存，应用已保持打开",
      tone: "error",
    });
  }, [lifecycleSaveBlockedRequest, notify]);
  const activeMap = useMemo(() => {
    if (surface.kind !== "map" || !surface.spaceId) return mindMap;
    return mapSpaceDocument(mindMap, surface.spaceId) ?? mindMap;
  }, [mindMap, surface]);
  const applyActiveMapMutation = useCallback((
    mutate: (current: EditorSnapshot) => DocumentMutation,
    expectedDocumentSessionId?: number,
  ) => {
    if (surface.kind !== "map" || !surface.spaceId) {
      applyMutation(mutate, expectedDocumentSessionId);
      return;
    }
    const spaceId = surface.spaceId;
    applyMutation((current) => {
      const scopedDocument = mapSpaceDocument(current.document, spaceId);
      if (!scopedDocument) {
        return { document: current.document, selection: current.selection };
      }
      const result = mutate({
        document: scopedDocument,
        selection: current.selection,
      });
      return {
        document: mergeMapSpaceDocument(
          current.document,
          spaceId,
          result.document,
        ),
        selection: result.selection,
      };
    }, expectedDocumentSessionId);
  }, [applyMutation, surface]);
  const {
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
  } = useEditorSession({
    document: activeMap,
    selection,
    applyMutation: applyActiveMapMutation,
    selectNode,
    notify,
    undo,
  });
  const finishDocumentSwitchWithRecovery = useCallback((fitContent: boolean) => {
    finishDocumentSwitch(fitContent);
    finishEditorDraft(true);
  }, [finishDocumentSwitch, finishEditorDraft]);
  const finishMindEditForNavigation = useCallback(() => {
    if (!editingId) return;
    commitEdit(editingId, draft);
    finishEditorDraft(false);
  }, [commitEdit, draft, editingId, finishEditorDraft]);
  const activeFlowCandidate = surface.kind === "flow"
    ? documentSpaces(mindMap)[surface.spaceId]
    : null;
  const activeFlow = activeFlowCandidate?.type === "flow"
    ? activeFlowCandidate
    : null;

  useEffect(() => {
    setSurface(rootMapSurface);
    setSurfaceStack([]);
    setDrillDownNodeId(null);
    setNodeSpaceMenu(null);
    drillDownReturnFocusRef.current = null;
  }, [documentSessionId]);

  useEffect(() => {
    if (
      surface.kind === "map" &&
      surface.spaceId &&
      !mapSpaceDocument(mindMap, surface.spaceId)
    ) {
      setSurface(rootMapSurface);
      setSurfaceStack([]);
      setSelection(singleSelection(mindMap.rootId));
    }
    if (surface.kind === "flow" && !activeFlow) {
      setSurface(rootMapSurface);
      setSurfaceStack([]);
      setSelection(singleSelection(mindMap.rootId));
    }
  }, [activeFlow, mindMap, mindMap.rootId, setSelection, surface]);

  const pushCurrentSurface = useCallback(() => {
    const restorableSurface = surface.kind === "flow"
      ? {
          ...surface,
          fitOnMount: false,
          initialEditing: false,
          initialSelectedId:
            flowWorkspaceRef.current?.selectedId() ??
            surface.initialSelectedId,
        }
      : surface;
    setSurfaceStack((current) => [
      ...current,
      {
        surface: restorableSurface,
        selection,
      },
    ]);
  }, [selection, surface]);

  const enterMapForNode = useCallback((nodeId: string) => {
    const existing = spaceForNode(activeMap, nodeId);
    const creating = !existing;
    const created = existing?.type === "map"
      ? {
          document: activeMap,
          spaceId: existing.id,
          selectedMapNodeId: existing.rootId,
        }
      : createMapSpace(activeMap, nodeId);
    if (!created.spaceId) return;
    if (created.document !== activeMap) {
      applyActiveMapMutation(() => ({
        document: created.document,
        selection: singleSelection(nodeId),
      }));
    }
    finishMindEditForNavigation();
    pushCurrentSurface();
    setSurface({
      kind: "map",
      spaceId: created.spaceId,
    });
    setSelection(singleSelection(created.selectedMapNodeId));
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        if (creating) canvasRef.current?.fit();
        else canvasRef.current?.focusCanvas();
      }),
    );
  }, [
    activeMap,
    applyActiveMapMutation,
    finishMindEditForNavigation,
    pushCurrentSurface,
    setSelection,
  ]);

  const enterFlowForNode = useCallback((nodeId: string) => {
    preloadFlowWorkspace();
    const existing = flowSpaceForNode(activeMap, nodeId);
    const creating = !existing;
    const created = existing
      ? {
          document: activeMap,
          spaceId: existing.id,
          selectedFlowNodeId:
            Object.values(existing.nodes).find(({ kind }) => kind === "step")?.id ??
            Object.keys(existing.nodes)[0] ??
            "",
        }
      : createFlowSpace(activeMap, nodeId);
    if (!created.spaceId) return;
    if (created.document !== activeMap) {
      applyActiveMapMutation(() => ({
        document: created.document,
        selection: singleSelection(nodeId),
      }));
    }
    finishMindEditForNavigation();
    pushCurrentSurface();
    setSurface({
      kind: "flow",
      spaceId: created.spaceId,
      anchorNodeId: nodeId,
      entryRequest: ++flowEntryRequestRef.current,
      fitOnMount: creating,
      initialEditing: creating,
      initialSelectedId: created.selectedFlowNodeId || null,
    });
    setSelection(singleSelection(nodeId));
  }, [
    activeMap,
    applyActiveMapMutation,
    finishMindEditForNavigation,
    pushCurrentSurface,
    setSelection,
  ]);

  const openDrillDown = useCallback((
    nodeId: string,
    returnFocus?: HTMLElement | null,
  ) => {
    if (!activeMap.nodes[nodeId] || spaceForNode(activeMap, nodeId)) return;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest(".command-overlay")
    ) {
      suppressOverlayRestoreRef.current = true;
    }
    drillDownReturnFocusRef.current =
      returnFocus ??
      (activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null);
    setSelection(singleSelection(nodeId));
    setDrillDownNodeId(nodeId);
  }, [activeMap, setSelection]);

  const closeDrillDown = useCallback(() => {
    const returnFocus = drillDownReturnFocusRef.current;
    drillDownReturnFocusRef.current = null;
    setDrillDownNodeId(null);
    restoreFocus(returnFocus, () => canvasRef.current?.focusCanvas());
  }, []);

  const createDrillDownSpace = useCallback((type: SpaceTypeChoice) => {
    if (!drillDownNodeId) return;
    const nodeId = drillDownNodeId;
    drillDownReturnFocusRef.current = null;
    setDrillDownNodeId(null);
    if (type === "map") enterMapForNode(nodeId);
    else enterFlowForNode(nodeId);
  }, [drillDownNodeId, enterFlowForNode, enterMapForNode]);

  const enterSubspaceForNode = useCallback((nodeId: string) => {
    const space = spaceForNode(activeMap, nodeId);
    if (space?.type === "map") enterMapForNode(nodeId);
    if (space?.type === "flow") enterFlowForNode(nodeId);
  }, [activeMap, enterFlowForNode, enterMapForNode]);

  const invokeNodeDrillDown = useCallback((nodeId: string) => {
    if (spaceForNode(activeMap, nodeId)) {
      enterSubspaceForNode(nodeId);
      return;
    }
    openDrillDown(nodeId);
  }, [activeMap, enterSubspaceForNode, openDrillDown]);

  const openNodeSpaceMenu = useCallback((
    nodeId: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => {
    if (!activeMap.nodes[nodeId]) return;
    const nextSelection = selectionForContextTarget(selection, nodeId);
    if (nextSelection !== selection) setSelection(nextSelection);
    setNodeSpaceMenu({ nodeId, targetRect, returnFocus });
  }, [activeMap.nodes, selection.selectedIds, setSelection]);

  const closeNodeSpaceMenu = useCallback(() => {
    const returnFocus = nodeSpaceMenu?.returnFocus ?? null;
    setNodeSpaceMenu(null);
    restoreFocus(returnFocus, () => canvasRef.current?.focusCanvas());
  }, [nodeSpaceMenu]);

  const drillDownFromNodeMenu = useCallback(() => {
    if (!nodeSpaceMenu) return;
    const { nodeId, returnFocus } = nodeSpaceMenu;
    setNodeSpaceMenu(null);
    openDrillDown(nodeId, returnFocus);
  }, [nodeSpaceMenu, openDrillDown]);

  const enterFromNodeMenu = useCallback(() => {
    if (!nodeSpaceMenu) return;
    const { nodeId } = nodeSpaceMenu;
    setNodeSpaceMenu(null);
    enterSubspaceForNode(nodeId);
  }, [enterSubspaceForNode, nodeSpaceMenu]);

  const deleteFromNodeMenu = useCallback(() => {
    if (!nodeSpaceMenu) return;
    const { nodeId } = nodeSpaceMenu;
    setNodeSpaceMenu(null);
    applyActiveMapMutation((current) => ({
      document: deleteSubspaceForNode(current.document, nodeId),
      selection: current.selection,
    }));
    notify({
      message: "已删除下层图",
      actionLabel: "撤销",
      onAction: undo,
    });
  }, [applyActiveMapMutation, nodeSpaceMenu, notify, undo]);

  const navigateBack = useCallback(() => {
    if (surface.kind === "map") finishMindEditForNavigation();
    else flowWorkspaceRef.current?.finishEditing();
    flowWorkspaceRef.current?.flushViewport();
    const restore = surfaceStack[surfaceStack.length - 1];
    if (!restore) {
      setSurface(rootMapSurface);
      setSelection(singleSelection(mindMap.rootId));
      return;
    }
    setSurfaceStack((current) => current.slice(0, -1));
    setSurface(restore.surface);
    setSelection(restore.selection);
    window.requestAnimationFrame(() => {
      if (restore.surface.kind === "map") canvasRef.current?.focusCanvas();
      else flowWorkspaceRef.current?.focusCanvas();
    });
  }, [
    finishMindEditForNavigation,
    mindMap.rootId,
    setSelection,
    surface.kind,
    surfaceStack,
  ]);

  const updateActiveFlow = useCallback((nextSpace: FlowSpace | null) => {
    if (!nextSpace) return;
    applyMutation((current) =>
      updateFlowSpace(current.document, nextSpace, current.selection),
    );
  }, [applyMutation]);

  const spacePath = useMemo(() => {
    const items: Array<{ id: string; label: string; typeLabel: string }> = [];
    const appendSurface = (candidate: EditorSurface) => {
      if (candidate.kind === "map" && !candidate.spaceId) return;
      const space = documentSpaces(mindMap)[candidate.spaceId!];
      if (!space) return;
      const anchor = findMindNode(mindMap, space.anchorNodeId);
      items.push({
        id: space.id,
        label: anchor?.text || "未命名节点",
        typeLabel: space.type === "map" ? "思维图" : "流程",
      });
    };
    surfaceStack.forEach(({ surface: candidate }) => appendSurface(candidate));
    appendSurface(surface);
    return items;
  }, [mindMap, surface, surfaceStack]);
  const openOverlay = useCallback((
    mode: OverlayMode,
    returnFocus?: HTMLElement | null,
  ) => {
    preloadCommandOverlay();
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
    const restore = !suppressOverlayRestoreRef.current;
    suppressOverlayRestoreRef.current = false;
    overlayReturnFocusRef.current = null;
    setOverlay(null);
    if (restore) {
      restoreFocus(
        returnFocus,
        () => canvasRef.current?.focusCanvas(),
      );
    }
  }, []);

  const openShortcutSettings = useCallback((returnFocus: HTMLElement) => {
    preloadShortcutSettings();
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
    beginBlankDocument(mindMap.rootId);
  }, [beginBlankDocument, mindMap.rootId, startupMode]);

  useEffect(() => {
    if (!startupNotice || recoveredWorkPending) return;
    notify({ message: startupNotice });
  }, [notify, recoveredWorkPending, startupNotice]);

  useEffect(() => {
    if (!recoveredWorkPending) return;
    notify({
      message: "已恢复上次中断前的内容",
      actionLabel: "保留",
      onAction: () => void keepRecoveredWork(),
      secondaryActionLabel: "放弃",
      onSecondaryAction: () => void discardRecoveredWork(),
      persistent: true,
    });
  }, [
    discardRecoveredWork,
    keepRecoveredWork,
    notify,
    recoveredWorkPending,
  ]);

  useEffect(() => {
    // Once the recovered work is kept, discarded, or committed by a save,
    // the decision bar has no pending decision left to offer.
    if (recoveredWorkPending) return;
    clearPersistentNotice();
  }, [clearPersistentNotice, recoveredWorkPending]);

  useEffect(() => {
    if (!recoveryError) return;
    notify({
      message: "临时恢复保护失败",
      actionLabel: "重试",
      onAction: retryRecoveryProtection,
      tone: "error",
    });
  }, [notify, recoveryError, retryRecoveryProtection]);

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
    finishDocumentSwitch: finishDocumentSwitchWithRecovery,
    moveRecentDocument,
    deleteBrowserDocument,
    removeRecentDocument,
    refreshBrowserDocuments,
    preserveCurrentAsBrowserCopy,
    restoreActiveDocument,
  });

  const { copyDocumentMarkdown, executeCommand, pasteText } =
    useMindMapCommands({
      mindMap,
      scopeDocument: surface.kind === "map" ? activeMap : undefined,
      selection,
      canUndo,
      canRedo,
      canvasRef,
      applyMutation: applyActiveMapMutation,
      documentSessionId,
      isDocumentSessionCurrent,
      selectNode,
      setSelection,
      setEditingId,
      setDraft,
      openOverlay,
      notify,
      onDrillDown: invokeNodeDrillDown,
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
      drillDownNodeId === null &&
      nodeSpaceMenu === null &&
      !shortcutSettingsOpen &&
      surface.kind === "map",
    selectionEnabled: editingId === null,
    onCommand: (command) => {
      if (
        command === "selection.clear" &&
        surface.kind === "map" &&
        surface.spaceId
      ) {
        navigateBack();
        return;
      }
      executeCommand(command);
    },
    onPasteText: pasteText,
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
        onTitleDraftChange={(title) =>
          protectEditorDraft({
            objectId: "document-title",
            objectKind: "title",
            spaceId: null,
            surface: "root-map",
          }, title)
        }
        onTitleDraftFinish={finishEditorDraft}
        recentDocuments={recentDocuments}
        showDesktopActions={desktopRuntime}
        spacePath={spacePath}
        onNavigateBack={spacePath.length > 0 ? navigateBack : undefined}
        title={mindMap.title}
      />

      {surface.kind === "map" ? (
        <>
          <MindMapCanvas
            document={activeMap}
            draft={draft}
            editingId={editingId}
            fitRequest={fitRequest}
            onBeginEdit={beginEdit}
            onCancelEdit={(id) => {
              cancelEdit(id);
              finishEditorDraft(true);
            }}
            onCommitEdit={(id, value) => {
              commitEdit(id, value);
              finishEditorDraft(false);
            }}
            onDraftChange={(value) => {
              setDraft(value);
              if (!editingId) return;
              protectEditorDraft({
                objectId: editingId,
                objectKind: "mind-node",
                spaceId: surface.spaceId,
                surface: surface.spaceId ? "map" : "root-map",
              }, value);
            }}
            onAttachNode={attachNodeToParent}
            onDetachNode={detachNodeToCanvas}
            onOpenNodeContextMenu={openNodeSpaceMenu}
            onOpenSubspace={enterSubspaceForNode}
            onPasteStructured={pasteStructuredIntoBlankRoot}
            onSelectionChange={setSelection}
            onSpaceTap={editSelectedFromSpace}
            onToggle={toggleNode}
            onViewportChange={(viewport) => {
              if (!surface.spaceId) {
                setViewport(viewport);
                return;
              }
              setMapSpaceViewport(surface.spaceId, viewport);
            }}
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
        </>
      ) : activeFlow ? (
        <Suspense
          fallback={(
            <div
              aria-label="正在打开流程"
              className="flow-canvas flow-canvas--loading"
              role="status"
            />
          )}
        >
          <LazyFlowWorkspace
            entryRequest={surface.entryRequest}
            fitOnMount={surface.fitOnMount}
            initialEditing={surface.initialEditing}
            initialSelectedId={surface.initialSelectedId}
            keyboardEnabled={
              startupMode !== "loading" &&
              overlay === null &&
              !shortcutSettingsOpen
            }
            key={`${documentSessionId}:${activeFlow.id}`}
            notify={notify}
            onBack={navigateBack}
            onRedo={redo}
            onUndo={undo}
            onEditorDraftChange={(target, value) =>
              protectEditorDraft({
                ...target,
                spaceId: activeFlow.id,
                surface: "flow",
              }, value)
            }
            onEditorDraftFinish={finishEditorDraft}
            onUpdateSpace={updateActiveFlow}
            onPositionsChange={(positions) =>
              setFlowPositions(activeFlow.id, positions)
            }
            onViewportChange={(viewport) =>
              setFlowViewport(activeFlow.id, viewport)
            }
            ref={flowWorkspaceRef}
            space={activeFlow}
          />
        </Suspense>
      ) : null}

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
        <Suspense
          fallback={(
            <div
              aria-label="正在打开"
              className="overlay-backdrop"
              role="status"
            />
          )}
        >
          <LazyCommandOverlay
            document={mindMap}
            key={overlay}
            mode={overlay}
            onClose={closeOverlay}
            onExecute={executeCommand}
            onSelectNode={(id, spaceId) => {
            if (spaceId) {
              const space = documentSpaces(mindMap)[spaceId];
              if (!space?.nodes[id]) return;
              if (space.type === "map") {
                if (surface.kind !== "map" || surface.spaceId !== spaceId) {
                  pushCurrentSurface();
                }
                setSurface({ kind: "map", spaceId });
                setSelection(singleSelection(id));
                window.requestAnimationFrame(() =>
                  window.requestAnimationFrame(() =>
                    canvasRef.current?.focusSelected(),
                  ),
                );
              } else {
                preloadFlowWorkspace();
                if (surface.kind !== "flow" || surface.spaceId !== spaceId) {
                  pushCurrentSurface();
                }
                setSurface({
                  kind: "flow",
                  spaceId,
                  anchorNodeId: space.anchorNodeId,
                  entryRequest: ++flowEntryRequestRef.current,
                  fitOnMount: false,
                  initialEditing: false,
                  initialSelectedId: id,
                });
                setSelection(singleSelection(space.anchorNodeId));
              }
              return;
            }
            setSurface(rootMapSurface);
            setSurfaceStack([]);
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
        </Suspense>
      )}

      {nodeSpaceMenu && activeMap.nodes[nodeSpaceMenu.nodeId] && (
        <NodeSpaceMenu
          nodeLabel={activeMap.nodes[nodeSpaceMenu.nodeId].text}
          onClose={closeNodeSpaceMenu}
          onDelete={deleteFromNodeMenu}
          onDrillDown={drillDownFromNodeMenu}
          onEnter={enterFromNodeMenu}
          targetRect={nodeSpaceMenu.targetRect}
          space={spaceForNode(activeMap, nodeSpaceMenu.nodeId)}
        />
      )}

      {drillDownNodeId && activeMap.nodes[drillDownNodeId] && (
        <SpacePicker
          onCreate={createDrillDownSpace}
          onClose={closeDrillDown}
          onTypeIntent={(type) => {
            if (type === "flow") preloadFlowWorkspace();
          }}
        />
      )}

      {shortcutSettingsOpen && (
        <Suspense
          fallback={(
            <div
              aria-label="正在打开快捷键设置"
              className="overlay-backdrop"
              role="status"
            />
          )}
        >
          <LazyShortcutSettings
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
        </Suspense>
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
