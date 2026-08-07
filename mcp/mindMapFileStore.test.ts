import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMindMapFile,
  readMindMapFile,
  updateMindMapFile,
} from "./mindMapFileStore";

describe("Laniakea Agent Markdown file store", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "laniakea-file-store-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("creates a new file but never overwrites an existing destination", async () => {
    const filePath = join(workspace, "map.md");
    await createMindMapFile(filePath, "Plan", {
      text: "Root",
      children: [{ text: "First" }],
    });

    await expect(
      createMindMapFile(filePath, "Overwrite", { text: "Forbidden" }),
    ).rejects.toMatchObject({ code: "already_exists" });
    expect(await readFile(filePath, "utf8")).toContain("First");
    expect(await readFile(filePath, "utf8")).not.toContain("Forbidden");
  });

  it("rejects a stale update without changing the newer Markdown", async () => {
    const filePath = join(workspace, "map.md");
    const created = await createMindMapFile(filePath, "Plan", {
      text: "Root",
      children: [{ text: "First" }],
    });
    await writeFile(filePath, `${created.markdown}\n- External change\n`, "utf8");
    const newer = await readFile(filePath, "utf8");

    await expect(
      updateMindMapFile(filePath, created.revision, [
        { type: "set_title", title: "Stale" },
      ]),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(filePath, "utf8")).toBe(newer);
  });

  it("serializes revision checks across canonical aliases", async () => {
    const realDirectory = join(workspace, "real");
    const aliasDirectory = join(workspace, "alias");
    await mkdir(realDirectory);
    await symlink(realDirectory, aliasDirectory, "dir");
    const filePath = join(realDirectory, "map.md");
    const aliasPath = join(aliasDirectory, "map.md");

    for (let round = 0; round < 40; round += 1) {
      await writeFile(filePath, `# Round ${round}\n\n- Root\n`, "utf8");
      const loaded = await readMindMapFile(filePath);
      const results = await Promise.allSettled([
        updateMindMapFile(filePath, loaded.revision, [
          { type: "set_title", title: `First ${round}` },
        ]),
        updateMindMapFile(aliasPath, loaded.revision, [
          { type: "set_title", title: `Second ${round}` },
        ]),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result) => result.status === "rejected",
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((fulfilled[0] as PromiseFulfilledResult<unknown>).value).toMatchObject({
        wrote: true,
      });
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "conflict",
      });
    }
  });

  it("keeps a dry-run in memory and commits the same batch atomically", async () => {
    const filePath = join(workspace, "map.md");
    const created = await createMindMapFile(filePath, "Plan", {
      text: "Root",
      children: [{ text: "First" }, { text: "Second" }],
    });
    const operations = [
      { type: "set_text" as const, ref: "/0/1", text: "Updated" },
      {
        type: "add_child" as const,
        parentRef: "/0/1",
        node: { text: "Detail" },
      },
    ];
    const preview = await updateMindMapFile(
      filePath,
      created.revision,
      operations,
      true,
    );

    expect(preview.wrote).toBe(false);
    expect(preview.markdown).toContain("Detail");
    expect(await readFile(filePath, "utf8")).toBe(created.markdown);

    const committed = await updateMindMapFile(
      filePath,
      created.revision,
      operations,
    );
    expect(committed.wrote).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe(preview.markdown);
  });

  it("reads but does not rewrite rich Markdown", async () => {
    const filePath = join(workspace, "rich.md");
    const rich = "# Rich\n\n| Keep | This |\n| --- | --- |\n| Yes | Always |\n";
    await writeFile(filePath, rich, "utf8");
    const loaded = await readMindMapFile(filePath);

    expect(loaded.parsed.canOverwriteSource).toBe(false);
    await expect(
      updateMindMapFile(filePath, loaded.revision, [
        { type: "set_title", title: "Lossy" },
      ]),
    ).rejects.toMatchObject({ code: "protected_source" });
    expect(await readFile(filePath, "utf8")).toBe(rich);
  });

  it("preserves the exact source permissions after atomic replacement", async () => {
    const filePath = join(workspace, "shared.md");
    const created = await createMindMapFile(filePath, "Shared", {
      text: "Root",
    });
    await chmod(filePath, 0o666);

    await updateMindMapFile(filePath, created.revision, [
      { type: "set_title", title: "Still shared" },
    ]);

    expect((await stat(filePath)).mode & 0o777).toBe(0o666);
  });

  it("updates a legal long Markdown filename with a fixed-length temporary name", async () => {
    const filePath = join(workspace, `${"m".repeat(230)}.md`);
    await writeFile(filePath, "# Long\n\n- Root\n", "utf8");
    const loaded = await readMindMapFile(filePath);

    await expect(
      updateMindMapFile(filePath, loaded.revision, [
        { type: "set_title", title: "Updated" },
      ]),
    ).resolves.toMatchObject({ wrote: true });
    expect(await readFile(filePath, "utf8")).toContain("# Updated");
  });

  it("requires explicit Markdown files and rejects symbolic links", async () => {
    await expect(readMindMapFile("relative.md")).rejects.toMatchObject({
      code: "invalid_path",
    });
    const target = join(workspace, "target.md");
    const link = join(workspace, "link.md");
    await writeFile(target, "# Map\n\n- Root\n", "utf8");
    await symlink(target, link);

    await expect(readMindMapFile(link)).rejects.toMatchObject({
      code: "invalid_path",
    });
  });
});
