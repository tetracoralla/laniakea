import { t } from "../i18n/locale";
import { isProvisionalDocumentTitle as isUntitledTitle } from "../model/document";
const recentDocumentsKey = "origin.recent-documents.v1";
const maximumStoredDocuments = 20;
const browserDocumentPrefix = "browser://laniakea/";
let internalDocumentRoot: string | null = null;

export interface RecentDocument {
  path: string;
  title: string;
  lastOpenedAt: string;
}

export interface CurrentDocumentIdentity {
  /** The path that currently receives saves, when one exists. */
  documentPath: string | null;
  /** The file the content came from, which may be protected and unbound. */
  sourcePath: string | null;
}

export interface CurrentDocumentDescription {
  associatedPath: string | null;
  exactDescription: string;
  metadata: string;
  pathRole: "binding" | "source" | null;
}

function normalizedPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function documentParentDirectory(path: string): string | null {
  const normalized = normalizedPath(path);
  const separator = normalized.lastIndexOf("/");
  if (separator < 0) return null;
  if (separator === 0) return "/";
  const parent = normalized.slice(0, separator);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

function comparablePath(path: string): string {
  const normalized = normalizedPath(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

/** Supplied by the running desktop host before documents are restored. */
export function configureInternalDocumentRoot(path: string | null): void {
  internalDocumentRoot = path ? comparablePath(path) : null;
}

export function isInternalDocumentPath(path: string): boolean {
  if (!internalDocumentRoot) return false;
  const normalized = comparablePath(path);
  return normalized === internalDocumentRoot ||
    normalized.startsWith(`${internalDocumentRoot}/`);
}

export function recentDocumentLocation(path: string): string {
  if (path.startsWith(browserDocumentPrefix)) return t("此浏览器");
  if (isInternalDocumentPath(path)) return t("本地草稿");
  const parent = documentParentDirectory(path);
  if (!parent) return t("本地文件");
  const segments = normalizedPath(parent)
    .split("/")
    .filter((segment) => segment && !/^[A-Za-z]:$/.test(segment));
  return segments.slice(-2).join("/") || parent;
}

function compactDocumentLocation(path: string): string {
  if (path.startsWith(browserDocumentPrefix)) return t("此浏览器");
  if (isInternalDocumentPath(path)) return t("本地草稿");
  const parent = documentParentDirectory(path);
  if (!parent) return t("本地文件");
  const directory = normalizedPath(parent).split("/").filter(Boolean).at(-1);
  if (!directory) return parent;
  const familiarLocations: Record<string, string> = {
    Desktop: t("桌面"),
    Documents: t("文稿"),
    Downloads: t("下载"),
  };
  return familiarLocations[directory] ?? directory;
}

/**
 * Describes the one current document identity without conflating a writable
 * binding with the protected file an unbound copy was imported from.
 */
export function describeCurrentDocument(
  identity: CurrentDocumentIdentity,
): CurrentDocumentDescription {
  if (identity.documentPath) {
    const location = compactDocumentLocation(identity.documentPath);
    if (identity.documentPath.startsWith(browserDocumentPrefix)) {
      return {
        associatedPath: identity.documentPath,
        exactDescription: t("正在编辑的内容保存在此浏览器"),
        metadata: t("保存在此浏览器"),
        pathRole: null,
      };
    }
    if (isInternalDocumentPath(identity.documentPath)) {
      return {
        associatedPath: identity.documentPath,
        exactDescription: t("本地草稿"),
        metadata: t("本地草稿"),
        pathRole: null,
      };
    }
    return {
      associatedPath: identity.documentPath,
      exactDescription: t("正在保存到：{0}", identity.documentPath),
      metadata: t("保存到 · {0}", location),
      pathRole: "binding",
    };
  }

  if (identity.sourcePath) {
    const location = compactDocumentLocation(identity.sourcePath);
    return {
      associatedPath: identity.sourcePath,
      exactDescription: t("当前修改尚未写回来源文件，来源：{0}", identity.sourcePath),
      metadata: t("尚未另存 · 来源：{0}", location),
      pathRole: isInternalDocumentPath(identity.sourcePath) ||
          identity.sourcePath.startsWith(browserDocumentPrefix)
        ? null
        : "source",
    };
  }

  return {
    associatedPath: null,
    exactDescription: t("正在编辑的内容尚未建立保存位置"),
    metadata: t("尚未建立保存位置"),
    pathRole: null,
  };
}

function isRecentDocument(value: unknown): value is RecentDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecentDocument>;
  return (
    typeof candidate.path === "string" &&
    candidate.path.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.lastOpenedAt === "string"
  );
}

function titleFromExternalDocumentPath(path: string): string | null {
  if (
    path.startsWith(browserDocumentPrefix) ||
    isInternalDocumentPath(path)
  ) {
    return null;
  }
  const fileName = normalizedPath(path).split("/").pop() ?? "";
  const title = fileName.replace(/\.(md|markdown|txt)$/i, "").trim();
  return title.length > 0 && !isUntitledTitle(title) ? title : null;
}

function resolveRecentDocumentTitle(
  document: RecentDocument,
): RecentDocument {
  if (!isUntitledTitle(document.title.trim())) return document;
  const title = titleFromExternalDocumentPath(document.path);
  return title ? { ...document, title } : document;
}

function normalize(documents: RecentDocument[]): RecentDocument[] {
  const byPath = new Map<string, RecentDocument>();
  for (const document of documents) {
    if (!byPath.has(document.path)) {
      byPath.set(document.path, resolveRecentDocumentTitle(document));
    }
  }
  const sorted = Array.from(byPath.values()).sort((left, right) =>
    right.lastOpenedAt.localeCompare(left.lastOpenedAt)
  );
  let remainingFileEntries = maximumStoredDocuments;
  return sorted.filter((document) => {
    if (document.path.startsWith(browserDocumentPrefix)) return true;
    if (remainingFileEntries <= 0) return false;
    remainingFileEntries -= 1;
    return true;
  });
}

export function loadRecentDocuments(): RecentDocument[] {
  try {
    const stored = localStorage.getItem(recentDocumentsKey);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? normalize(parsed.filter(isRecentDocument))
      : [];
  } catch {
    return [];
  }
}

export function persistRecentDocuments(
  documents: RecentDocument[],
): void {
  try {
    localStorage.setItem(
      recentDocumentsKey,
      JSON.stringify(normalize(documents)),
    );
  } catch {
    // Recent documents are a convenience index, never the document source.
  }
}

export function rememberRecentDocument(
  documents: RecentDocument[],
  path: string,
  title: string,
  lastOpenedAt = new Date().toISOString(),
): RecentDocument[] {
  return normalize([
    {
      path,
      title: title.trim() || t("未命名思维"),
      lastOpenedAt,
    },
    ...documents.filter((document) => document.path !== path),
  ]);
}

export function updateRecentDocumentTitle(
  documents: RecentDocument[],
  path: string,
  title: string,
): RecentDocument[] {
  const nextTitle = title.trim() || t("未命名思维");
  let changed = false;
  const updated = documents.map((document) => {
    if (document.path !== path || document.title === nextTitle) {
      return document;
    }
    changed = true;
    return { ...document, title: nextTitle };
  });
  return changed ? updated : documents;
}

export function forgetRecentDocument(
  documents: RecentDocument[],
  path: string,
): RecentDocument[] {
  return documents.filter((document) => document.path !== path);
}

export function moveRecentDocumentPath(
  documents: RecentDocument[],
  sourcePath: string,
  targetPath: string,
): RecentDocument[] {
  const moved = documents.find(
    (document) => document.path === sourcePath,
  );
  if (!moved) return documents;
  return normalize([
    { ...moved, path: targetPath },
    ...documents.filter(
      (document) =>
        document.path !== sourcePath &&
        document.path !== targetPath,
    ),
  ]);
}

export function visibleRecentDocuments(
  documents: RecentDocument[],
  currentPath: string | null,
  limit: number | null = 5,
): RecentDocument[] {
  const visible = documents.filter(
    (document) => document.path !== currentPath,
  );
  return limit === null ? visible : visible.slice(0, limit);
}
