import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  copyDocumentPath,
  revealDocumentInFileManager,
} from "../desktop/documentFileActions";
import { importDocumentContent } from "../model/import";
import {
  documentToMarkdown,
  markdownToDocument,
} from "../model/markdown";
import {
  exportBrowserLibrary,
  restoreBrowserLibrary,
} from "../persistence/browserDocumentStore";
import {
  chooseDocumentToOpen,
  chooseMarkdownDocumentPath,
} from "../persistence/documentFileDialog";
import type { RecentDocument } from "../persistence/recentDocuments";
import {
  activateLocalDocument,
  browserDocumentConflictMessage,
  clearActiveDocument,
  discardInternalDraft,
  externalDocumentConflictMessage,
  isBrowserDocumentPath,
  isDesktopRuntime,
  openLocalDocument,
  protectedSourceOverwriteMessage,
  readOutlineFile,
  shouldFitLoadedDocument,
} from "../persistence/localDocumentStore";
import type { AppNotice } from "../types/feedback";
import type {
  MindMapDocument,
  SaveState,
} from "../types/mindmap";

interface DocumentWorkflowOptions {
  document: MindMapDocument;
  documentPath: string | null;
  currentDocumentPath: string | null;
  documentSessionId?: number;
  isDocumentSessionCurrent?: (sessionId: number) => boolean;
  recentDocuments: RecentDocument[];
  saveState: SaveState;
  saveError: string | null;
  saveWarning?: string | null;
  protectedBrowserSourceName?: string | null;
  notify: (notice: AppNotice) => void;
  newDocument: (
    document?: MindMapDocument,
    browserSourceProtection?: { name: string } | null,
  ) => Promise<{
    document: MindMapDocument;
    documentPath: string | null;
    sourceHash: string | null;
  }>;
  openDocument: (
    document: MindMapDocument,
    path: string | null,
    sourcePath: string | null,
    recoveredFromBackup?: boolean,
    protectUnboundCopy?: boolean,
    sourceHash?: string | null,
    protectedBrowserSourceName?: string | null,
  ) => void;
  replaceDocument: (document: MindMapDocument) => void;
  saveDocumentAs: (path: string) => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  saveBeforeSwitch: () => Promise<boolean>;
  beginBlankDocument: (rootId: string) => void;
  finishDocumentSwitch: (fitContent: boolean) => void;
  moveRecentDocument: (
    sourcePath: string,
    targetPath: string,
  ) => Promise<boolean>;
  removeRecentDocument: (path: string) => void;
  refreshBrowserDocuments?: () => Promise<void>;
  restoreActiveDocument?: () => Promise<void>;
  preserveCurrentAsBrowserCopy?: () => Promise<{
    document: MindMapDocument;
    documentPath: string | null;
    sourceHash: string | null;
  } | null>;
  deleteBrowserDocument?: (path: string) => Promise<boolean>;
}

function downloadText(
  filename: string,
  content: string | ArrayBuffer,
  type: string,
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "未命名思维";
}

interface BrowserWritableFile {
  write: (data: string | ArrayBuffer) => Promise<void>;
  close: () => Promise<void>;
}

