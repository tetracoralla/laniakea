import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isMindMapDocument,
  parseMindMapDocument,
} from "../model/document";
import type { MindMapDocument } from "../types/mindmap";

const legacyStorageKey = "origin.mindmap.v1";

interface BackendLoadResult {
  document: string | null;
  recoveredFromBackup: boolean;
  notice: string | null;
}

export interface DocumentLoadResult {
  document: MindMapDocument | null;
  recoveredFromBackup: boolean;
  notice: string | null;
  saveError: string | null;
}

export class PersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
  }
}

export function isDesktopRuntime(): boolean {
  return isTauri();
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
    const parsed = JSON.parse(stored) as unknown;
    if (!isMindMapDocument(parsed)) {
      throw new Error("legacy document is invalid");
    }
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
      recoveredFromBackup: false,
      notice: legacy.notice,
      saveError: legacy.saveError,
    };
  }

  try {
    const loaded = await invoke<BackendLoadResult>("load_local_document");
    if (loaded.document) {
      return {
        document: parseMindMapDocument(loaded.document),
        recoveredFromBackup: loaded.recoveredFromBackup,
        notice: loaded.notice,
        saveError: null,
      };
    }

    const legacy = readLegacyDocument();
    if (!legacy.document) {
      return {
        document: null,
        recoveredFromBackup: false,
        notice: loaded.notice ?? legacy.notice,
        saveError: legacy.saveError,
      };
    }

    try {
      await saveLocalDocument(legacy.document);
      localStorage.removeItem(legacyStorageKey);
      return {
        document: legacy.document,
        recoveredFromBackup: false,
        notice: "已将旧版数据迁移到本地文件。",
        saveError: null,
      };
    } catch (error) {
      return {
        document: legacy.document,
        recoveredFromBackup: false,
        notice: "旧版数据仍保留在浏览器存储中。",
        saveError: friendlySaveError(error).message,
      };
    }
  } catch (error) {
    return {
      document: null,
      recoveredFromBackup: false,
      notice: "本地文件无法读取；损坏的原文件不会被覆盖。",
      saveError: new PersistenceError(
        "无法读取本地文件，请从导出的文件或备份恢复。",
        { cause: error },
      ).message,
    };
  }
}

export async function saveLocalDocument(
  document: MindMapDocument,
): Promise<void> {
  const serialized = JSON.stringify(document);
  try {
    if (isDesktopRuntime()) {
      await invoke("save_local_document", {
        documentJson: serialized,
      });
      return;
    }
    localStorage.setItem(legacyStorageKey, serialized);
  } catch (error) {
    throw friendlySaveError(error);
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
