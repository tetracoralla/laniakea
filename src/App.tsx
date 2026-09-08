import { useLocale } from "./i18n/useLocale";
import { t } from "./i18n/locale";
import {
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
import { CanvasBlankMenu } from "./components/canvas/CanvasBlankMenu";
import type { OverlayMode } from "./components/commands/CommandOverlay";
import { StatusBar } from "./components/feedback/StatusBar";
import {
  createRetryableLazySection,
} from "./components/feedback/RetryableLazySection";
import { DeleteSubspaceDialog } from "./components/overlays/DeleteSubspaceDialog";
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
import { writeTextClipboard } from "./desktop/clipboard";
import { commandRegistry, commandSupportsTarget, type CommandId } from "./commands/registry";
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
  createChild,
  createFloatingNode,
  createNodeId,
  normalizeNodeText,
  parentOf,
  setDocumentTitle,
  setNodeText,
  revealNode,
  type DocumentMutation,
} from "./model/tree";
import {
  createMapSpace,
  createFlowSpace,
  documentSpaces,
  findMindNode,
  flowSpaceForNode,
  mapSpaceDocument,
  mergeMapSpaceDocument,
  moveSubspaceToNode,
  spaceForNode,
  updateFlowSpace,
} from "./model/spaces";
import { subspacePreview } from "./model/subspacePreview";
import {
  deleteSubspaceForInteractionTarget,
  isCurrentCanvasInteractionTarget,
  mindNodeInteractionTarget,
  subspacePortalInteractionTarget,
  type CanvasInteractionTarget,
  type SubspacePortalInteractionTarget,
} from "./model/canvasInteraction";
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

export interface MapSurface {
  kind: "map";
  spaceId: string | null;
}

export interface FlowSurface {
  kind: "flow";
  spaceId: string;
  anchorNodeId: string;
  entryRequest: number;
  fitOnMount: boolean;
  initialEditing: boolean;
  initialSelectedId: string | null;
}

export type EditorSurface = MapSurface | FlowSurface;

export interface SurfaceRestorePoint {
  surface: EditorSurface;
  selection: SelectionState;
  interactionTarget: CanvasInteractionTarget;
  fitContentOnRestore: boolean;
}

const rootMapSurface: MapSurface = {
  kind: "map",
  spaceId: null,
};

export interface SurfaceInvalidationResult {
  surface: EditorSurface;
  surfaceStack: SurfaceRestorePoint[];
  /** Saved selection of the restored entry; null means fall back to the root node. */
  restoreSelection: SelectionState | null;
  restoreInteractionTarget: CanvasInteractionTarget;
  fitContentOnRestore: boolean;
}

/**
 * Picks where navigation lands after the current surface's space disappears
 * (typically via undo): the deepest surviving ancestor keeps the rest of the
 * return path alive instead of the whole stack collapsing to the root map.
 */
export function resolveSurfaceAfterInvalidation(
  surface: EditorSurface,
  surfaceStack: SurfaceRestorePoint[],
  surfaceValid: (candidate: EditorSurface) => boolean,
): SurfaceInvalidationResult | null {
  if (surfaceValid(surface)) return null;
  let index = surfaceStack.length - 1;
  while (index >= 0 && !surfaceValid(surfaceStack[index].surface)) {
    index -= 1;
  }
  if (index >= 0) {
    return {
      surface: surfaceStack[index].surface,
      restoreSelection: surfaceStack[index].selection,
      restoreInteractionTarget: surfaceStack[index].interactionTarget,
      fitContentOnRestore: surfaceStack[index].fitContentOnRestore,
      surfaceStack: surfaceStack.slice(0, index),
    };
  }
  return {
    surface: rootMapSurface,
    restoreSelection: null,
    restoreInteractionTarget: mindNodeInteractionTarget,
    fitContentOnRestore: false,
    surfaceStack: [],
  };
}

function LoadingSurface({ label, className }: { label: "正在打开流程" | "正在打开" | "正在打开快捷键设置"; className: string }) {
  useLocale();
  return <div aria-label={t(label)} className={className} role="status" />;
}

