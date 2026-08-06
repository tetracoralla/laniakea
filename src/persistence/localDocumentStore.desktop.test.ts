import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

import {
  activateLocalDocument,
  createMarkdownDraft,
  moveInternalDraft,
  openLocalDocument,
  saveLocalDocument,
  shouldFitLoadedDocument,
} from "./localDocumentStore";

describe("desktop Markdown document persistence", () => {
  beforeEach(() => invoke.mockReset());

  it("creates a new map as a bound Markdown draft", async () => {
    invoke.mockResolvedValueOnce({
      documentPath: "/app-data/drafts/未命名思维-1.md",
      sourceHash: "hash-draft",
    });
    const document = createSeedDocument();

    const created = await createMarkdownDraft(document);

    expect(created).toEqual({
      documentPath: "/app-data/drafts/未命名思维-1.md",
      sourceHash: "hash-draft",
    });
    expect(invoke).toHaveBeenCalledWith(
      "create_markdown_draft",
      expect.objectContaining({
        activateDocument: true,
        documentJson: JSON.stringify(document),
        markdownContent: expect.stringContaining(
          "- 做一个思维导图 APP",
        ),
      }),
    );
  });

  it("moves an app-managed draft through the desktop backend", async () => {
    invoke.mockResolvedValueOnce({ sourceHash: "hash-moved" });

    const moved = await moveInternalDraft(
      "/app-data/drafts/方案.md",
      "/Users/adam/Documents/方案.md",
    );

    expect(moved).toEqual({ sourceHash: "hash-moved" });
    expect(invoke).toHaveBeenCalledWith("move_internal_draft", {
      sourcePath: "/app-data/drafts/方案.md",
      targetPath: "/Users/adam/Documents/方案.md",
    });
  });

  it("binds an editable Markdown outline to its source path", async () => {
    invoke.mockResolvedValueOnce({
      document: null,
      outlineContent: "# 方案\n\n- 原点\n  - 路径\n",
      documentFormat: "markdown",
      documentPath: "/tmp/方案.md",
      recoveredFromBackup: false,
      notice: null,
      sourceHash: "hash-v1",
    });

    const loaded = await openLocalDocument("/tmp/方案.md");

    expect(loaded.documentPath).toBe("/tmp/方案.md");
    expect(loaded.sourcePath).toBe("/tmp/方案.md");
    expect(loaded.importedAsCopy).toBe(false);
    expect(loaded.sourceHash).toBe("hash-v1");
    expect(loaded.document?.title).toBe("方案");
    expect(loaded.document?.nodes[loaded.document.rootId].text).toBe(
      "原点",
    );
  });

  it("renders rich Markdown without binding or overwriting its source", async () => {
    invoke.mockResolvedValueOnce({
      document: null,
      outlineContent:
        "# 方案\n\n正文\n\n```ts\nconst safe = true\n```\n",
      documentFormat: "markdown",
      documentPath: "/tmp/复杂方案.md",
      recoveredFromBackup: false,
      notice: null,
      sourceHash: "rich-hash",
    });
    const loaded = await openLocalDocument("/tmp/复杂方案.md");

    expect(loaded.documentPath).toBeNull();
    expect(loaded.sourcePath).toBe("/tmp/复杂方案.md");
    expect(loaded.importedAsCopy).toBe(true);
    expect(loaded.sourceHash).toBeNull();
    expect(loaded.notice).toBeNull();
    expect(shouldFitLoadedDocument(loaded)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("open_local_document", {
      documentPath: "/tmp/复杂方案.md",
    });
  });

  it("writes the visible document as Markdown when the path is Markdown", async () => {
    invoke.mockResolvedValueOnce({ sourceHash: "hash-v2" });
    const document = createSeedDocument();

    const saved = await saveLocalDocument(
      document,
      "/tmp/方案.md",
      "hash-v1",
    );

    expect(saved.sourceHash).toBe("hash-v2");
    expect(invoke).toHaveBeenCalledWith(
      "save_local_document",
      expect.objectContaining({
        documentPath: "/tmp/方案.md",
        expectedSourceHash: "hash-v1",
        protectedSourcePath: null,
        viewportOnly: false,
        markdownContent: expect.stringContaining(
          "- 做一个思维导图 APP",
        ),
      }),
    );
  });

  it("saves only Markdown view state for a viewport change", async () => {
    invoke.mockResolvedValueOnce({ sourceHash: "hash-v1" });

    await saveLocalDocument(
      createSeedDocument(),
      "/tmp/方案.md",
      "hash-v1",
      null,
      { viewportOnly: true },
    );

    expect(invoke).toHaveBeenCalledWith("save_local_document", {
      documentJson: expect.any(String),
      documentPath: "/tmp/方案.md",
      expectedSourceHash: "hash-v1",
      protectedSourcePath: null,
      viewportOnly: true,
      markdownContent: null,
    });
  });

  it("passes a protected rich Markdown source to the native save guard", async () => {
    invoke.mockResolvedValueOnce({
      sourceHash: "hash-copy",
      auxiliaryWarning: null,
    });

    await saveLocalDocument(
      createSeedDocument(),
      "/tmp/方案 - 另存.md",
      null,
      "/tmp/方案.md",
    );

    expect(invoke).toHaveBeenCalledWith(
      "save_local_document",
      expect.objectContaining({
        documentPath: "/tmp/方案 - 另存.md",
        protectedSourcePath: "/tmp/方案.md",
      }),
    );
  });

  it("keeps a committed source hash when only auxiliary state cleanup warns", async () => {
    invoke.mockResolvedValueOnce({
      sourceHash: "hash-committed",
      auxiliaryWarning: "state cache failed",
    });

    const saved = await saveLocalDocument(
      createSeedDocument(),
      "/tmp/方案.md",
      "hash-before",
    );

    expect(saved).toEqual({
      sourceHash: "hash-committed",
      auxiliaryWarning:
        "正文已经保存，但本地视图状态或旧备份清理未完成。",
    });
  });

  it("opens a legacy native file as an unbound migration copy", async () => {
    const document = createSeedDocument();
    invoke.mockResolvedValueOnce({
      document: JSON.stringify(document),
      outlineContent: null,
      documentFormat: "native",
      documentPath: "/tmp/旧方案.mindmap.json",
      recoveredFromBackup: false,
      notice: null,
      sourceHash: null,
    });
    const loaded = await openLocalDocument(
      "/tmp/旧方案.mindmap.json",
    );

    expect(loaded.documentPath).toBeNull();
    expect(loaded.sourcePath).toBe("/tmp/旧方案.mindmap.json");
    expect(loaded.importedAsCopy).toBe(true);
    expect(loaded.notice).toContain("保存时请选择 Markdown");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("activates a document only after the workflow accepts it", async () => {
    invoke.mockResolvedValueOnce(undefined);

    await activateLocalDocument("/tmp/方案.md");

    expect(invoke).toHaveBeenCalledWith("activate_local_document", {
      documentPath: "/tmp/方案.md",
    });
  });

  it("surfaces an external file conflict without reducing it to a disk error", async () => {
    invoke.mockRejectedValueOnce(
      "EXTERNAL_DOCUMENT_CONFLICT: Markdown 文件已在其他应用中修改",
    );

    await expect(
      saveLocalDocument(
        createSeedDocument(),
        "/tmp/方案.md",
        "hash-v1",
      ),
    ).rejects.toThrow("文件已在外部修改或移动，原文件未被覆盖");
  });
});
