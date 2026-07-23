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
  isDesktopRuntime,
  loadLocalDocument,
  saveBrowserDocumentSynchronously,
  saveLocalDocument,
} from "../persistence/localDocumentStore";
import type {
  EditorSnapshot,
  MindMapDocument,
  SaveState,
  SelectionState,
  StartupMode,
  Viewport,
} from "../types/mindmap";

function freshSnapshot(): EditorSnapshot {
  const document = createBlankDocument();
  return {
    document,
    selection: singleSelection(document.rootId),
  };
}

export function useMindMap() {
  const [history, setHistory] = useState(() =>
    createEditorHistory(freshSnapshot()),
  );
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  const [startupMode, setStartupMode] =
    useState<StartupMode>("loading");
  const snapshot = history.present;
  const latestDocument = useRef(snapshot.document);
  const startupModeRef = useRef<StartupMode>("loading");
  const skipNextSave = useRef<MindMapDocument | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRequest = useRef(0);

  latestDocument.current = snapshot.document;
  startupModeRef.current = startupMode;

  const saveNow = useCallback(async (document?: MindMapDocument) => {
    const target = document ?? latestDocument.current;
    const request = ++saveRequest.current;
    setSaveState("saving");
    setSaveError(null);

    const queued = saveQueue.current
      .catch(() => undefined)
      .then(() => saveLocalDocument(target));
    saveQueue.current = queued;

    try {
      await queued;
      if (request === saveRequest.current) {
        setSaveState("saved");
        setSaveError(null);
      }
      return true;
    } catch (error) {
      if (request === saveRequest.current) {
        setSaveState("error");
        setSaveError(
          error instanceof Error
            ? error.message
            : "无法写入本地文件，请检查磁盘空间或文件权限。",
        );
      }
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLocalDocument()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.document) {
          if (!loaded.recoveredFromBackup) {
            skipNextSave.current = loaded.document;
          }
          setHistory(
            createEditorHistory({
              document: loaded.document,
              selection: singleSelection(loaded.document.rootId),
            }),
          );
          setStartupMode("restored");
        } else {
          setStartupMode("fresh");
        }

        setStartupNotice(loaded.notice);
        if (loaded.saveError) {
          setSaveState("error");
          setSaveError(loaded.saveError);
        } else {
          setSaveState("saved");
          setSaveError(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStartupMode("fresh");
        setStartupNotice("本地数据无法读取，原文件不会被覆盖。");
        setSaveState("error");
        setSaveError("无法读取本地文件，请从导出的文件或备份恢复。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (startupMode === "loading") return;
    if (skipNextSave.current === snapshot.document) {
      skipNextSave.current = null;
      return;
    }

    setSaveState("saving");
    setSaveError(null);
    const timer = window.setTimeout(() => {
      void saveNow(snapshot.document);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [saveNow, snapshot.document, startupMode]);

  useEffect(() => {
    if (isDesktopRuntime()) {
      let unlisten: (() => void) | undefined;
      let active = true;
      void import("@tauri-apps/api/window").then(
        async ({ getCurrentWindow }) => {
          if (!active) return;
          const appWindow = getCurrentWindow();
          unlisten = await appWindow.onCloseRequested(async (event) => {
            if (startupModeRef.current === "loading") return;
            event.preventDefault();
            if (await saveNow()) {
              await appWindow.destroy();
            }
          });
        },
      );
      return () => {
        active = false;
        unlisten?.();
      };
    }

    const flush = () => {
      try {
        saveBrowserDocumentSynchronously(latestDocument.current);
      } catch {
        // A normal autosave already exposes the failure in the top bar.
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [saveNow]);

  const applyMutation = useCallback(
    (mutate: (current: EditorSnapshot) => DocumentMutation) => {
      setHistory((current) => {
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

  const replaceDocument = useCallback((document: MindMapDocument) => {
    setHistory((current) =>
      commitEditorHistory(current, {
        document,
        selection: singleSelection(document.rootId),
      }),
    );
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
    setHistory((current) => ({
      ...current,
      present: {
        ...current.present,
        document: { ...current.present.document, viewport },
      },
    }));
  }, []);

  const undo = useCallback(() => setHistory(undoEditorHistory), []);
  const redo = useCallback(() => setHistory(redoEditorHistory), []);

  return {
    snapshot,
    saveState,
    saveError,
    startupNotice,
    startupMode,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    applyMutation,
    replaceDocument,
    selectNode,
    setSelection,
    setViewport,
    retrySave: saveNow,
    undo,
    redo,
  };
}
