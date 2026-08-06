import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseMindMapDocument } from "../model/document";
import {
  documentToMarkdown,
  parseMarkdownDocument,
} from "../model/markdown";
import type { MindMapDocument } from "../types/mindmap";
import {
  activateBrowserDocument,
  BrowserDocumentConflictError,
  clearActiveBrowserDocument,
  createBrowserDocument,
  discardBrowserDocument,
  isBrowserDocumentPath,
  loadActiveBrowserDocument,
  openBrowserDocument,
  requestPersistentBrowserStorage,
  saveBrowserDocument,
} from "./browserDocumentStore";
export { isBrowserDocumentPath } from "./browserDocumentStore";

const legacyStorageKey = "origin.mindmap.v1";
const legacyBrowserRecoveryKey = "laniakea.browser-recovery.v1";
const browserRecoveryPrefix = "laniakea.browser-recovery.v2.";
const browserTabStorageKey = "laniakea.browser-tab.v1";
let fallbackBrowserTabId: string | null = null;

interface BackendLoadResult {
  document: string | null;
  outlineContent: string | null;
  documentFormat: "native" | "markdown" | null;
  documentPath: string | null;
  recoveredFromBackup: boolean;
  notice: string | null;
  sourceHash: string | null;
}

interface BackendSaveResult {
  sourceHash: string | null;
  auxiliaryWarning: string | null;
}

interface BackendCreateDraftResult {
  documentPath: string;
  sourceHash: string;
}

export interface DocumentLoadResult {
  document: MindMapDocument | null;
  documentPath: string | null;
  sourcePath: string | null;
  recoveredFromBackup: boolean;
  notice: string | null;
  saveError: string | null;
  sourceFormat: "native" | "markdown" | "recovery";
  importedAsCopy: boolean;
  viewStateRestored: boolean;
  sourceHash: string | null;
  protectedSourceName?: string | null;
}

export interface DocumentSaveResult {
  sourceHash: string | null;
  auxiliaryWarning: string | null;
}

interface DocumentSaveOptions {
  viewportOnly?: boolean;
}

export interface DraftDocumentResult {
  documentPath: string;
  sourceHash: string;
}

export function shouldFitLoadedDocument(
  loaded: Pick<DocumentLoadResult, "viewStateRestored">,
): boolean {
  return !loaded.viewStateRestored;
}

export class PersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
  }
}

export const externalDocumentConflictMessage =
  "文件已在外部修改或移动，原文件未被覆盖。";
export const browserDocumentConflictMessage =
  "这张思维导图已在另一个标签页更新，当前修改没有覆盖较新的版本。";
export const protectedSourceOverwriteMessage =
  "这个文件包含 Laniakea 无法完整保留的 Markdown 内容，请另存到其他位置。";
export const auxiliarySaveWarningMessage =
  "正文已经保存，但本地视图状态或旧备份清理未完成。";

export class ExternalDocumentConflictError extends PersistenceError {
  constructor(options?: ErrorOptions) {
    super(externalDocumentConflictMessage, options);
    this.name = "ExternalDocumentConflictError";
  }
}

export function isDesktopRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
  };
  return (
    isTauri() ||
    (
      "__TAURI_INTERNALS__" in runtime &&
      typeof runtime.__TAURI_INTERNALS__ === "object"
    )
  );
}

export function isMarkdownDocumentPath(path: string | null): boolean {
  return Boolean(path && /\.(md|markdown)$/i.test(path));
}

function titleFromPath(path: string | null): string {
  const fileName = path?.split(/[\\/]/).pop() ?? "导入的思维";
  return fileName.replace(/\.(md|markdown|txt)$/i, "");
}

