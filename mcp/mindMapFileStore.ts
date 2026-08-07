import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize } from "node:path";
import {
  applyMindMapOperations,
  createAgentMindMap,
  parseAgentMindMap,
  type AgentTreeInput,
  type MindMapOperation,
} from "../src/agent/mindMapTools";
import { documentToMarkdown, type MarkdownParseResult } from "../src/model/markdown";

const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const LOCK_RETRY_MS = 12;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 5 * 60_000;

export class MindMapFileError extends Error {
  constructor(
    readonly code:
      | "already_exists"
      | "busy"
      | "conflict"
      | "file_too_large"
      | "invalid_path"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "MindMapFileError";
  }
}

export interface LoadedMindMapFile {
  filePath: string;
  markdown: string;
  parsed: MarkdownParseResult;
  revision: string;
}

export interface UpdatedMindMapFile extends LoadedMindMapFile {
  wrote: boolean;
}

function requireMarkdownPath(filePath: string): string {
  if (!isAbsolute(filePath)) {
    throw new MindMapFileError(
      "invalid_path",
      "filePath must be an explicit absolute path.",
    );
  }
  const resolved = normalize(filePath);
  const extension = extname(resolved).toLocaleLowerCase();
  if (extension !== ".md" && extension !== ".markdown") {
    throw new MindMapFileError(
      "invalid_path",
      "Laniakea Agent tools only accept .md or .markdown files.",
    );
  }
  return resolved;
}

function titleFromPath(filePath: string): string {
  return basename(filePath).replace(/\.(md|markdown)$/i, "");
}

export function markdownRevision(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown).digest("hex")}`;
}

async function requireRegularFile(filePath: string) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MindMapFileError("not_found", `Mind map not found: ${filePath}`);
    }
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new MindMapFileError(
      "invalid_path",
      "filePath must point directly to a regular Markdown file, not a directory or symbolic link.",
    );
  }
  if (metadata.size > MAX_MARKDOWN_BYTES) {
    throw new MindMapFileError(
      "file_too_large",
      `Mind map files may not exceed ${MAX_MARKDOWN_BYTES} bytes.`,
    );
  }
  return metadata;
}

export async function readMindMapFile(filePath: string): Promise<LoadedMindMapFile> {
  const resolved = requireMarkdownPath(filePath);
  await requireRegularFile(resolved);
  const markdown = await readFile(resolved, "utf8");
  return {
    filePath: resolved,
    markdown,
    parsed: parseAgentMindMap(markdown, titleFromPath(resolved)),
    revision: markdownRevision(markdown),
  };
}

async function writeExclusive(filePath: string, markdown: string, mode?: number) {
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new MindMapFileError(
      "file_too_large",
      `Mind map files may not exceed ${MAX_MARKDOWN_BYTES} bytes.`,
    );
  }
  const handle = await open(filePath, "wx", mode);
  let completed = false;
  try {
    await handle.writeFile(markdown, "utf8");
    if (mode !== undefined) await handle.chmod(mode);
    await handle.sync();
    completed = true;
  } finally {
    await handle.close();
    if (!completed) await unlink(filePath).catch(() => undefined);
  }
}

function updateLockPath(filePath: string): string {
  const digest = createHash("sha256").update(filePath).digest("hex").slice(0, 32);
  return join(dirname(filePath), `.laniakea-lock-${digest}`);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function lockCanBeRemoved(lockPath: string): Promise<boolean> {
  const metadata = await lstat(lockPath).catch(() => null);
  if (!metadata) return true;
  if (Date.now() - metadata.mtimeMs > LOCK_STALE_MS) return true;

  const owner = await readFile(lockPath, "utf8").catch(() => "");
  const ownerPid = Number.parseInt(owner, 10);
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false;
  try {
    process.kill(ownerPid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function withUpdateLock<T>(
  filePath: string,
  work: (canonicalPath: string) => Promise<T>,
): Promise<T> {
  const resolved = requireMarkdownPath(filePath);
  await requireRegularFile(resolved);
  const canonicalPath = await realpath(resolved);
  const lockPath = updateLockPath(canonicalPath);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;

  while (!lockHandle) {
    try {
      const candidate = await open(lockPath, "wx", 0o600);
      try {
        await candidate.writeFile(`${process.pid}\n`, "utf8");
        await candidate.sync();
        lockHandle = candidate;
      } catch (error) {
        await candidate.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await lockCanBeRemoved(lockPath)) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new MindMapFileError(
          "busy",
          "Another Laniakea update is still in progress. No content was overwritten; retry after reading the map again.",
        );
      }
      await delay(LOCK_RETRY_MS);
    }
  }

  try {
    return await work(canonicalPath);
  } finally {
    await lockHandle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

export async function createMindMapFile(
  filePath: string,
  title: string,
  root: AgentTreeInput,
): Promise<LoadedMindMapFile> {
  const resolved = requireMarkdownPath(filePath);
  const parent = dirname(resolved);
  const parentMetadata = await stat(parent).catch(() => null);
  if (!parentMetadata?.isDirectory()) {
    throw new MindMapFileError(
      "invalid_path",
      "The destination folder must already exist.",
    );
  }
  const document = createAgentMindMap(title, root);
  const markdown = documentToMarkdown(document);
  try {
    await writeExclusive(resolved, markdown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new MindMapFileError(
        "already_exists",
        "The destination already exists. Laniakea will not overwrite it while creating a mind map.",
      );
    }
    throw error;
  }
  return {
    filePath: resolved,
    markdown,
    parsed: parseAgentMindMap(markdown, titleFromPath(resolved)),
    revision: markdownRevision(markdown),
  };
}

export async function updateMindMapFile(
  filePath: string,
  expectedRevision: string,
  operations: readonly MindMapOperation[],
  dryRun = false,
): Promise<UpdatedMindMapFile> {
  const prepareUpdate = async (loaded: LoadedMindMapFile) => {
    if (loaded.revision !== expectedRevision) {
      throw new MindMapFileError(
        "conflict",
        "The Markdown changed after it was read. No content was overwritten; read the map again before retrying.",
      );
    }
    const updated = applyMindMapOperations(loaded.parsed, operations);
    const next: UpdatedMindMapFile = {
      filePath: loaded.filePath,
      markdown: updated.markdown,
      parsed: parseAgentMindMap(updated.markdown, titleFromPath(loaded.filePath)),
      revision: markdownRevision(updated.markdown),
      wrote: false,
    };
    return next;
  };

  if (dryRun) return prepareUpdate(await readMindMapFile(filePath));

  return withUpdateLock(filePath, async (canonicalPath) => {
    const loaded = await readMindMapFile(canonicalPath);
    const next = await prepareUpdate(loaded);
    const metadata = await requireRegularFile(canonicalPath);
    const temporaryPath = join(
      dirname(canonicalPath),
      `.laniakea-${randomBytes(12).toString("hex")}.tmp`,
    );
    let temporaryExists = false;
    try {
      await writeExclusive(
        temporaryPath,
        next.markdown,
        metadata.mode & 0o777,
      );
      temporaryExists = true;
      const current = await readMindMapFile(canonicalPath);
      if (current.revision !== expectedRevision) {
        throw new MindMapFileError(
          "conflict",
          "The Markdown changed while the update was being prepared. No content was overwritten; read the map again before retrying.",
        );
      }
      await rename(temporaryPath, canonicalPath);
      temporaryExists = false;
      next.wrote = true;
      return next;
    } finally {
      if (temporaryExists) {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
  });
}
