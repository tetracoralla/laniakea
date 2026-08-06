import { useCallback, useEffect, useRef, useState } from "react";
import { createBlankDocument } from "../data/seed";
import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from "../model/history";
import {
  createSelection,
  selectionEquals,
  singleSelection,
} from "../model/selection";
import type { DocumentMutation } from "../model/tree";
import {
  sharesDocumentContent,
  shouldDeferUnboundCopyAutosave,
  sourceContentFingerprint,
} from "../persistence/autosavePolicy";
import { listBrowserDocuments } from "../persistence/browserDocumentStore";
import {
  activateLocalDocument,
  clearActiveDocument,
  createMarkdownDraft,
  discardInternalDraft,
  isDesktopRuntime,
  loadLocalDocument,
  moveInternalDraft,
  saveBrowserDocumentSynchronously,
  saveLocalDocument,
} from "../persistence/localDocumentStore";
import {
  forgetRecentDocument,
  isInternalDocumentPath,
  loadRecentDocuments,
  moveRecentDocumentPath,
  persistRecentDocuments,
  rememberRecentDocument,
  updateRecentDocumentTitle,
} from "../persistence/recentDocuments";
import type {
  EditorSnapshot,
  MindMapDocument,
  SaveState,
  SelectionState,
  StartupMode,
  Viewport,
} from "../types/mindmap";
import { useApplicationSaveLifecycle } from "./useApplicationSaveLifecycle";

function isPristineBlankDocument(document: MindMapDocument): boolean {
  const root = document.nodes[document.rootId];
  return (
    Object.keys(document.nodes).length === 1 &&
    root?.text === "" &&
    root.children.length === 0 &&
    document.floatingRoots.length === 0 &&
    document.title === "未命名思维"
  );
}

function freshSnapshot(): EditorSnapshot {
  const document = createBlankDocument();
  return {
    document,
    selection: singleSelection(document.rootId),
  };
}

export interface NewDocumentDraft {
  document: MindMapDocument;
  documentPath: string | null;
  sourceHash: string | null;
}

export interface BrowserSourceProtection {
  name: string;
}

interface MindMapOptions {
  prepareForLifecycleSave?: () => void;
}