async function parseBackendDocument(
  loaded: BackendLoadResult,
): Promise<DocumentLoadResult> {
  if (loaded.documentFormat === "markdown" && loaded.outlineContent !== null) {
    const parsed = parseMarkdownDocument(
      loaded.outlineContent,
      titleFromPath(loaded.documentPath),
    );
    if (!parsed.canOverwriteSource) {
      return {
        document: parsed.document,
        documentPath: null,
        sourcePath: loaded.documentPath,
        recoveredFromBackup: loaded.recoveredFromBackup,
        notice: loaded.notice,
        saveError: null,
        sourceFormat: "markdown",
        importedAsCopy: true,
        viewStateRestored: false,
        sourceHash: null,
      };
    }

    let document = parsed.document;
    let viewStateRestored = false;
    if (loaded.document) {
      try {
        document = parseMindMapDocument(loaded.document);
        viewStateRestored = true;
      } catch {
        // The Markdown source remains authoritative if its local view cache
        // cannot be read.
      }
    }
    return {
      document,
      documentPath: loaded.documentPath,
      sourcePath: loaded.documentPath,
      recoveredFromBackup: loaded.recoveredFromBackup,
      notice: loaded.notice,
      saveError: null,
      sourceFormat: "markdown",
      importedAsCopy: false,
      viewStateRestored,
      sourceHash: loaded.sourceHash ?? null,
    };
  }

  const nativeDocument = loaded.document
    ? parseMindMapDocument(loaded.document)
    : null;
  const openingLegacyNativeFile = Boolean(
    nativeDocument && loaded.documentPath,
  );
  return {
    document: nativeDocument,
    documentPath: openingLegacyNativeFile ? null : loaded.documentPath,
    sourcePath: loaded.documentPath,
    recoveredFromBackup: loaded.recoveredFromBackup,
    notice: openingLegacyNativeFile
      ? "已打开旧版 Laniakea 备份；保存时请选择 Markdown 文件，原备份不会被覆盖。"
      : loaded.notice,
    saveError: null,
    sourceFormat: loaded.documentPath ? "native" : "recovery",
    importedAsCopy: openingLegacyNativeFile,
    viewStateRestored: Boolean(loaded.document),
    sourceHash: null,
  };
}

function readLegacyDocument(): {
  document: MindMapDocument | null;
  notice: string | null;
  saveError: string | null;
} {
  let stored: string | null;
  try {
    stored = localStorage.getItem(legacyStorageKey);
  } catch (error) {
    return {
      document: null,
      notice: "浏览器存储当前不可用。",
      saveError: friendlySaveError(error).message,
    };
  }
  if (!stored) {
    return { document: null, notice: null, saveError: null };
  }

  try {
    const parsed = parseMindMapDocument(stored);
    return { document: parsed, notice: null, saveError: null };
  } catch {
    const recoveryKey = `${legacyStorageKey}.corrupt.${Date.now()}`;
    try {
      localStorage.setItem(recoveryKey, stored);
      localStorage.removeItem(legacyStorageKey);
    } catch {
      // Keep the original value if the browser cannot create a recovery copy.
    }
    return {
      document: null,
      notice: "旧版浏览器数据无法读取，原始内容已保留为恢复副本。",
      saveError: null,
    };
  }
}

function friendlySaveError(error: unknown): PersistenceError {
  if (error instanceof BrowserDocumentConflictError) {
    return new PersistenceError(browserDocumentConflictMessage, {
      cause: error,
    });
  }
  if (error instanceof PersistenceError) return error;
  const rawMessage =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  if (rawMessage.includes("EXTERNAL_DOCUMENT_CONFLICT")) {
    return new ExternalDocumentConflictError({ cause: error });
  }
  if (rawMessage.includes("PROTECTED_SOURCE_OVERWRITE")) {
    return new PersistenceError(protectedSourceOverwriteMessage, {
      cause: error,
    });
  }
  return new PersistenceError(
    isDesktopRuntime()
      ? "无法写入本地文件，请检查磁盘空间或文件权限。"
      : "无法保存到此浏览器，请检查浏览器存储权限或剩余空间。",
    { cause: error },
  );
}

