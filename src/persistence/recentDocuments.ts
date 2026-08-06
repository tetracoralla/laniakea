const recentDocumentsKey = "origin.recent-documents.v1";
const maximumStoredDocuments = 20;
const browserDocumentPrefix = "browser://laniakea/";

export interface RecentDocument {
  path: string;
  title: string;
  lastOpenedAt: string;
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

export function isInternalDocumentPath(path: string): boolean {
  const normalized = normalizedPath(path).toLocaleLowerCase("en-US");
  const internalRoots = [
    "/library/application support/com.openadam.origin",
    "/library/containers/com.openadam.origin",
    "/library/group containers/com.openadam.origin",
  ];
  return internalRoots.some(
    (root) =>
      normalized.endsWith(root) ||
      normalized.includes(`${root}/`),
  );
}

export function recentDocumentLocation(path: string): string {
  if (path.startsWith(browserDocumentPrefix)) return "此浏览器";
  if (isInternalDocumentPath(path)) return "本地草稿";
  const parent = documentParentDirectory(path);
  if (!parent) return "本地文件";
  const segments = normalizedPath(parent)
    .split("/")
    .filter((segment) => segment && !/^[A-Za-z]:$/.test(segment));
  return segments.slice(-2).join("/") || parent;
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

function normalize(documents: RecentDocument[]): RecentDocument[] {
  const byPath = new Map<string, RecentDocument>();
  for (const document of documents) {
    if (!byPath.has(document.path)) byPath.set(document.path, document);
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
      title: title.trim() || "未命名思维",
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
  const nextTitle = title.trim() || "未命名思维";
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
