import { parseMindMapDocument } from "../model/document";
import type { MindMapDocument } from "../types/mindmap";

const databaseName = "laniakea";
const databaseVersion = 1;
const documentStoreName = "documents";
const metadataStoreName = "metadata";
const activeDocumentKey = "activeDocumentId";
const browserPathPrefix = "browser://laniakea/";
const revisionPrefix = "laniakea-browser";

interface BrowserDocumentRecord {
  id: string;
  title: string;
  document: MindMapDocument;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

interface BrowserMetadataRecord {
  key: string;
  value: string;
}

export interface BrowserStoredDocument {
  document: MindMapDocument;
  documentPath: string;
  sourceHash: string;
}

export interface BrowserLibraryBackup {
  format: "laniakea-browser-library";
  version: 1;
  exportedAt: string;
  activeDocumentId: string | null;
  documents: BrowserDocumentRecord[];
}

export interface BrowserDocumentSummary {
  documentPath: string;
  title: string;
  updatedAt: string;
}

export class BrowserDocumentConflictError extends Error {
  constructor() {
    super("这张思维导图已在另一个标签页更新，当前修改没有覆盖较新的版本。");
    this.name = "BrowserDocumentConflictError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("浏览器存储操作失败")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), {
      once: true,
    });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("浏览器存储事务已取消")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("浏览器存储事务失败")),
      { once: true },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(documentStoreName)) {
        database.createObjectStore(documentStoreName, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(metadataStoreName)) {
        database.createObjectStore(metadataStoreName, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("无法打开浏览器文档库")),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("浏览器文档库正在被其他页面升级")),
      { once: true },
    );
  });
}