export async function loadLocalDocument(): Promise<DocumentLoadResult> {
  if (!isDesktopRuntime()) {
    try {
      const recoveries = readBrowserRecoverySnapshots();
      if (recoveries.length > 0) {
        const currentTabId = browserTabId();
        const ordered = [...recoveries].sort((left, right) => {
          const leftOwn = left.snapshot.tabId === currentTabId ? 1 : 0;
          const rightOwn = right.snapshot.tabId === currentTabId ? 1 : 0;
          if (leftOwn !== rightOwn) return rightOwn - leftOwn;
          return right.snapshot.savedAt.localeCompare(left.snapshot.savedAt);
        });
        let selected: ReturnType<typeof browserLoadResult> | null = null;
        let firstError: unknown = null;
        let recoveredAsCopy = 0;
        for (const recovery of ordered) {
          try {
            let recovered;
            try {
              recovered = recovery.snapshot.documentPath
                ? await saveBrowserDocument(
                    recovery.snapshot.document,
                    recovery.snapshot.documentPath,
                    recovery.snapshot.sourceHash,
                  )
                : await createBrowserDocument(
                    recovery.snapshot.document,
                    false,
                    recovery.snapshot.protectedSourceName,
                  );
            } catch (error) {
              if (!(error instanceof BrowserDocumentConflictError)) throw error;
              recovered = await createBrowserDocument(
                recovery.snapshot.document,
                false,
                recovery.snapshot.protectedSourceName,
              );
              recoveredAsCopy += 1;
            }
            clearBrowserRecoveryRecord(recovery.storageKey);
            selected ??= browserLoadResult(recovered, null, true);
          } catch (error) {
            firstError ??= error;
          }
        }
        if (selected) {
          await activateBrowserDocument(selected.documentPath!);
          selected.notice = recoveredAsCopy > 0
            ? "已恢复关闭前的内容；发生冲突的修改已保留为独立副本。"
            : "已恢复关闭页面前尚未写完的内容。";
          return selected;
        }
        if (firstError) throw firstError;
      }

      const active = await loadActiveBrowserDocument();
      if (active) return browserLoadResult(active);

      const legacy = readLegacyDocument();
      if (!legacy.document) {
        return {
          document: null,
          documentPath: null,
          sourcePath: null,
          recoveredFromBackup: false,
          notice: legacy.notice,
          saveError: legacy.saveError,
          sourceFormat: "recovery",
          importedAsCopy: false,
          viewStateRestored: false,
          sourceHash: null,
        };
      }
      const migrated = await createBrowserDocument(legacy.document);
      localStorage.removeItem(legacyStorageKey);
      return browserLoadResult(
        migrated,
        "已将旧版浏览器数据迁移到 Laniakea 文档库。",
        true,
      );
    } catch (error) {
      const legacy = readLegacyDocument();
      return {
        document: legacy.document,
        documentPath: null,
        sourcePath: null,
        recoveredFromBackup: false,
        notice: legacy.notice ?? "浏览器文档库当前无法读取。",
        saveError: friendlySaveError(error).message,
        sourceFormat: "recovery",
        importedAsCopy: false,
        viewStateRestored: Boolean(legacy.document),
        sourceHash: null,
      };
    }
  }

  try {
    const loaded = await invoke<BackendLoadResult>("load_local_document");
    if (loaded.document || loaded.outlineContent !== null) {
      return parseBackendDocument(loaded);
    }

    const legacy = readLegacyDocument();
    if (!legacy.document) {
      return {
        document: null,
        documentPath: null,
        sourcePath: null,
        recoveredFromBackup: false,
        notice: loaded.notice ?? legacy.notice,
        saveError: legacy.saveError,
        sourceFormat: "recovery",
        importedAsCopy: false,
        viewStateRestored: false,
        sourceHash: null,
      };
    }

    try {
      await saveLocalDocument(legacy.document);
      localStorage.removeItem(legacyStorageKey);
      return {
        document: legacy.document,
        documentPath: null,
        sourcePath: null,
        recoveredFromBackup: false,
        notice: "已将旧版数据迁移到本地文件。",
        saveError: null,
        sourceFormat: "recovery",
        importedAsCopy: false,
        viewStateRestored: true,
        sourceHash: null,
      };
    } catch (error) {
      return {
        document: legacy.document,
        documentPath: null,
        sourcePath: null,
        recoveredFromBackup: false,
        notice: "旧版数据仍保留在浏览器存储中。",
        saveError: friendlySaveError(error).message,
        sourceFormat: "recovery",
        importedAsCopy: false,
        viewStateRestored: true,
        sourceHash: null,
      };
    }
  } catch (error) {
    return {
      document: null,
      documentPath: null,
      sourcePath: null,
      recoveredFromBackup: false,
      notice: "本地文件无法读取；损坏的原文件不会被覆盖。",
      saveError: new PersistenceError(
        "无法读取本地文件，请从导出的文件或备份恢复。",
        { cause: error },
      ).message,
      sourceFormat: "recovery",
      importedAsCopy: false,
      viewStateRestored: false,
      sourceHash: null,
    };
  }
}

export async function saveLocalDocument(
  document: MindMapDocument,
  documentPath: string | null = null,
  expectedSourceHash: string | null = null,
  protectedSourcePath: string | null = null,
  options: DocumentSaveOptions = {},
): Promise<DocumentSaveResult> {
  const viewportOnly = options.viewportOnly ?? false;
  const serialized = JSON.stringify(document);
  try {
    if (isDesktopRuntime()) {
      const saved = await invoke<BackendSaveResult>("save_local_document", {
        documentJson: serialized,
        documentPath,
        expectedSourceHash,
        protectedSourcePath,
        viewportOnly,
        markdownContent:
          isMarkdownDocumentPath(documentPath) && !viewportOnly
          ? documentToMarkdown(document)
          : null,
      });
      return {
        sourceHash: saved.sourceHash,
        auxiliaryWarning: saved.auxiliaryWarning
          ? auxiliarySaveWarningMessage
          : null,
      };
    }
    if (!documentPath || !isBrowserDocumentPath(documentPath)) {
      throw new PersistenceError("当前思维导图还没有可用的浏览器文档位置。");
    }
    const saved = await saveBrowserDocument(
      document,
      documentPath,
      expectedSourceHash,
    );
    clearBrowserRecoverySnapshot(documentPath);
    requestPersistentBrowserStorage();
    return { sourceHash: saved.sourceHash, auxiliaryWarning: null };
  } catch (error) {
    throw friendlySaveError(error);
  }
}