const flowWorkspaceSection = createRetryableLazySection(
  () => import("./components/spaces/FlowWorkspace").then(
    ({ FlowWorkspace }) => ({ default: FlowWorkspace }),
  ),
  {
    errorLabel: "无法打开流程",
    loadingFallback: (
      <LoadingSurface label="正在打开流程" className="flow-canvas flow-canvas--loading" />
    ),
  },
);
const LazyFlowWorkspace = flowWorkspaceSection.Component;
const preloadFlowWorkspace = flowWorkspaceSection.preload;

const commandOverlaySection = createRetryableLazySection(
  () => import("./components/commands/CommandOverlay").then(
    ({ CommandOverlay }) => ({ default: CommandOverlay }),
  ),
  {
    errorLabel: "无法打开命令面板",
    loadingFallback: (
      <LoadingSurface label="正在打开" className="overlay-backdrop" />
    ),
  },
);
const LazyCommandOverlay = commandOverlaySection.Component;
const preloadCommandOverlay = commandOverlaySection.preload;

const shortcutSettingsSection = createRetryableLazySection(
  () => import("./components/settings/ShortcutSettings").then(
    ({ ShortcutSettings }) => ({ default: ShortcutSettings }),
  ),
  {
    errorLabel: "无法打开快捷键设置",
    loadingFallback: (
      <LoadingSurface label="正在打开快捷键设置" className="overlay-backdrop" />
    ),
  },
);
const LazyShortcutSettings = shortcutSettingsSection.Component;
const preloadShortcutSettings = shortcutSettingsSection.preload;

