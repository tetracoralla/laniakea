import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseMindMapDocument } from "../model/document";
import {
  documentToMarkdown,
  parseMarkdownDocument,
} from "../model/markdown";
import type { MindMapDocument } from "../types/mindmap";

const legacyStorageKey = "origin.mindmap.v1";

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
}

export interface DocumentSaveResult {
  sourceHash: string | null;
  auxiliaryWarning: string | null;
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
export const protectedSourceOverwriteMessage =
  "这个文件包含原点无法完整保留的 Markdown 内容，请另存到其他位置。";
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
      ? "已打开旧版原点备份；保存时请选择 Markdown 文件，原备份不会被覆盖。"
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
    "无法写入本地文件，请检查磁盘空间或文件权限。",
    { cause: error },
  );
}

export async function loadLocalDocument(): Promise<DocumentLoadResult> {
  if (!isDesktopRuntime()) {
    const legacy = readLegacyDocument();
    return {
      document: legacy.document,
      documentPath: null,
      sourcePath: null,
      recoveredFromBackup: false,
      notice: legacy.notice,
      saveError: legacy.saveError,
      sourceFormat: "recovery",
      importedAsCopy: false,
      viewStateRestored: Boolean(legacy.document),
      sourceHash: null,
    };
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
): Promise<DocumentSaveResult> {
  const serialized = JSON.stringify(document);
  try {
    if (isDesktopRuntime()) {
      const saved = await invoke<BackendSaveResult>("save_local_document", {
        documentJson: serialized,
        documentPath,
        expectedSourceHash,
        protectedSourcePath,
        markdownContent: isMarkdownDocumentPath(documentPath)
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
    localStorage.setItem(legacyStorageKey, serialized);
    return { sourceHash: null, auxiliaryWarning: null };
  } catch (error) {
    throw friendlySaveError(error);
  }
}

export async function createMarkdownDraft(
  document: MindMapDocument,
  activateDocument = true,
): Promise<DraftDocumentResult> {
  if (!isDesktopRuntime()) {
    throw new PersistenceError("浏览器预览不支持创建本地 Markdown 草稿");
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
  if (!isDesktopRuntime()) return;
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
    throw new PersistenceError("浏览器预览不支持按本地路径打开文件");
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
  if (!isDesktopRuntime()) return;
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
  if (!isDesktopRuntime()) return;
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
): void {
  if (isDesktopRuntime()) return;
  try {
    localStorage.setItem(legacyStorageKey, JSON.stringify(document));
  } catch (error) {
    throw friendlySaveError(error);
  }
}