export async function createMarkdownDraft(
  document: MindMapDocument,
  activateDocument = true,
  protectedSourceName: string | null = null,
): Promise<DraftDocumentResult> {
  if (!isDesktopRuntime()) {
    try {
      const created = await createBrowserDocument(
        document,
        activateDocument,
        protectedSourceName,
      );
      requestPersistentBrowserStorage();
      return {
        documentPath: created.documentPath,
        sourceHash: created.sourceHash,
      };
    } catch (error) {
      throw friendlySaveError(error);
    }
  }
  try {
    return await invoke<BackendCreateDraftResult>("create_markdown_draft", {
      documentJson: JSON.stringify(document),
      markdownContent: documentToMarkdown(document),
      activateDocument,
    });
  } catch (error) {
    throw friendlySaveError(error);
  }
}

export async function moveInternalDraft(
  sourcePath: string,
  targetPath: string,
): Promise<DocumentSaveResult> {
  if (!isDesktopRuntime()) {
    throw new PersistenceError("浏览器预览不支持移动本地草稿");
  }
  try {
    return await invoke<BackendSaveResult>("move_internal_draft", {
      sourcePath,
      targetPath,
    });
  } catch (error) {
    throw friendlySaveError(error);
  }
}

export async function discardInternalDraft(
  documentPath: string,
): Promise<void> {
  if (!isDesktopRuntime()) {
    if (isBrowserDocumentPath(documentPath)) {
      await discardBrowserDocument(documentPath);
    }
    return;
  }
  try {
    await invoke("discard_internal_draft", { documentPath });
  } catch {
    // A stale candidate is never the active document. Cleanup is best-effort
    // and must not disturb the newer document switch that superseded it.
  }
}

export async function openLocalDocument(
  documentPath: string,
): Promise<DocumentLoadResult> {
  if (!isDesktopRuntime()) {
    try {
      const loaded = await openBrowserDocument(documentPath);
      return browserLoadResult(loaded);
    } catch (error) {
      throw new PersistenceError(
        error instanceof Error
          ? error.message
          : "无法打开这张浏览器思维导图。",
        { cause: error },
      );
    }
  }
  try {
    const loaded = await invoke<BackendLoadResult>("open_local_document", {
      documentPath,
    });
    if (!loaded.document && loaded.outlineContent === null) {
      throw new Error("文件内容为空");
    }
    return await parseBackendDocument(loaded);
  } catch (error) {
    throw new PersistenceError(
      typeof error === "string"
        ? error
        : error instanceof Error
        ? error.message
        : "无法打开这个思维导图文件。",
      { cause: error },
    );
  }
}

export async function readOutlineFile(
  documentPath: string,
): Promise<string> {
  if (!isDesktopRuntime()) {
    throw new PersistenceError("浏览器预览不支持按本地路径读取大纲");
  }
  try {
    return await invoke<string>("read_outline_file", {
      documentPath,
    });
  } catch (error) {
    throw new PersistenceError(
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "无法读取这个大纲文件。",
      { cause: error },
    );
  }
}

export async function clearActiveDocument(): Promise<void> {
  if (!isDesktopRuntime()) {
    await clearActiveBrowserDocument();
    return;
  }
  try {
    await invoke("clear_active_document");
  } catch (error) {
    throw new PersistenceError("无法开始新的思维导图。", {
      cause: error,
    });
  }
}

export async function activateLocalDocument(
  documentPath: string,
): Promise<void> {
  if (!isDesktopRuntime()) {
    await activateBrowserDocument(documentPath);
    return;
  }
  try {
    await invoke("activate_local_document", { documentPath });
  } catch (error) {
    throw new PersistenceError(
      error instanceof Error
        ? error.message
        : "无法记录当前思维导图。",
      { cause: error },
    );
  }
}