export function App() {
  const locale = useLocale();
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
  const flowSelectionsRef = useRef(new Map<string, string | null>());
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
  const [canvasInteractionTarget, setCanvasInteractionTarget] =
    useState<CanvasInteractionTarget>(mindNodeInteractionTarget);
  const selectedSubspaceAnchorId =
    canvasInteractionTarget.kind === "subspace-portal"
      ? canvasInteractionTarget.anchorNodeId
      : null;
  const [deleteSubspaceRequest, setDeleteSubspaceRequest] = useState<{
    target: SubspacePortalInteractionTarget;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [nodeSpaceMenu, setNodeSpaceMenu] = useState<{
    nodeId: string;
    targetRect: { left: number; right: number; top: number; bottom: number };
    returnFocus: HTMLElement;
  } | null>(null);
  const [canvasBlankMenu, setCanvasBlankMenu] = useState<{
    clientX: number;
    clientY: number;
    contentX: number;
    contentY: number;
    documentSessionId: number;
  } | null>(null);
  const activeCanvasBlankMenu =
    canvasBlankMenu?.documentSessionId === documentSessionId
      ? canvasBlankMenu
      : null;
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
      message: t("未能保存，应用已保持打开"),
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
    finishEdit,
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

  // Tab while editing: commit the text and insert+edit a child in one
  // mutation so a single undo removes both (mirrors outliner muscle memory).
  const commitEditAndInsertChild = useCallback(
    (id: string, value: string) => {
      if (!activeMap.nodes[id]) return;
      const nextText = normalizeNodeText(value);
      const createdId = createNodeId();
      flushSync(() => {
        setEditingId(createdId);
        setDraft("");
        applyActiveMapMutation((current) => {
          const withText =
            current.document.nodes[id]?.text === nextText
              ? current.document
              : setNodeText(current.document, id, nextText).document;
          return createChild(withText, id, "", createdId);
        });
      });
    },
    [activeMap, applyActiveMapMutation, setDraft, setEditingId],
  );

  const commitEditAndSelectParent = useCallback(
    (id: string, value: string) => {
      commitEdit(id, value);
      selectNode(parentOf(activeMap, id) ?? id);
    },
    [activeMap, commitEdit, selectNode],
  );

  const handleEditTab = useCallback(
    (id: string, value: string, shiftKey: boolean) => {
      if (shiftKey) commitEditAndSelectParent(id, value);
      else commitEditAndInsertChild(id, value);
    },
    [commitEditAndInsertChild, commitEditAndSelectParent],
  );
  const finishDocumentSwitchWithRecovery = useCallback((fitContent: boolean) => {
    finishDocumentSwitch(fitContent);
    finishEditorDraft(true);
  }, [finishDocumentSwitch, finishEditorDraft]);
  const finishMindEditForNavigation = useCallback(() => {
    finishEdit();
    finishEditorDraft(false);
  }, [finishEdit, finishEditorDraft]);
  const activeFlowCandidate = surface.kind === "flow"
    ? documentSpaces(mindMap)[surface.spaceId]
    : null;
  const activeFlow = activeFlowCandidate?.type === "flow"
    ? activeFlowCandidate
    : null;
  const activeFlowId = activeFlow?.id;
  const rememberFlowSelection = useCallback((id: string | null) => {
    if (activeFlowId) flowSelectionsRef.current.set(activeFlowId, id);
  }, [activeFlowId]);

  useEffect(() => {
    flowSelectionsRef.current.clear();
    setSurface(rootMapSurface);
    setSurfaceStack([]);
    setDrillDownNodeId(null);
    setCanvasInteractionTarget(mindNodeInteractionTarget);
    setDeleteSubspaceRequest(null);
    setNodeSpaceMenu(null);
    setCanvasBlankMenu(null);
    drillDownReturnFocusRef.current = null;
  }, [documentSessionId]);

  useEffect(() => {
    if (
      canvasInteractionTarget.kind === "subspace-portal" &&
      !isCurrentCanvasInteractionTarget(activeMap, canvasInteractionTarget)
    ) {
      setCanvasInteractionTarget(mindNodeInteractionTarget);
    }
  }, [activeMap, canvasInteractionTarget]);

  useEffect(() => {
    if (
      !deleteSubspaceRequest ||
      isCurrentCanvasInteractionTarget(
        activeMap,
        deleteSubspaceRequest.target,
      )
    ) {
      return;
    }
    setDeleteSubspaceRequest(null);
    restoreFocus(
      deleteSubspaceRequest.returnFocus,
      () => canvasRef.current?.focusCanvas(),
    );
  }, [activeMap, deleteSubspaceRequest]);

  useEffect(() => {
    const invalidation = resolveSurfaceAfterInvalidation(
      surface,
      surfaceStack,
      (candidate) =>
        candidate.kind === "flow"
          ? documentSpaces(mindMap)[candidate.spaceId]?.type === "flow"
          : !candidate.spaceId ||
            Boolean(mapSpaceDocument(mindMap, candidate.spaceId)),
    );
    if (!invalidation) return;
    setSurfaceStack(invalidation.surfaceStack);
    setSurface(invalidation.surface);
    setCanvasInteractionTarget(invalidation.restoreInteractionTarget);
    setSelection(
      invalidation.restoreSelection ?? singleSelection(mindMap.rootId),
    );
  }, [mindMap, setSelection, surface, surfaceStack]);

  const pushCurrentSurface = useCallback((
    interactionTarget = canvasInteractionTarget,
    fitContentOnRestore = false,
  ) => {
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
        interactionTarget,
        fitContentOnRestore,
      },
    ]);
  }, [canvasInteractionTarget, selection, surface]);

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
    pushCurrentSurface(
      creating
        ? {
            kind: "subspace-portal",
            anchorNodeId: nodeId,
            spaceId: created.spaceId,
          }
        : undefined,
      creating,
    );
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
    const rememberedId = existing ? flowSelectionsRef.current.get(existing.id) : undefined;
    const created = existing
      ? {
          document: activeMap,
          spaceId: existing.id,
          selectedFlowNodeId:
            rememberedId === null || (rememberedId && existing.nodes[rememberedId])
              ? rememberedId
              : Object.values(existing.nodes).find(({ kind }) => kind === "step")?.id ??
                Object.keys(existing.nodes)[0] ??
                null,
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
    pushCurrentSurface(
      creating
        ? {
            kind: "subspace-portal",
            anchorNodeId: nodeId,
            spaceId: created.spaceId,
          }
        : undefined,
      creating,
    );
    setSurface({
      kind: "flow",
      spaceId: created.spaceId,
      anchorNodeId: nodeId,
      entryRequest: ++flowEntryRequestRef.current,
      fitOnMount: creating,
      initialEditing: false,
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

  const selectSubspacePortal = useCallback((nodeId: string) => {
    const target = subspacePortalInteractionTarget(activeMap, nodeId);
    if (!target) return;
    // Clicking away from a node edit commits the draft everywhere else on
    // the canvas; the portal target must not silently discard it.
    finishMindEditForNavigation();
    setCanvasInteractionTarget(target);
    setSelection(singleSelection(nodeId));
  }, [activeMap, finishMindEditForNavigation, setSelection]);

  const selectMapNodes = useCallback((nextSelection: SelectionState) => {
    setCanvasInteractionTarget(mindNodeInteractionTarget);
    setSelection(nextSelection);
  }, [setSelection]);

  const moveSubspacePortal = useCallback((
    sourceNodeId: string,
    targetNodeId: string,
  ) => {
    const sourceTarget = subspacePortalInteractionTarget(
      activeMap,
      sourceNodeId,
    );
    if (
      !sourceTarget ||
      !activeMap.nodes[targetNodeId] ||
      activeMap.nodes[targetNodeId].subspaceId
    ) {
      return;
    }
    applyActiveMapMutation((current) => ({
      document: moveSubspaceToNode(
        current.document,
        sourceNodeId,
        targetNodeId,
      ),
      selection: singleSelection(targetNodeId),
    }));
    setCanvasInteractionTarget({
      ...sourceTarget,
      anchorNodeId: targetNodeId,
    });
    notify({
      message: t("已移动下层图"),
      actionLabel: t("撤销"),
      onAction: undo,
    });
  }, [activeMap, applyActiveMapMutation, notify, undo]);

  const requestDeleteSubspace = useCallback((
    target: SubspacePortalInteractionTarget,
    returnFocus?: HTMLElement | null,
  ) => {
    if (!isCurrentCanvasInteractionTarget(activeMap, target)) return;
    const activeElement = document.activeElement;
    setDeleteSubspaceRequest({
      target,
      returnFocus:
        returnFocus ??
        (activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null),
    });
  }, [activeMap]);

  const cancelDeleteSubspace = useCallback(() => {
    const returnFocus = deleteSubspaceRequest?.returnFocus ?? null;
    setDeleteSubspaceRequest(null);
    restoreFocus(returnFocus, () => canvasRef.current?.focusCanvas());
  }, [deleteSubspaceRequest]);

  const confirmDeleteSubspace = useCallback(() => {
    if (!deleteSubspaceRequest) return;
    const { target } = deleteSubspaceRequest;
    setDeleteSubspaceRequest(null);
    if (!isCurrentCanvasInteractionTarget(activeMap, target)) {
      setCanvasInteractionTarget(mindNodeInteractionTarget);
      notify({ message: t("下层图已发生变化，未执行删除"), tone: "error" });
      window.requestAnimationFrame(() => canvasRef.current?.focusCanvas());
      return;
    }
    setCanvasInteractionTarget(mindNodeInteractionTarget);
    applyActiveMapMutation((current) => ({
      document: deleteSubspaceForInteractionTarget(current.document, target),
      selection: singleSelection(target.anchorNodeId),
    }));
    notify({
      message: t("已删除下层图"),
      actionLabel: t("撤销"),
      onAction: undo,
    });
    window.requestAnimationFrame(() => canvasRef.current?.focusCanvas());
  }, [activeMap, applyActiveMapMutation, deleteSubspaceRequest, notify, undo]);

  const copySubspacePortal = useCallback(async (
    target: SubspacePortalInteractionTarget,
  ): Promise<boolean> => {
    if (!isCurrentCanvasInteractionTarget(activeMap, target)) return false;
    const space = documentSpaces(activeMap)[target.spaceId];
    if (!space) return false;
    if (!(await writeTextClipboard(subspacePreview(space).text))) {
      notify({ message: t("无法写入系统剪贴板"), tone: "error" });
      return false;
    }
    notify({ message: t("已复制下层图概要") });
    return true;
  }, [activeMap, notify]);

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
    targetKind: CanvasInteractionTarget["kind"],
  ) => {
    if (!activeMap.nodes[nodeId]) return;
    if (targetKind === "subspace-portal") {
      const target = subspacePortalInteractionTarget(activeMap, nodeId);
      if (!target) return;
      setCanvasInteractionTarget(target);
    } else {
      setCanvasInteractionTarget(mindNodeInteractionTarget);
    }
    const nextSelection = selectionForContextTarget(selection, nodeId);
    if (nextSelection !== selection) setSelection(nextSelection);
    setNodeSpaceMenu({ nodeId, targetRect, returnFocus });
  }, [activeMap, selection, setSelection]);

  const closeNodeSpaceMenu = useCallback((shouldRestoreFocus: boolean) => {
    const returnFocus = nodeSpaceMenu?.returnFocus ?? null;
    setNodeSpaceMenu(null);
    if (shouldRestoreFocus) {
      restoreFocus(returnFocus, () => canvasRef.current?.focusCanvas());
    }
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
    const { nodeId, returnFocus } = nodeSpaceMenu;
    setNodeSpaceMenu(null);
    const target = subspacePortalInteractionTarget(activeMap, nodeId);
    if (!target) return;
    setCanvasInteractionTarget(target);
    requestDeleteSubspace(target, returnFocus);
  }, [activeMap, nodeSpaceMenu, requestDeleteSubspace]);

  const navigateBack = useCallback(() => {
    if (surface.kind === "map") finishMindEditForNavigation();
    else flowWorkspaceRef.current?.finishEditing();
    flowWorkspaceRef.current?.flushViewport();
    const restore = surfaceStack[surfaceStack.length - 1];
    if (!restore) {
      setSurface(rootMapSurface);
      setCanvasInteractionTarget(mindNodeInteractionTarget);
      setSelection(singleSelection(mindMap.rootId));
      return;
    }
    setSurfaceStack((current) => current.slice(0, -1));
    setSurface(restore.surface);
    setCanvasInteractionTarget(restore.interactionTarget);
    setSelection(restore.selection);
    window.requestAnimationFrame(() => {
      if (restore.surface.kind === "map") {
        if (restore.fitContentOnRestore) {
          window.requestAnimationFrame(() => canvasRef.current?.fit());
        } else {
          canvasRef.current?.focusCanvas();
        }
      }
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
    const items: Array<{ id: string; label: string }> = [];
    const appendSurface = (candidate: EditorSurface) => {
      if (candidate.kind === "map" && !candidate.spaceId) return;
      const space = documentSpaces(mindMap)[candidate.spaceId!];
      if (!space) return;
      const anchor = findMindNode(mindMap, space.anchorNodeId);
      items.push({
        id: space.id,
        label: anchor?.text || t("未命名节点"),
      });
    };
    surfaceStack.forEach(({ surface: candidate }) => appendSurface(candidate));
    appendSurface(surface);
    return items;
  }, [mindMap, surface, surfaceStack, locale]);
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
      message: t("已恢复上次中断前的内容"),
      actionLabel: t("保留"),
      onAction: () => void keepRecoveredWork(),
      secondaryActionLabel: t("放弃"),
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
      message: t("临时恢复保护失败"),
      actionLabel: t("重试"),
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
          message: t("唤醒快捷键 {0} 被占用，可在“更多”中更换", displayGlobalShortcut(status.globalShortcut)),
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
    revealCurrentDocument,
    revealRecentDocument,
    copyDocumentPathToClipboard,
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

  const executeAppCommand = useCallback((command: CommandId) => {
    if (surface.kind === "flow") {
      const definition = commandRegistry.find(({ id }) => id === command);
      if (!definition || !commandSupportsTarget(definition, "flow")) return;
      const canvas = flowWorkspaceRef.current;
      switch (command) {
        case "viewport.fit": canvas?.fit(); return;
        case "viewport.focus": canvas?.focusSelected(); return;
        case "viewport.zoom-in": canvas?.zoomIn(); return;
        case "viewport.zoom-out": canvas?.zoomOut(); return;
        case "viewport.reset": canvas?.resetZoom(); return;
        case "map.copy-markdown": void copyDocumentMarkdown(); return;
      }
    }
    if (command === "map.new" || command === "map.open") {
      setCanvasBlankMenu(null);
    }
    switch (command) {
      case "space.copy-summary": {
        if (canvasInteractionTarget.kind !== "subspace-portal") return;
        void copySubspacePortal(canvasInteractionTarget);
        return;
      }
      case "space.cut": {
        if (canvasInteractionTarget.kind !== "subspace-portal") return;
        const target = canvasInteractionTarget;
        void copySubspacePortal(target).then((copied) => {
          if (copied) requestDeleteSubspace(target);
        });
        return;
      }
      case "space.delete":
        if (canvasInteractionTarget.kind !== "subspace-portal") return;
        requestDeleteSubspace(canvasInteractionTarget);
        return;
      case "space.enter":
        if (
          canvasInteractionTarget.kind !== "subspace-portal" ||
          !isCurrentCanvasInteractionTarget(activeMap, canvasInteractionTarget)
        ) {
          return;
        }
        enterSubspaceForNode(canvasInteractionTarget.anchorNodeId);
        return;
      case "space.select-anchor":
        if (canvasInteractionTarget.kind !== "subspace-portal") return;
        setSelection(
          singleSelection(canvasInteractionTarget.anchorNodeId),
        );
        setCanvasInteractionTarget(mindNodeInteractionTarget);
        return;
      case "selection.clear":
      case "selection.select-all":
        setCanvasInteractionTarget(mindNodeInteractionTarget);
        executeCommand(command);
        return;
      default:
        executeCommand(command);
    }
  }, [
    activeMap,
    canvasInteractionTarget,
    copySubspacePortal,
    copyDocumentMarkdown,
    surface.kind,
    enterSubspaceForNode,
    executeCommand,
    requestDeleteSubspace,
    setSelection,
  ]);

  const closeCanvasBlankMenu = useCallback((shouldRestoreFocus: boolean) => {
    setCanvasBlankMenu(null);
    if (shouldRestoreFocus) canvasRef.current?.focusCanvas();
  }, []);

  // Double-click or menu on empty canvas: a blank floating root is created
  // and immediately opened for editing.
  const createFloatingAtPoint = useCallback(
    (contentX: number, contentY: number) => {
      const createdId = createNodeId();
      flushSync(() => {
        applyActiveMapMutation((current) =>
          createFloatingNode(current.document, contentX, contentY, createdId),
        );
      });
      beginEdit(createdId);
    },
    [applyActiveMapMutation, beginEdit],
  );

  const createFloatingFromBlankMenu = useCallback(() => {
    if (!activeCanvasBlankMenu) {
      setCanvasBlankMenu(null);
      return;
    }
    const { contentX, contentY } = activeCanvasBlankMenu;
    setCanvasBlankMenu(null);
    createFloatingAtPoint(contentX, contentY);
  }, [activeCanvasBlankMenu, createFloatingAtPoint]);

  useKeyboardCommands({
    enabled:
      startupMode !== "loading" &&
      overlay === null &&
      drillDownNodeId === null &&
      deleteSubspaceRequest === null &&
      nodeSpaceMenu === null &&
      !shortcutSettingsOpen,
    // Global commands (palette, search, save, zoom) stay live on Flow
    // surfaces too; selection-only commands remain map-scoped so they
    // cannot fight the Flow canvas's own keyboard handling.
    selectionEnabled: editingId === null && surface.kind === "map",
    commandTarget: canvasInteractionTarget.kind,
    onCommand: (command) => {
      if (
        command === "selection.clear" &&
        surface.kind === "map" &&
        surface.spaceId
      ) {
        navigateBack();
        return;
      }
      executeAppCommand(command);
    },
    onPasteText: pasteText,
    onBeginTyping: (character) => {
      if (
        surface.kind === "map" &&
        canvasInteractionTarget.kind === "mind-node" &&
        hasSingleSelection &&
        selectedId
      ) {
        beginEdit(selectedId, character);
      }
    },
  });

  const saveGlobalShortcut = useCallback(
    async (shortcut: string): Promise<boolean> => {
      try {
        const status = await updateDesktopGlobalShortcut(shortcut);
        setDesktopRuntimeStatus(status);
        notify({ message: t("唤醒快捷键已更新") });
        return true;
      } catch (error) {
        notify({
          message:
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : t("无法更新唤醒快捷键"),
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
        currentDocumentPath={documentPath}
        currentSourceDocumentPath={sourceDocumentPath}
        onCopyMarkdown={() => void copyDocumentMarkdown()}
        onImport={openImport}
        onNew={createNewDocument}
        onCopyDocumentPath={copyDocumentPathToClipboard}
        onForgetRecent={forgetRecentDocument}
        onDeleteDocument={
          desktopRuntime ? undefined : deleteBrowserLibraryDocument
        }
        onExportFullBackup={() => void exportFullBackup()}
        onMoveRecent={moveRecentDocumentToDirectory}
        onOpenRecent={(path) => void openRecentDocument(path)}
        onRevealCurrent={revealCurrentDocument}
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
              title.trim() || t("未命名思维"),
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
        saveState={saveState}
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
            onEditTab={handleEditTab}
            onAttachNode={attachNodeToParent}
            onDetachNode={detachNodeToCanvas}
            onOpenCanvasContextMenu={(anchor) => {
              setNodeSpaceMenu(null);
              setCanvasBlankMenu({ ...anchor, documentSessionId });
            }}
            onCreateFloatingAt={createFloatingAtPoint}
            onMoveSubspace={moveSubspacePortal}
            onOpenNodeContextMenu={openNodeSpaceMenu}
            onOpenSubspace={enterSubspaceForNode}
            onPasteStructured={pasteStructuredIntoBlankRoot}
            onSelectSubspace={selectSubspacePortal}
            onSelectionChange={selectMapNodes}
            onSpaceTap={() => {
              if (canvasInteractionTarget.kind === "mind-node") {
                editSelectedFromSpace();
              }
            }}
            onToggle={(id) => {
              if (selectedSubspaceAnchorId === id) {
                setCanvasInteractionTarget(mindNodeInteractionTarget);
              }
              toggleNode(id);
            }}
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
            interactionTarget={canvasInteractionTarget}
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
          onSelectionChange={rememberFlowSelection}
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
        <LazyCommandOverlay
          commandTarget={surface.kind === "flow" ? "flow" : canvasInteractionTarget.kind}
          document={mindMap}
          key={overlay}
          mode={overlay}
          onClose={closeOverlay}
          onExecute={executeAppCommand}
          onSelectNode={(id, spaceId) => {
            setCanvasInteractionTarget(mindNodeInteractionTarget);
            if (spaceId) {
              const space = documentSpaces(mindMap)[spaceId];
              if (!space?.nodes[id]) return;
              if (space.type === "map") {
                if (surface.kind !== "map" || surface.spaceId !== spaceId) {
                  // The jump already resets the target above; the restore
                  // point must record that same fresh node target instead
                  // of the render-time closure value.
                  pushCurrentSurface(mindNodeInteractionTarget);
                }
                setSurface({ kind: "map", spaceId });
                applyMutation((current) => {
                  const scoped = mapSpaceDocument(current.document, spaceId);
                  if (!scoped?.nodes[id]) return current;
                  const revealed = revealNode(scoped, id);
                  return {
                    ...revealed,
                    document: mergeMapSpaceDocument(current.document, spaceId, revealed.document),
                  };
                });
                window.requestAnimationFrame(() =>
                  window.requestAnimationFrame(() =>
                    canvasRef.current?.focusSelected(),
                  ),
                );
              } else {
                preloadFlowWorkspace();
                if (surface.kind !== "flow" || surface.spaceId !== spaceId) {
                  pushCurrentSurface(mindNodeInteractionTarget);
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

      {activeCanvasBlankMenu && (
        <CanvasBlankMenu
          clientX={activeCanvasBlankMenu.clientX}
          clientY={activeCanvasBlankMenu.clientY}
          onClose={closeCanvasBlankMenu}
          onCreateNode={createFloatingFromBlankMenu}
          onFit={() => {
            setCanvasBlankMenu(null);
            canvasRef.current?.fit();
          }}
          onPaste={() => {
            setCanvasBlankMenu(null);
            executeAppCommand("node.paste");
          }}
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

      {deleteSubspaceRequest && (() => {
        const { target } = deleteSubspaceRequest;
        const space = documentSpaces(activeMap)[target.spaceId];
        const node = activeMap.nodes[target.anchorNodeId];
        if (
          !space ||
          !node ||
          !isCurrentCanvasInteractionTarget(activeMap, target)
        ) {
          return null;
        }
        return (
          <DeleteSubspaceDialog
            nodeLabel={node.text}
            onCancel={cancelDeleteSubspace}
            onConfirm={confirmDeleteSubspace}
            typeLabel={space.type === "map" ? t("思维图") : t("流程")}
          />
        );
      })()}

      {shortcutSettingsOpen && (
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
      )}

      <input
        accept=".mindmap.json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
        hidden
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
        hidden
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