async function withDatabase<T>(
  operation: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `document-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneDocument(document: MindMapDocument): MindMapDocument {
  return parseMindMapDocument(JSON.stringify(document));
}

function revisionToken(id: string, revision: number): string {
  return `${revisionPrefix}:${id}:${revision}`;
}

function parseRevisionToken(
  token: string | null,
): { id: string; revision: number } | null {
  if (!token?.startsWith(`${revisionPrefix}:`)) return null;
  const match = token.match(/^laniakea-browser:(.+):(\d+)$/);
  if (!match) return null;
  return { id: match[1], revision: Number(match[2]) };
}

function recordToStored(record: BrowserDocumentRecord): BrowserStoredDocument {
  return {
    document: cloneDocument(record.document),
    documentPath: browserDocumentPath(record.id),
    sourceHash: revisionToken(record.id, record.revision),
  };
}

function isRecord(value: unknown): value is BrowserDocumentRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserDocumentRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Number.isInteger(candidate.revision) &&
    candidate.revision! > 0 &&
    Boolean(candidate.document)
  );
}

export function browserDocumentPath(id: string): string {
  return `${browserPathPrefix}${encodeURIComponent(id)}`;
}

export function browserDocumentId(path: string): string | null {
  if (!path.startsWith(browserPathPrefix)) return null;
  const encoded = path.slice(browserPathPrefix.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function isBrowserDocumentPath(
  path: string | null,
): boolean {
  return Boolean(path && browserDocumentId(path));
}

export async function createBrowserDocument(
  document: MindMapDocument,
  activateDocument = true,
): Promise<BrowserStoredDocument> {
  return withDatabase(async (database) => {
    const id = createId();
    const now = new Date().toISOString();
    const record: BrowserDocumentRecord = {
      id,
      title: document.title,
      document: cloneDocument(document),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    const stores = activateDocument
      ? [documentStoreName, metadataStoreName]
      : [documentStoreName];
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore(documentStoreName).add(record);
    if (activateDocument) {
      transaction.objectStore(metadataStoreName).put({
        key: activeDocumentKey,
        value: id,
      } satisfies BrowserMetadataRecord);
    }
    await transactionDone(transaction);
    return recordToStored(record);
  });
}

export async function loadActiveBrowserDocument(): Promise<BrowserStoredDocument | null> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [documentStoreName, metadataStoreName],
      "readonly",
    );
    const metadata = await requestResult(
      transaction.objectStore(metadataStoreName).get(activeDocumentKey),
    ) as BrowserMetadataRecord | undefined;
    if (!metadata?.value) {
      await transactionDone(transaction);
      return null;
    }
    const record = await requestResult(
      transaction.objectStore(documentStoreName).get(metadata.value),
    ) as BrowserDocumentRecord | undefined;
    await transactionDone(transaction);
    return record ? recordToStored(record) : null;
  });
}

export async function openBrowserDocument(
  path: string,
): Promise<BrowserStoredDocument> {
  const id = browserDocumentId(path);
  if (!id) throw new Error("无法识别这张浏览器思维导图");
  return withDatabase(async (database) => {
    const transaction = database.transaction(documentStoreName, "readonly");
    const record = await requestResult(
      transaction.objectStore(documentStoreName).get(id),
    ) as BrowserDocumentRecord | undefined;
    await transactionDone(transaction);
    if (!record) throw new Error("这张思维导图已不在此浏览器中");
    return recordToStored(record);
  });
}

export async function listBrowserDocuments(): Promise<BrowserDocumentSummary[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(documentStoreName, "readonly");
    const records = await requestResult(
      transaction.objectStore(documentStoreName).getAll(),
    ) as BrowserDocumentRecord[];
    await transactionDone(transaction);
    return records
      .filter(isRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((record) => ({
        documentPath: browserDocumentPath(record.id),
        title: record.title,
        updatedAt: record.updatedAt,
      }));
  });
}

export async function saveBrowserDocument(
  document: MindMapDocument,
  path: string,
  expectedSourceHash: string | null,
): Promise<BrowserStoredDocument> {
  const id = browserDocumentId(path);
  const expected = parseRevisionToken(expectedSourceHash);
  if (!id || !expected || expected.id !== id) {
    throw new BrowserDocumentConflictError();
  }
  return withDatabase(async (database) => {
    const transaction = database.transaction(documentStoreName, "readwrite");
    const store = transaction.objectStore(documentStoreName);
    const current = await requestResult(store.get(id)) as
      | BrowserDocumentRecord
      | undefined;
    if (!current || current.revision !== expected.revision) {
      transaction.abort();
      try {
        await transactionDone(transaction);
      } catch {
        // The conflict below is the actionable result.
      }
      throw new BrowserDocumentConflictError();
    }
    const record: BrowserDocumentRecord = {
      ...current,
      title: document.title,
      document: cloneDocument(document),
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
    };
    store.put(record);
    await transactionDone(transaction);
    return recordToStored(record);
  });
}

export async function activateBrowserDocument(path: string): Promise<void> {
  const id = browserDocumentId(path);
  if (!id) throw new Error("无法识别这张浏览器思维导图");
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [documentStoreName, metadataStoreName],
      "readwrite",
    );
    const exists = await requestResult(
      transaction.objectStore(documentStoreName).getKey(id),
    );
    if (exists === undefined) {
      transaction.abort();
      throw new Error("这张思维导图已不在此浏览器中");
    }
    transaction.objectStore(metadataStoreName).put({
      key: activeDocumentKey,
      value: id,
    } satisfies BrowserMetadataRecord);
    await transactionDone(transaction);
  });
}

export async function clearActiveBrowserDocument(): Promise<void> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(metadataStoreName, "readwrite");
    transaction.objectStore(metadataStoreName).delete(activeDocumentKey);
    await transactionDone(transaction);
  });
}

export async function discardBrowserDocument(path: string): Promise<void> {
  const id = browserDocumentId(path);
  if (!id) return;
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [documentStoreName, metadataStoreName],
      "readwrite",
    );
    transaction.objectStore(documentStoreName).delete(id);
    const metadata = await requestResult(
      transaction.objectStore(metadataStoreName).get(activeDocumentKey),
    ) as BrowserMetadataRecord | undefined;
    if (metadata?.value === id) {
      transaction.objectStore(metadataStoreName).delete(activeDocumentKey);
    }
    await transactionDone(transaction);
  });
}

export async function exportBrowserLibrary(): Promise<BrowserLibraryBackup> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [documentStoreName, metadataStoreName],
      "readonly",
    );
    const records = await requestResult(
      transaction.objectStore(documentStoreName).getAll(),
    ) as BrowserDocumentRecord[];
    const metadata = await requestResult(
      transaction.objectStore(metadataStoreName).get(activeDocumentKey),
    ) as BrowserMetadataRecord | undefined;
    await transactionDone(transaction);
    return {
      format: "laniakea-browser-library",
      version: 1,
      exportedAt: new Date().toISOString(),
      activeDocumentId: metadata?.value ?? null,
      documents: records
        .filter(isRecord)
        .map((record) => ({
          ...record,
          document: cloneDocument(record.document),
        })),
    };
  });
}

export async function restoreBrowserLibrary(
  rawBackup: unknown,
): Promise<{
  count: number;
  activeDocument: BrowserStoredDocument | null;
}> {
  if (!rawBackup || typeof rawBackup !== "object") {
    throw new Error("这不是可识别的 Laniakea 完整备份");
  }
  const candidate = rawBackup as Partial<BrowserLibraryBackup>;
  if (
    candidate.format !== "laniakea-browser-library" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.documents)
  ) {
    throw new Error("这不是可识别的 Laniakea 完整备份");
  }
  const sourceRecords = candidate.documents.map((record) => {
    if (!isRecord(record)) throw new Error("完整备份中有无法读取的文档");
    return record;
  });
  const restored = sourceRecords.map((record) => {
    const document = cloneDocument(record.document);
    const id = createId();
    const now = new Date().toISOString();
    return {
      id,
      title: document.title,
      document,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    } satisfies BrowserDocumentRecord;
  });
  if (restored.length === 0) return { count: 0, activeDocument: null };

  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [documentStoreName, metadataStoreName],
      "readwrite",
    );
    const store = transaction.objectStore(documentStoreName);
    restored.forEach((record) => store.add(record));
    const activeIndex = sourceRecords.findIndex(
      (record) => record.id === candidate.activeDocumentId,
    );
    const active = restored[activeIndex >= 0 ? activeIndex : 0];
    transaction.objectStore(metadataStoreName).put({
      key: activeDocumentKey,
      value: active.id,
    } satisfies BrowserMetadataRecord);
    await transactionDone(transaction);
    return {
      count: restored.length,
      activeDocument: recordToStored(active),
    };
  });
}

let persistenceRequestStarted = false;

export function requestPersistentBrowserStorage(): void {
  if (persistenceRequestStarted) return;
  persistenceRequestStarted = true;
  if (typeof navigator === "undefined") return;
  const storage = navigator.storage;
  if (!storage?.persist || !storage.persisted) return;
  void storage.persisted()
    .then((persisted) => persisted || storage.persist())
    .catch(() => false);
}

export async function resetBrowserDocumentStoreForTests(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
    request.addEventListener("blocked", () => resolve(), { once: true });
  });
  persistenceRequestStarted = false;
}