export function saveBrowserDocumentSynchronously(
  document: MindMapDocument,
  documentPath: string | null,
  sourceHash: string | null,
  protectedSourceName: string | null = null,
): void {
  if (isDesktopRuntime()) return;
  try {
    localStorage.setItem(
      browserRecoveryKey(documentPath),
      JSON.stringify({
        version: 2,
        tabId: browserTabId(),
        savedAt: new Date().toISOString(),
        document,
        documentPath,
        sourceHash,
        protectedSourceName,
      } satisfies BrowserRecoverySnapshot),
    );
  } catch (error) {
    throw friendlySaveError(error);
  }
}

interface BrowserRecoverySnapshot {
  version: 2;
  tabId: string | null;
  savedAt: string;
  document: MindMapDocument;
  documentPath: string | null;
  sourceHash: string | null;
  protectedSourceName: string | null;
}

function browserLoadResult(
  stored: {
    document: MindMapDocument;
    documentPath: string;
    sourceHash: string;
    protectedSourceName?: string | null;
  },
  notice: string | null = null,
  recoveredFromBackup = false,
): DocumentLoadResult {
  return {
    document: stored.document,
    documentPath: stored.documentPath,
    sourcePath: stored.documentPath,
    recoveredFromBackup,
    notice,
    saveError: null,
    sourceFormat: "native",
    importedAsCopy: false,
    viewStateRestored: true,
    sourceHash: stored.sourceHash,
    protectedSourceName: stored.protectedSourceName,
  };
}

function browserTabId(): string {
  if (fallbackBrowserTabId) return fallbackBrowserTabId;
  try {
    const stored = sessionStorage.getItem(browserTabStorageKey);
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.() ??
      `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(browserTabStorageKey, created);
    return created;
  } catch {
    fallbackBrowserTabId = globalThis.crypto?.randomUUID?.() ??
      `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return fallbackBrowserTabId;
  }
}

function browserRecoveryKey(documentPath: string | null): string {
  const documentToken = encodeURIComponent(documentPath ?? "unbound");
  return `${browserRecoveryPrefix}${browserTabId()}.${documentToken}`;
}

function parseBrowserRecoverySnapshot(
  stored: string,
  legacy = false,
): BrowserRecoverySnapshot {
  const candidate = JSON.parse(stored) as Partial<BrowserRecoverySnapshot>;
  if (
    candidate.documentPath !== null &&
    candidate.documentPath !== undefined &&
    !isBrowserDocumentPath(candidate.documentPath)
  ) {
    throw new Error("invalid browser document path");
  }
  return {
    version: 2,
    tabId: legacy
      ? null
      : typeof candidate.tabId === "string"
        ? candidate.tabId
        : null,
    savedAt:
      typeof candidate.savedAt === "string"
        ? candidate.savedAt
        : new Date(0).toISOString(),
    document: parseMindMapDocument(JSON.stringify(candidate.document)),
    documentPath: candidate.documentPath ?? null,
    sourceHash:
      typeof candidate.sourceHash === "string"
        ? candidate.sourceHash
        : null,
    protectedSourceName:
      typeof candidate.protectedSourceName === "string"
        ? candidate.protectedSourceName
        : null,
  };
}

function readBrowserRecoverySnapshots(): Array<{
  storageKey: string;
  snapshot: BrowserRecoverySnapshot;
}> {
  const keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key &&
        !key.includes(".corrupt.") &&
        (key.startsWith(browserRecoveryPrefix) ||
          key === legacyBrowserRecoveryKey)
      ) {
        keys.push(key);
      }
    }
  } catch {
    return [];
  }

  const snapshots: Array<{
    storageKey: string;
    snapshot: BrowserRecoverySnapshot;
  }> = [];
  for (const key of keys) {
    const stored = localStorage.getItem(key);
    if (!stored) continue;
    try {
      snapshots.push({
        storageKey: key,
        snapshot: parseBrowserRecoverySnapshot(
          stored,
          key === legacyBrowserRecoveryKey,
        ),
      });
    } catch {
      try {
        localStorage.setItem(`${key}.corrupt.${Date.now()}`, stored);
        localStorage.removeItem(key);
      } catch {
        // Keep the unreadable recovery value when a recovery copy cannot be made.
      }
    }
  }
  return snapshots;
}

function clearBrowserRecoverySnapshot(documentPath: string | null): void {
  try {
    localStorage.removeItem(browserRecoveryKey(documentPath));
  } catch {
    // Recovery cleanup is best-effort and must not turn a saved document red.
  }
}

function clearBrowserRecoveryRecord(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // A committed recovery is safe even if best-effort cleanup is unavailable.
  }
}

export function resetBrowserRecoveryTabForTests(): void {
  fallbackBrowserTabId = null;
  try {
    sessionStorage.removeItem(browserTabStorageKey);
  } catch {
    // Tests without sessionStorage use the in-memory tab identity above.
  }
}
