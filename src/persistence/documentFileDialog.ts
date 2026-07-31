import { isDesktopRuntime } from "./localDocumentStore";
import {
  documentParentDirectory,
  isInternalDocumentPath,
  type RecentDocument,
} from "./recentDocuments";

const lastUserDocumentDirectoryKey =
  "origin.last-user-document-directory.v1";

export interface DocumentDialogContext {
  currentPath?: string | null;
  recentDocuments?: RecentDocument[];
}

function loadLastUserDocumentDirectory(): string | null {
  try {
    return localStorage.getItem(lastUserDocumentDirectoryKey);
  } catch {
    return null;
  }
}

function rememberUserDocumentDirectory(path: string): void {
  const directory = documentParentDirectory(path);
  if (!directory || isInternalDocumentPath(path)) return;
  try {
    localStorage.setItem(lastUserDocumentDirectoryKey, directory);
  } catch {
    // The open/save panel still works when this convenience hint cannot persist.
  }
}

export function preferredUserDocumentDirectory(
  currentPath: string | null | undefined,
  lastDirectory: string | null,
  recentPaths: string[],
): string | null {
  const candidates = [
    currentPath ? documentParentDirectory(currentPath) : null,
    lastDirectory,
    ...recentPaths.map(documentParentDirectory),
  ];
  return (
    candidates.find(
      (candidate) =>
        Boolean(candidate) && !isInternalDocumentPath(candidate!),
    ) ?? null
  );
}

async function preferredDialogDirectory(
  context: DocumentDialogContext,
): Promise<string> {
  const preferred = preferredUserDocumentDirectory(
    context.currentPath,
    loadLastUserDocumentDirectory(),
    (context.recentDocuments ?? []).map((document) => document.path),
  );
  if (preferred) return preferred;
  const { documentDir } = await import("@tauri-apps/api/path");
  return documentDir();
}

async function suggestedFilePath(
  fileName: string,
  context: DocumentDialogContext,
): Promise<string> {
  const [{ join }, directory] = await Promise.all([
    import("@tauri-apps/api/path"),
    preferredDialogDirectory(context),
  ]);
  return join(directory, fileName);
}

export function ensureNativeExtension(path: string): string {
  if (/\.mindmap\.json$/i.test(path)) return path;
  if (/\.json$/i.test(path)) {
    return `${path.slice(0, -".json".length)}.mindmap.json`;
  }
  return `${path}.mindmap.json`;
}

export function ensureMarkdownExtension(path: string): string {
  if (/\.(md|markdown)$/i.test(path)) return path;
  return `${path}.md`;
}

export async function chooseDocumentToOpen(
  context: DocumentDialogContext = {},
): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    defaultPath: await preferredDialogDirectory(context),
    directory: false,
    multiple: false,
    filters: [
      {
        name: "Markdown 与原点备份",
        extensions: ["json", "md", "markdown", "txt"],
      },
    ],
  });
  if (typeof selected !== "string") return null;
  rememberUserDocumentDirectory(selected);
  return selected;
}

export async function chooseNativeDocumentPath(
  suggestedName: string,
  context: DocumentDialogContext = {},
): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: await suggestedFilePath(
      `${suggestedName}.mindmap.json`,
      context,
    ),
    filters: [
      {
        name: "原点思维导图",
        extensions: ["json"],
      },
    ],
  });
  if (!selected) return null;
  rememberUserDocumentDirectory(selected);
  return ensureNativeExtension(selected);
}

export async function chooseMarkdownDocumentPath(
  suggestedName: string,
  context: DocumentDialogContext = {},
): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    defaultPath: await suggestedFilePath(
      `${suggestedName}.md`,
      context,
    ),
    filters: [
      {
        name: "Markdown 思维导图",
        extensions: ["md"],
      },
    ],
  });
  if (!selected) return null;
  rememberUserDocumentDirectory(selected);
  return ensureMarkdownExtension(selected);
}