export function useMindMap({
  prepareForLifecycleSave,
}: MindMapOptions = {}) {
  const [history, setHistory] = useState(() =>
    createEditorHistory(freshSnapshot()),
  );
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [sourceDocumentPath, setSourceDocumentPath] =
    useState<string | null>(null);
  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  const [startupMode, setStartupMode] =
    useState<StartupMode>("loading");
  const [recentDocuments, setRecentDocuments] = useState(
    loadRecentDocuments,
  );
  const snapshot = history.present;
  const latestDocument = useRef(snapshot.document);
  const documentPathRef = useRef<string | null>(null);
  const sourceDocumentPathRef = useRef<string | null>(null);
  const sourceHashRef = useRef<string | null>(null);
  const startupModeRef = useRef<StartupMode>("loading");
  const startupReadyWaiters = useRef(new Set<() => void>());
  const skipNextSave = useRef<MindMapDocument | null>(null);
  const lastPersistedContentDocument = useRef<MindMapDocument | null>(
    null,
  );
  const protectedUnboundSourceContent = useRef<string | null>(null);
  const protectedUnboundSourceDocument = useRef<MindMapDocument | null>(
    null,
  );
  const protectedUnboundSourcePath = useRef<string | null>(null);
  const protectedBrowserSourceNameRef = useRef<string | null>(null);
  const [protectedBrowserSourceName, setProtectedBrowserSourceName] =
    useState<string | null>(null);
  const silentAutosaveDocuments = useRef(
    new WeakSet<MindMapDocument>(),
  );
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveBeforeSwitchQueue = useRef<Promise<boolean>>(
    Promise.resolve(true),
  );
  const saveRequest = useRef(0);
  const documentSessionRef = useRef(0);
  const [documentSessionId, setDocumentSessionId] = useState(0);

  latestDocument.current = snapshot.document;
  documentPathRef.current = documentPath;
  startupModeRef.current = startupMode;

  const waitForStartupReady = useCallback((): Promise<void> => {
    if (startupModeRef.current !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
      startupReadyWaiters.current.add(resolve);
    });
  }, []);

  const performSave = useCallback(async (
    document?: MindMapDocument,
    pathOverride?: string | null,
    options: {
      newBinding?: boolean;
      silent?: boolean;
    } = {},
  ) => {
    const { newBinding = false, silent = false } = options;
    const target = document ?? latestDocument.current;
    const targetPath =
      pathOverride === undefined
        ? documentPathRef.current
        : pathOverride;
    const protectedSourceForSave = newBinding
      ? protectedUnboundSourcePath.current
      : null;
    if (
      shouldDeferUnboundCopyAutosave(
        target,
        targetPath,
        protectedUnboundSourceContent.current,
        protectedUnboundSourceDocument.current,
      )
    ) {
      setSaveState("saved");
      setSaveError(null);
      setSaveWarning(null);
      return {
        sourceHash: sourceHashRef.current,
        auxiliaryWarning: null,
      };
    }
    if (protectedUnboundSourceContent.current !== null) {
      protectedUnboundSourceContent.current = null;
      protectedUnboundSourceDocument.current = null;
    }
    const request = ++saveRequest.current;
    if (!silent) {
      setSaveState("saving");
      setSaveError(null);
      setSaveWarning(null);
    }

    const queued = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const savingCurrentBinding =
          !newBinding &&
          targetPath !== null &&
          targetPath === documentPathRef.current;
        const expectedSourceHash = savingCurrentBinding
          ? sourceHashRef.current
          : null;
        const viewportOnly = Boolean(
          silent &&
          lastPersistedContentDocument.current &&
          sharesDocumentContent(
            target,
            lastPersistedContentDocument.current,
          ),
        );
        const result = viewportOnly
          ? await saveLocalDocument(
              target,
              targetPath,
              expectedSourceHash,
              protectedSourceForSave,
              { viewportOnly: true },
            )
          : await saveLocalDocument(
              target,
              targetPath,
              expectedSourceHash,
              protectedSourceForSave,
            );
        lastPersistedContentDocument.current = target;
        if (savingCurrentBinding) {
          sourceHashRef.current = result.sourceHash;
        }
        return result;
      });
    saveQueue.current = queued;

    try {
      const result = await queued;
      if (request === saveRequest.current) {
        setSaveState("saved");
        setSaveError(null);
        setSaveWarning(result.auxiliaryWarning ?? null);
      }
      return result;
    } catch (error) {
      if (request === saveRequest.current) {
        setSaveState("error");
        setSaveWarning(null);
        setSaveError(
          error instanceof Error
            ? error.message
            : "无法写入本地文件，请检查磁盘空间或文件权限。",
        );
      }
      return null;
    }
  }, []);

  const saveNow = useCallback(async (
    document?: MindMapDocument,
    pathOverride?: string | null,
  ) => Boolean(await performSave(document, pathOverride)), [performSave]);

  const advanceDocumentSession = useCallback(() => {
    const next = documentSessionRef.current + 1;
    documentSessionRef.current = next;
    setDocumentSessionId(next);
    return next;
  }, []);

  const isDocumentSessionCurrent = useCallback(
    (sessionId: number) => documentSessionRef.current === sessionId,
    [],
  );

  const refreshBrowserDocuments = useCallback(async () => {
    if (isDesktopRuntime()) return;
    try {
      const documents = await listBrowserDocuments();
      setRecentDocuments(
        documents.map((document) => ({
          path: document.documentPath,
          title: document.title,
          lastOpenedAt: document.updatedAt,
        })),
      );
    } catch {
      // The active document load owns the visible storage error. The recent
      // list remains a convenience surface and must not replace that result.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLocalDocument()
      .then(async (loaded) => {
        if (cancelled) return;
        if (loaded.document) {
          advanceDocumentSession();
          documentPathRef.current = loaded.documentPath;
          sourceDocumentPathRef.current = loaded.sourcePath;
          sourceHashRef.current = loaded.sourceHash;
          setDocumentPath(loaded.documentPath);
          setSourceDocumentPath(loaded.sourcePath);
          protectedUnboundSourceContent.current =
            loaded.importedAsCopy && loaded.sourcePath
              ? sourceContentFingerprint(loaded.document)
              : null;
          protectedUnboundSourceDocument.current =
            loaded.importedAsCopy && loaded.sourcePath
              ? loaded.document
              : null;
          protectedUnboundSourcePath.current =
            loaded.importedAsCopy ? loaded.sourcePath : null;
          protectedBrowserSourceNameRef.current =
            loaded.protectedSourceName ?? null;
          setProtectedBrowserSourceName(loaded.protectedSourceName ?? null);
          if (
            !loaded.recoveredFromBackup &&
            protectedUnboundSourceContent.current === null
          ) {
            skipNextSave.current = loaded.document;
            lastPersistedContentDocument.current = loaded.document;
          } else {
            lastPersistedContentDocument.current = null;
          }
          setHistory(
            createEditorHistory({
              document: loaded.document,
              selection: singleSelection(loaded.document.rootId),
            }),
          );
          const recentPath =
            loaded.sourcePath ?? loaded.documentPath;
          if (recentPath) {
            setRecentDocuments((current) =>
              rememberRecentDocument(
                current,
                recentPath,
                loaded.document!.title,
              ),
            );
          }
          setStartupMode("restored");
        } else {
          let freshPath: string | null = null;
          let freshSourceHash: string | null = null;
          if (!isDesktopRuntime() && !loaded.saveError) {
            const created = await createMarkdownDraft(
              latestDocument.current,
            );
            if (cancelled) return;
            freshPath = created.documentPath;
            freshSourceHash = created.sourceHash;
          }
          documentPathRef.current = freshPath;
          sourceDocumentPathRef.current = freshPath;
          sourceHashRef.current = freshSourceHash;
          setDocumentPath(freshPath);
          setSourceDocumentPath(freshPath);
          protectedUnboundSourceContent.current = null;
          protectedUnboundSourceDocument.current = null;
          protectedUnboundSourcePath.current = null;
          protectedBrowserSourceNameRef.current = null;
          setProtectedBrowserSourceName(null);
          lastPersistedContentDocument.current = freshPath
            ? latestDocument.current
            : null;
          if (freshPath) {
            setRecentDocuments((current) =>
              rememberRecentDocument(
                current,
                freshPath,
                latestDocument.current.title,
              ),
            );
          }
          setStartupMode("fresh");
        }

        setStartupNotice(loaded.notice);
        if (loaded.saveError) {
          setSaveState("error");
          setSaveWarning(null);
          setSaveError(loaded.saveError);
        } else {
          setSaveState("saved");
          setSaveError(null);
          setSaveWarning(null);
        }
        await refreshBrowserDocuments();
      })
      .catch(() => {
        if (cancelled) return;
        setStartupMode("fresh");
        setStartupNotice("本地数据无法读取，原文件不会被覆盖。");
        setSaveState("error");
        setSaveWarning(null);
        setSaveError("无法读取本地文件，请从导出的文件或备份恢复。");
      });
    return () => {
      cancelled = true;
    };
  }, [advanceDocumentSession, refreshBrowserDocuments]);

  useEffect(() => {
    persistRecentDocuments(recentDocuments);
  }, [recentDocuments]);

  useEffect(() => {
    if (startupMode === "loading") return;
    startupReadyWaiters.current.forEach((resolve) => resolve());
    startupReadyWaiters.current.clear();
  }, [startupMode]);

  useEffect(() => {
    const recentPath = sourceDocumentPath ?? documentPath;
    if (!recentPath) return;
    setRecentDocuments((current) =>
      updateRecentDocumentTitle(
        current,
        recentPath,
        snapshot.document.title,
      ),
    );
  }, [
    documentPath,
    snapshot.document.title,
    sourceDocumentPath,
  ]);

  useEffect(() => {
    if (startupMode === "loading") return;
    const silent =
      silentAutosaveDocuments.current.delete(snapshot.document);
    if (
      shouldDeferUnboundCopyAutosave(
        snapshot.document,
        documentPath,
        protectedUnboundSourceContent.current,
        protectedUnboundSourceDocument.current,
      )
    ) {
      skipNextSave.current = null;
      setSaveState("saved");
      setSaveError(null);
      setSaveWarning(null);
      return;
    }
    if (protectedUnboundSourceContent.current !== null) {
      protectedUnboundSourceContent.current = null;
      protectedUnboundSourceDocument.current = null;
    }
    if (skipNextSave.current === snapshot.document) {
      skipNextSave.current = null;
      setSaveState("saved");
      setSaveError(null);
      setSaveWarning(null);
      return;
    }

    if (!silent) {
      setSaveState("saving");
      setSaveError(null);
      setSaveWarning(null);
    }
    const timer = window.setTimeout(() => {
      void performSave(snapshot.document, undefined, { silent });
    }, silent ? 900 : 320);
    return () => window.clearTimeout(timer);
  }, [
    documentPath,
    performSave,
    snapshot.document,
    startupMode,
  ]);

  const saveBrowserNow = useCallback(() => {
    if (
      lastPersistedContentDocument.current === latestDocument.current
    ) {
      return;
    }
    saveBrowserDocumentSynchronously(
      latestDocument.current,
      documentPathRef.current,
      sourceHashRef.current,
      protectedBrowserSourceNameRef.current,
    );
  }, []);

  useApplicationSaveLifecycle({
    prepareForSave: prepareForLifecycleSave,
    saveBrowserNow,
    saveNow,
    waitForStartupReady,
  });

  const applyMutation = useCallback(
    (
      mutate: (current: EditorSnapshot) => DocumentMutation,
      expectedDocumentSessionId?: number,
    ) => {
      setHistory((current) => {
        if (
          expectedDocumentSessionId !== undefined &&
          documentSessionRef.current !== expectedDocumentSessionId
        ) {
          return current;
        }
        const next = mutate(current.present);
        if (
          next.document === current.present.document &&
          selectionEquals(next.selection, current.present.selection)
        ) {
          return current;
        }
        if (next.document === current.present.document) {
          return { ...current, present: next };
        }
        return commitEditorHistory(current, next);
      });
    },
    [],
  );

  const installDocument = useCallback((
    document: MindMapDocument,
    path: string | null,
    sourcePath: string | null,
    skipAutosave: boolean,
    protectUnboundCopy = false,
    sourceHash: string | null = null,
    browserSourceName: string | null = null,
  ) => {
    advanceDocumentSession();
    documentPathRef.current = path;
    sourceDocumentPathRef.current = sourcePath;
    sourceHashRef.current = sourceHash;
    setDocumentPath(path);
    setSourceDocumentPath(sourcePath);
    protectedUnboundSourceContent.current = protectUnboundCopy
      ? sourceContentFingerprint(document)
      : null;
    protectedUnboundSourceDocument.current = protectUnboundCopy
      ? document
      : null;
    protectedUnboundSourcePath.current = protectUnboundCopy
      ? sourcePath
      : null;
    protectedBrowserSourceNameRef.current = browserSourceName;
    setProtectedBrowserSourceName(browserSourceName);
    skipNextSave.current =
      skipAutosave && !protectUnboundCopy ? document : null;
    lastPersistedContentDocument.current =
      skipAutosave && !protectUnboundCopy ? document : null;
    const recentPath = sourcePath ?? path;
    if (recentPath) {
      setRecentDocuments((current) =>
        rememberRecentDocument(current, recentPath, document.title),
      );
    }
    setHistory(
      createEditorHistory({
        document,
        selection: singleSelection(document.rootId),
      }),
    );
  }, [advanceDocumentSession]);

  const replaceDocument = useCallback((document: MindMapDocument) => {
    installDocument(document, null, null, false);
  }, [installDocument]);

  const openDocument = useCallback((
    document: MindMapDocument,
    path: string | null,
    sourcePath: string | null,
    recoveredFromBackup = false,
    protectUnboundCopy = false,
    sourceHash: string | null = null,
    browserSourceName: string | null = null,
  ) => {
    installDocument(
      document,
      path,
      sourcePath,
      !recoveredFromBackup,
      protectUnboundCopy,
      sourceHash,
      browserSourceName,
    );
  }, [installDocument]);

  const restoreActiveDocument = useCallback(async (): Promise<void> => {
    const path = documentPathRef.current ?? sourceDocumentPathRef.current;
    if (path) {
      await activateLocalDocument(path);
    } else {
      await clearActiveDocument();
    }
  }, []);

  const preserveCurrentAsBrowserCopy = useCallback(async () => {
    if (isDesktopRuntime()) return null;
    const current = latestDocument.current;
    const currentSession = documentSessionRef.current;
    const protectedSourceName = protectedBrowserSourceNameRef.current;
    try {
      const created = await createMarkdownDraft(
        current,
        false,
        protectedSourceName,
      );
      if (documentSessionRef.current !== currentSession) {
        await discardInternalDraft(created.documentPath);
        return null;
      }
      await activateLocalDocument(created.documentPath);
      if (documentSessionRef.current !== currentSession) {
        await restoreActiveDocument();
        await discardInternalDraft(created.documentPath);
        return null;
      }
      installDocument(
        current,
        created.documentPath,
        created.documentPath,
        true,
        false,
        created.sourceHash,
        protectedSourceName,
      );
      setSaveState("saved");
      setSaveError(null);
      setSaveWarning(null);
      await refreshBrowserDocuments();
      return {
        document: current,
        documentPath: created.documentPath,
        sourceHash: created.sourceHash,
      } satisfies NewDocumentDraft;
    } catch (error) {
      setSaveState("error");
      setSaveWarning(null);
      setSaveError(
        error instanceof Error
          ? error.message
          : "无法把当前修改保留为独立副本。",
      );
      return null;
    }
  }, [installDocument, refreshBrowserDocuments, restoreActiveDocument]);

  const deleteBrowserDocument = useCallback(async (
    path: string,
  ): Promise<boolean> => {
    if (isDesktopRuntime() || path === documentPathRef.current) return false;
    try {
      await discardInternalDraft(path);
      setRecentDocuments((current) => forgetRecentDocument(current, path));
      await refreshBrowserDocuments();
      return true;
    } catch {
      return false;
    }
  }, [refreshBrowserDocuments]);

  const performSaveBeforeSwitch = useCallback(async (): Promise<boolean> => {
    if (documentPathRef.current || !isDesktopRuntime()) {
      return saveNow();
    }
    if (isPristineBlankDocument(latestDocument.current)) return true;

    const request = ++saveRequest.current;
    setSaveState("saving");
    setSaveError(null);
    setSaveWarning(null);
    try {
      const created = await createMarkdownDraft(latestDocument.current);
      protectedUnboundSourceContent.current = null;
      protectedUnboundSourceDocument.current = null;
      protectedUnboundSourcePath.current = null;
      lastPersistedContentDocument.current = latestDocument.current;
      documentPathRef.current = created.documentPath;
      sourceDocumentPathRef.current = created.documentPath;
      sourceHashRef.current = created.sourceHash;
      setDocumentPath(created.documentPath);
      setSourceDocumentPath(created.documentPath);
      setRecentDocuments((current) =>
        rememberRecentDocument(
          current,
          created.documentPath,
          latestDocument.current.title,
        ),
      );
      if (request === saveRequest.current) {
        setSaveState("saved");
        setSaveError(null);
        setSaveWarning(null);
      }
      return true;
    } catch (error) {
      if (request === saveRequest.current) {
        setSaveState("error");
        setSaveWarning(null);
        setSaveError(
          error instanceof Error
            ? error.message
            : "无法创建本地 Markdown 草稿。",
        );
      }
      return false;
    }
  }, [saveNow]);

  const saveBeforeSwitch = useCallback((): Promise<boolean> => {
    const queued = saveBeforeSwitchQueue.current.then(
      performSaveBeforeSwitch,
      performSaveBeforeSwitch,
    );
    saveBeforeSwitchQueue.current = queued;
    return queued;
  }, [performSaveBeforeSwitch]);

  const newDocument = useCallback(async (
    document: MindMapDocument = createBlankDocument(),
    browserSourceProtection: BrowserSourceProtection | null = null,
  ): Promise<NewDocumentDraft> => {
    const created = await createMarkdownDraft(
      document,
      false,
      browserSourceProtection?.name ?? null,
    );
    return {
      document,
      documentPath: created.documentPath,
      sourceHash: created.sourceHash,
    };
  }, []);

  const saveDocumentAs = useCallback(async (
    path: string,
  ): Promise<boolean> => {
    const previousPath = documentPathRef.current;
    let saved: {
      sourceHash: string | null;
      auxiliaryWarning?: string | null;
    } | null = null;
    if (
      previousPath &&
      previousPath !== path &&
      isInternalDocumentPath(previousPath)
    ) {
      const currentSaved = await performSave(
        latestDocument.current,
        previousPath,
      );
      if (!currentSaved) return false;
      const request = ++saveRequest.current;
      setSaveState("saving");
      setSaveError(null);
      setSaveWarning(null);
      try {
        saved = await moveInternalDraft(previousPath, path);
        if (request === saveRequest.current) {
          setSaveState("saved");
          setSaveError(null);
          setSaveWarning(saved.auxiliaryWarning ?? null);
        }
      } catch (error) {
        if (request === saveRequest.current) {
          setSaveState("error");
          setSaveWarning(null);
          setSaveError(
            error instanceof Error
              ? error.message
              : "无法移动本地草稿。",
          );
        }
        return false;
      }
    } else {
      saved = await performSave(
        latestDocument.current,
        path,
        { newBinding: true },
      );
    }
    if (saved) {
      protectedUnboundSourceContent.current = null;
      protectedUnboundSourceDocument.current = null;
      protectedUnboundSourcePath.current = null;
      protectedBrowserSourceNameRef.current = null;
      setProtectedBrowserSourceName(null);
      lastPersistedContentDocument.current = latestDocument.current;
      documentPathRef.current = path;
      sourceDocumentPathRef.current = path;
      sourceHashRef.current = saved.sourceHash;
      setDocumentPath(path);
      setSourceDocumentPath(path);
      setRecentDocuments((current) =>
        rememberRecentDocument(
          previousPath && previousPath !== path
            ? forgetRecentDocument(current, previousPath)
            : current,
          path,
          latestDocument.current.title,
        ),
      );
    }
    return Boolean(saved);
  }, [performSave]);

  const moveRecentDocument = useCallback(async (
    sourcePath: string,
    targetPath: string,
  ): Promise<boolean> => {
    try {
      await moveInternalDraft(sourcePath, targetPath);
      setRecentDocuments((current) =>
        moveRecentDocumentPath(current, sourcePath, targetPath),
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  const selectNode = useCallback((selectedId: string) => {
    setHistory((current) =>
      current.present.document.nodes[selectedId]
        ? {
            ...current,
            present: {
              ...current.present,
              selection: singleSelection(selectedId),
            },
          }
        : current,
    );
  }, []);

  const setSelection = useCallback((selection: SelectionState) => {
    setHistory((current) => {
      const validIds = selection.selectedIds.filter(
        (id) => current.present.document.nodes[id],
      );
      const valid = createSelection(
        validIds,
        validIds,
        selection.primaryId,
      );
      if (selectionEquals(valid, current.present.selection)) return current;
      return {
        ...current,
        present: { ...current.present, selection: valid },
      };
    });
  }, []);

  const setViewport = useCallback((viewport: Viewport) => {
    setHistory((current) => {
      const previous = current.present.document.viewport;
      if (
        previous.x === viewport.x &&
        previous.y === viewport.y &&
        previous.zoom === viewport.zoom
      ) {
        return current;
      }
      const document = { ...current.present.document, viewport };
      silentAutosaveDocuments.current.add(document);
      return {
        ...current,
        present: {
          ...current.present,
          document,
        },
      };
    });
  }, []);

  const undo = useCallback(() => setHistory(undoEditorHistory), []);
  const redo = useCallback(() => setHistory(redoEditorHistory), []);
  const removeRecentDocument = useCallback((path: string) => {
    setRecentDocuments((current) =>
      forgetRecentDocument(current, path),
    );
  }, []);

  return {
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
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
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
    retrySave: saveNow,
    preserveCurrentAsBrowserCopy,
    refreshBrowserDocuments,
    restoreActiveDocument,
    saveBeforeSwitch,
    undo,
    redo,
  };
}