interface BrowserFileHandle {
  name?: string;
  createWritable: () => Promise<BrowserWritableFile>;
  getFile?: () => Promise<File>;
  isSameEntry?: (other: BrowserFileHandle) => Promise<boolean>;
}

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<BrowserFileHandle>;
  showOpenFilePicker?: (options: {
    multiple: false;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<BrowserFileHandle[]>;
};

export function useDocumentWorkflow({
  document,
  documentPath,
  currentDocumentPath,
  documentSessionId = 0,
  isDocumentSessionCurrent = () => true,
  recentDocuments,
  saveState,
  saveError,
  saveWarning = null,
  protectedBrowserSourceName = null,
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
  removeRecentDocument,
  refreshBrowserDocuments = async () => undefined,
  restoreActiveDocument = async () => undefined,
  preserveCurrentAsBrowserCopy = async () => null,
  deleteBrowserDocument = async () => false,
}: DocumentWorkflowOptions) {
  const importInputRef: RefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement>(null);
  const backupInputRef: RefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement>(null);
  const announcedSaveError = useRef<string | null>(null);
  const announcedSaveWarning = useRef<string | null>(null);
  const documentSwitchRequest = useRef(0);
  const activationQueue = useRef<Promise<void>>(Promise.resolve());
  const browserSourceHandles = useRef(new Map<string, BrowserFileHandle>());
  const importPickedFile = useRef<(
    file: File,
    handle?: BrowserFileHandle,
  ) => Promise<void>>(
    async (_file: File, _handle?: BrowserFileHandle) => undefined,
  );

  const beginDocumentSwitch = useCallback(
    () => ++documentSwitchRequest.current,
    [],
  );

  const isDocumentSwitchCurrent = useCallback(
    (request: number) => request === documentSwitchRequest.current,
    [],
  );

  const prepareDocumentSwitch = useCallback(async (request: number) => {
    const saved = await saveBeforeSwitch();
    if (!isDocumentSwitchCurrent(request)) return false;
    if (!saved) {
      notify({
        message: "当前思维导图保存失败，未切换文件",
        tone: "error",
      });
    }
    return saved;
  }, [isDocumentSwitchCurrent, notify, saveBeforeSwitch]);

  const activateDocumentForSwitch = useCallback(async (
    request: number,
    path: string | null,
  ): Promise<boolean> => {
    const activation = activationQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (!isDocumentSwitchCurrent(request)) return false;
        if (path) {
          await activateLocalDocument(path);
        } else {
          await clearActiveDocument();
        }
        if (isDocumentSwitchCurrent(request)) return true;
        // Activation can finish after a newer user action supersedes this
        // request. Re-save and explicitly restore the still-visible document;
        // browser saves do not update the IndexedDB startup pointer by design.
        await restoreActiveDocument();
        await retrySave();
        return false;
      });
    activationQueue.current = activation.then(
      () => undefined,
      () => undefined,
    );
    return activation;
  }, [isDocumentSwitchCurrent, restoreActiveDocument, retrySave]);

  const discardStaleNewDocument = useCallback(
    (path: string | null) => {
      if (!path) return;
      const cleanup = activationQueue.current
        .catch(() => undefined)
        .then(() => discardInternalDraft(path));
      activationQueue.current = cleanup.then(
        () => undefined,
        () => undefined,
      );
    },
    [],
  );

  const openDocumentPath = useCallback(async (
    path: string,
    fromRecent = false,
    requestOverride?: number,
  ): Promise<boolean> => {
    const request = requestOverride ?? beginDocumentSwitch();
    const isCurrentRequest = () => isDocumentSwitchCurrent(request);
    try {
      if (!(await prepareDocumentSwitch(request))) return false;
      if (!isCurrentRequest()) return false;
      if (
        isBrowserDocumentPath(path) ||
        /\.(md|markdown|mindmap\.json)$/i.test(path)
      ) {
        const loaded = await openLocalDocument(path);
        if (!isCurrentRequest()) return false;
        if (!loaded.document) throw new Error("原生文件没有可读取的内容");
        const activationPath = isBrowserDocumentPath(path)
          ? loaded.documentPath
          : loaded.sourceFormat === "markdown"
            ? loaded.sourcePath
            : null;
        if (
          !(await activateDocumentForSwitch(
            request,
            activationPath,
          ))
        ) {
          return false;
        }
        if (!isCurrentRequest()) return false;
        openDocument(
          loaded.document,
          loaded.documentPath,
          loaded.sourcePath,
          loaded.recoveredFromBackup,
          loaded.importedAsCopy,
          loaded.sourceHash,
          loaded.protectedSourceName ?? null,
        );
        notify({
          message:
            loaded.notice ??
            `已打开“${loaded.document.title}”`,
        });
        finishDocumentSwitch(shouldFitLoadedDocument(loaded));
      } else {
        const content = await readOutlineFile(path);
        if (!isCurrentRequest()) return false;
        const fileName = path.split(/[\\/]/).pop() ?? "导入的大纲";
        const title = fileName.replace(/\.txt$/i, "");
        const imported = markdownToDocument(content, title);
        if (!(await activateDocumentForSwitch(request, null))) {
          return false;
        }
        if (!isCurrentRequest()) return false;
        replaceDocument(imported);
        notify({
          message: `已导入 ${Object.keys(imported.nodes).length} 个节点`,
        });
        finishDocumentSwitch(true);
      }
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      const message =
        error instanceof Error ? error.message : "无法打开这个文件";
      const isMissingRecent =
        fromRecent && /不存在|找不到|no such file/i.test(message);
      notify({
        message,
        tone: "error",
        actionLabel: isMissingRecent ? "移除记录" : undefined,
        onAction: isMissingRecent
          ? () => removeRecentDocument(path)
          : undefined,
      });
      return false;
    }
  }, [
    activateDocumentForSwitch,
    beginDocumentSwitch,
    finishDocumentSwitch,
    isDocumentSwitchCurrent,
    notify,
    openDocument,
    prepareDocumentSwitch,
    removeRecentDocument,
    replaceDocument,
  ]);

  const openRecentDocument = useCallback(
    (path: string) => openDocumentPath(path, true),
    [openDocumentPath],
  );

  const openImport = useCallback(() => {
    const request = beginDocumentSwitch();
    if (!isDesktopRuntime()) {
      const browserWindow = window as FilePickerWindow;
      if (browserWindow.showOpenFilePicker) {
        void (async () => {
          try {
            const [handle] = await browserWindow.showOpenFilePicker!({
              multiple: false,
              types: [
                {
                  description: "Markdown 或 Laniakea 文档",
                  accept: {
                    "text/markdown": [".md", ".markdown"],
                    "text/plain": [".txt"],
                    "application/json": [".mindmap.json"],
                  },
                },
              ],
            });
            if (!handle?.getFile || !isDocumentSwitchCurrent(request)) return;
            await importPickedFile.current(await handle.getFile(), handle);
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            if (!isDocumentSwitchCurrent(request)) return;
            notify({
              message:
                error instanceof Error ? error.message : "无法打开这个文件",
              tone: "error",
            });
          }
        })();
      } else {
        importInputRef.current?.click();
      }
      return;
    }
    void (async () => {
      try {
        const path = await chooseDocumentToOpen({
          currentPath: currentDocumentPath,
          recentDocuments,
        });
        if (!isDocumentSwitchCurrent(request)) return;
        if (path) await openDocumentPath(path, false, request);
      } catch (error) {
        if (!isDocumentSwitchCurrent(request)) return;
        notify({
          message:
            error instanceof Error ? error.message : "无法打开这个文件",
          tone: "error",
        });
      }
    })();
  }, [
    beginDocumentSwitch,
    isDocumentSwitchCurrent,
    notify,
    openDocumentPath,
    currentDocumentPath,
    recentDocuments,
  ]);

  const createNewDocument = useCallback(() => {
    const request = beginDocumentSwitch();
    void (async () => {
      if (!(await prepareDocumentSwitch(request))) return;
      try {
        const blank = await newDocument();
        if (!isDocumentSwitchCurrent(request)) {
          discardStaleNewDocument(blank.documentPath);
          return;
        }
        if (
          !(await activateDocumentForSwitch(
            request,
            blank.documentPath,
          ))
        ) {
          discardStaleNewDocument(blank.documentPath);
          return;
        }
        if (!isDocumentSwitchCurrent(request)) {
          discardStaleNewDocument(blank.documentPath);
          return;
        }
        openDocument(
          blank.document,
          blank.documentPath,
          blank.documentPath,
          false,
          false,
          blank.sourceHash,
        );
        beginBlankDocument(blank.document.rootId);
      } catch (error) {
        if (!isDocumentSwitchCurrent(request)) return;
        notify({
          message:
            error instanceof Error
              ? error.message
              : "无法新建思维导图",
          tone: "error",
        });
      }
    })();
  }, [
    activateDocumentForSwitch,
    beginDocumentSwitch,
    beginBlankDocument,
    discardStaleNewDocument,
    isDocumentSwitchCurrent,
    newDocument,
    notify,
    openDocument,
    prepareDocumentSwitch,
  ]);

  const saveAsMarkdownDocument = useCallback(async (): Promise<boolean> => {
    const operationSessionId = documentSessionId;
    if (!isDesktopRuntime()) {
      const protectsImportedSource = Boolean(protectedBrowserSourceName);
      const filename = `${safeFilename(document.title)}${
        protectsImportedSource ? " - Laniakea" : ""
      }.md`;
      const content = documentToMarkdown(document);
      const browserWindow = window as FilePickerWindow;
      if (browserWindow.showSaveFilePicker) {
        try {
          const protectedHandle = documentPath
            ? browserSourceHandles.current.get(documentPath)
            : undefined;
          let protectedSourceBytes: ArrayBuffer | null = null;
          if (protectedHandle) {
            if (!protectedHandle.getFile) {
              notify({
                message: "无法读取原始 Markdown，已取消另存以保护源文件",
                tone: "error",
              });
              return false;
            }
            try {
              protectedSourceBytes = await (
                await protectedHandle.getFile()
              ).arrayBuffer();
            } catch {
              notify({
                message: "无法读取原始 Markdown，已取消另存以保护源文件",
                tone: "error",
              });
              return false;
            }
          }
          const handle = await browserWindow.showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: "Markdown",
                accept: { "text/markdown": [".md", ".markdown"] },
              },
            ],
          });
          if (
            protectedHandle &&
            handle.isSameEntry &&
            await handle.isSameEntry(protectedHandle)
          ) {
            if (protectedSourceBytes !== null) {
              try {
                const sourceWritable = await handle.createWritable();
                await sourceWritable.write(protectedSourceBytes);
                await sourceWritable.close();
              } catch {
                const recoveryName = `${safeFilename(
                  (protectedBrowserSourceName ?? document.title).replace(
                    /\.(md|markdown|txt)$/i,
                    "",
                  ),
                )} - 原文件恢复.md`;
                downloadText(
                  recoveryName,
                  protectedSourceBytes,
                  "text/markdown;charset=utf-8",
                );
                notify({
                  message:
                    "无法自动还原原始 Markdown，原内容已下载为恢复文件",
                  tone: "error",
                });
                return false;
              }
            }
            notify({
              message: protectedSourceOverwriteMessage,
              tone: "error",
            });
            return false;
          }
          if (!isDocumentSessionCurrent(operationSessionId)) return false;
          const writable = await handle.createWritable();
          await writable.write(content);
          await writable.close();
          notify({ message: "Markdown 已保存到所选文件" });
          return true;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return false;
          }
          notify({
            message:
              error instanceof Error ? error.message : "无法保存 Markdown",
            tone: "error",
          });
          return false;
        }
      }
      downloadText(filename, content, "text/markdown;charset=utf-8");
      notify({ message: "Markdown 已下载" });
      return true;
    }

    try {
      const protectsUnboundSource =
        documentPath === null && currentDocumentPath !== null;
      const path = await chooseMarkdownDocumentPath(
        `${safeFilename(document.title)}${
          protectsUnboundSource ? " - 另存" : ""
        }`,
        {
          currentPath: currentDocumentPath,
          recentDocuments,
        },
      );
      if (!path) return false;
      if (!isDocumentSessionCurrent(operationSessionId)) return false;
      const saved = await saveDocumentAs(path);
      notify({
        message: saved ? "已另存为 Markdown" : "另存失败，请重试",
        tone: saved ? "neutral" : "error",
      });
      return saved;
    } catch (error) {
      notify({
        message:
          error instanceof Error ? error.message : "无法另存 Markdown",
        tone: "error",
      });
      return false;
    }
  }, [
    currentDocumentPath,
    document,
    documentPath,
    documentSessionId,
    isDocumentSessionCurrent,
    notify,
    protectedBrowserSourceName,
    recentDocuments,
    saveDocumentAs,
  ]);

  const exportFullBackup = useCallback(async (): Promise<boolean> => {
    if (isDesktopRuntime()) return false;
    try {
      if (!(await saveBeforeSwitch())) {
        notify({
          message: "当前思维导图保存失败，未导出完整备份",
          tone: "error",
        });
        return false;
      }
      const backup = await exportBrowserLibrary();
      const date = new Date().toISOString().slice(0, 10);
      downloadText(
        `laniakea-backup-${date}.json`,
        JSON.stringify(backup, null, 2),
        "application/json;charset=utf-8",
      );
      notify({
        message: `已导出 ${backup.documents.length} 张思维导图的完整备份`,
      });
      return true;
    } catch (error) {
      notify({
        message:
          error instanceof Error ? error.message : "无法导出完整备份",
        tone: "error",
      });
      return false;
    }
  }, [notify, saveBeforeSwitch]);

  const openFullBackupRestore = useCallback(() => {
    if (!isDesktopRuntime()) backupInputRef.current?.click();
  }, []);

  const restoreFullBackup = useCallback(async (file: File) => {
    const request = beginDocumentSwitch();
    try {
      if (!(await prepareDocumentSwitch(request))) return false;
      const rawBackup: unknown = JSON.parse(await file.text());
      if (!isDocumentSwitchCurrent(request)) return false;
      const restored = await restoreBrowserLibrary(rawBackup);
      if (!isDocumentSwitchCurrent(request)) return false;
      await refreshBrowserDocuments();
      const active = restored.activeDocument;
      if (active) {
        if (
          !(await activateDocumentForSwitch(
            request,
            active.documentPath,
          ))
        ) {
          return false;
        }
        if (!isDocumentSwitchCurrent(request)) return false;
        openDocument(
          active.document,
          active.documentPath,
          active.documentPath,
          false,
          false,
          active.sourceHash,
          active.protectedSourceName,
        );
        finishDocumentSwitch(false);
      }
      notify({
        message:
          restored.count > 0
            ? `已恢复 ${restored.count} 张思维导图`
            : "备份中没有思维导图",
      });
      return true;
    } catch (error) {
      if (!isDocumentSwitchCurrent(request)) return false;
      notify({
        message:
          error instanceof Error ? error.message : "无法恢复完整备份",
        tone: "error",
      });
      return false;
    }
  }, [
    activateDocumentForSwitch,
    beginDocumentSwitch,
    finishDocumentSwitch,
    isDocumentSwitchCurrent,
    notify,
    openDocument,
    prepareDocumentSwitch,
    refreshBrowserDocuments,
  ]);

  const preserveBrowserConflict = useCallback(async () => {
    const previousPath = documentPath;
    const preserved = await preserveCurrentAsBrowserCopy();
    if (!preserved?.documentPath) {
      notify({
        message: "无法把当前修改保留为独立副本",
        tone: "error",
      });
      return;
    }
    if (previousPath) {
      const handle = browserSourceHandles.current.get(previousPath);
      if (handle) {
        browserSourceHandles.current.set(preserved.documentPath, handle);
      }
    }
    notify({ message: "当前修改已保留为独立副本" });
  }, [documentPath, notify, preserveCurrentAsBrowserCopy]);

  const saveErrorActionLabel =
    saveError === browserDocumentConflictMessage && !isDesktopRuntime()
      ? "保留为副本"
      : saveError === externalDocumentConflictMessage && isDesktopRuntime()
        ? "另存为"
        : "重试";

  const resolveSaveError = useCallback(() => {
    if (
      saveError === browserDocumentConflictMessage &&
      !isDesktopRuntime()
    ) {
      void preserveBrowserConflict();
      return;
    }
    if (
      saveError === externalDocumentConflictMessage &&
      isDesktopRuntime()
    ) {
      void saveAsMarkdownDocument();
      return;
    }
    void retrySave();
  }, [preserveBrowserConflict, retrySave, saveAsMarkdownDocument, saveError]);

  useEffect(() => {
    if (!saveError) {
      announcedSaveError.current = null;
      return;
    }
    if (
      saveState !== "error" ||
      announcedSaveError.current === saveError
    ) {
      return;
    }
    announcedSaveError.current = saveError;
    notify({
      message: saveError,
      tone: "error",
      actionLabel: saveErrorActionLabel,
      onAction: resolveSaveError,
    });
  }, [
    notify,
    resolveSaveError,
    saveErrorActionLabel,
    saveError,
    saveState,
  ]);

  useEffect(() => {
    if (!saveWarning) {
      announcedSaveWarning.current = null;
      return;
    }
    if (announcedSaveWarning.current === saveWarning) return;
    announcedSaveWarning.current = saveWarning;
    notify({ message: saveWarning });
  }, [notify, saveWarning]);

  const saveCurrentDocument = useCallback(async (): Promise<boolean> => {
    if (isDesktopRuntime() && !documentPath) {
      return saveAsMarkdownDocument();
    }
    return retrySave();
  }, [documentPath, retrySave, saveAsMarkdownDocument]);

  const revealRecentDocument = useCallback((path: string) => {
    void (async () => {
      try {
        await revealDocumentInFileManager(path);
        notify({ message: "已在访达中显示" });
      } catch (error) {
        const message =
          typeof error === "string"
            ? error
            : error instanceof Error
            ? error.message
            : "无法在访达中显示这个文件";
        const isMissing = /不存在|找不到|no such file/i.test(message);
        notify({
          message,
          tone: "error",
          actionLabel: isMissing ? "移除记录" : undefined,
          onAction: isMissing
            ? () => removeRecentDocument(path)
            : undefined,
        });
      }
    })();
  }, [notify, removeRecentDocument]);

  const copyRecentDocumentPath = useCallback((path: string) => {
    void (async () => {
      try {
        await copyDocumentPath(path);
        notify({ message: "文件路径已复制" });
      } catch (error) {
        notify({
          message:
            error instanceof Error
              ? error.message
              : "无法复制文件路径",
          tone: "error",
        });
      }
    })();
  }, [notify]);

  const forgetRecentDocument = useCallback((path: string) => {
    removeRecentDocument(path);
    notify({ message: "已从最近编辑中移除" });
  }, [notify, removeRecentDocument]);

  const moveRecentDocumentToDirectory = useCallback((path: string) => {
    const operationSessionId = documentSessionId;
    void (async () => {
      const recent = recentDocuments.find(
        (document) => document.path === path,
      );
      if (!recent) return;
      try {
        const target = await chooseMarkdownDocumentPath(
          safeFilename(recent.title),
          {
            currentPath: currentDocumentPath,
            recentDocuments,
          },
        );
        if (!target || target === path) return;
        if (!isDocumentSessionCurrent(operationSessionId)) return;
        const moved = await moveRecentDocument(path, target);
        notify({
          message: moved ? "已移动到新位置" : "移动失败，原草稿仍保留",
          tone: moved ? "neutral" : "error",
        });
      } catch (error) {
        notify({
          message:
            error instanceof Error
              ? error.message
              : "移动失败，原草稿仍保留",
          tone: "error",
        });
      }
    })();
  }, [
    currentDocumentPath,
    documentSessionId,
    isDocumentSessionCurrent,
    moveRecentDocument,
    notify,
    recentDocuments,
  ]);

  const importFile = useCallback(
    async (file: File, fileHandle?: BrowserFileHandle) => {
      const request = beginDocumentSwitch();
      try {
        if (!(await prepareDocumentSwitch(request))) return;
        const content = await file.text();
        if (!isDocumentSwitchCurrent(request)) return;
        const imported = importDocumentContent(file.name, content);
        if (!isDesktopRuntime()) {
          const sourceProtection =
            imported.kind === "outline" && !imported.canOverwriteSource
              ? { name: file.name }
              : null;
          const stored = await newDocument(
            imported.document,
            sourceProtection,
          );
          if (!isDocumentSwitchCurrent(request)) {
            discardStaleNewDocument(stored.documentPath);
            return;
          }
          if (
            !(await activateDocumentForSwitch(
              request,
              stored.documentPath,
            ))
          ) {
            discardStaleNewDocument(stored.documentPath);
            return;
          }
          if (!isDocumentSwitchCurrent(request)) {
            discardStaleNewDocument(stored.documentPath);
            return;
          }
          if (sourceProtection && fileHandle && stored.documentPath) {
            browserSourceHandles.current.set(
              stored.documentPath,
              fileHandle,
            );
          }
          openDocument(
            stored.document,
            stored.documentPath,
            stored.documentPath,
            false,
            false,
            stored.sourceHash,
            sourceProtection?.name ?? null,
          );
        } else {
          if (!(await activateDocumentForSwitch(request, null))) return;
          if (!isDocumentSwitchCurrent(request)) return;
          replaceDocument(imported.document);
        }
        notify({
          message:
            imported.kind === "native"
              ? `已打开“${imported.document.title}”`
              : `已导入 ${Object.keys(imported.document.nodes).length} 个节点`,
        });
        finishDocumentSwitch(imported.kind === "outline");
      } catch (error) {
        if (!isDocumentSwitchCurrent(request)) return;
        notify({
          message:
            error instanceof Error ? error.message : "无法导入这个文件",
          tone: "error",
        });
      }
    },
    [
      activateDocumentForSwitch,
      beginDocumentSwitch,
      discardStaleNewDocument,
      finishDocumentSwitch,
      isDocumentSwitchCurrent,
      newDocument,
      notify,
      openDocument,
      prepareDocumentSwitch,
      replaceDocument,
    ],
  );

  importPickedFile.current = importFile;

  const deleteBrowserLibraryDocument = useCallback((path: string) => {
    const item = recentDocuments.find((document) => document.path === path);
    if (!item) return;
    if (!window.confirm(`确定从此浏览器删除“${item.title}”吗？`)) return;
    void (async () => {
      const deleted = await deleteBrowserDocument(path);
      if (deleted) browserSourceHandles.current.delete(path);
      notify({
        message: deleted ? "已从此浏览器删除" : "无法删除这张思维导图",
        tone: deleted ? "neutral" : "error",
      });
    })();
  }, [deleteBrowserDocument, notify, recentDocuments]);

  return {
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
  };
}
