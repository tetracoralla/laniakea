import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../data/seed";
import { RecoveryCoordinator } from "./recoveryCoordinator";

const recovery = vi.hoisted(() => ({
  checkpoint: vi.fn(async ({ generation }: { generation: number }) => ({
    wrote: true,
    generation,
  })),
  clear: vi.fn(async () => undefined),
  draft: vi.fn(async ({ generation }: { generation: number }) => ({
    wrote: true,
    generation,
  })),
}));

vi.mock("./desktopRecovery", () => ({
  clearDesktopPendingRecovery: recovery.clear,
  writeDesktopEditorRecoveryDraft: recovery.draft,
  writeDesktopRecoveryCheckpoint: recovery.checkpoint,
}));

const binding = {
  documentPath: "/tmp/方案.md",
  protectedSourcePath: null,
  sourceHash: "hash-v1",
};

describe("RecoveryCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recovery.checkpoint.mockClear();
    recovery.clear.mockClear();
    recovery.draft.mockClear();
  });

  it("ignores viewport-only objects but checkpoints the first content mutation", async () => {
    const source = createSeedDocument();
    const errors: Array<string | null> = [];
    const coordinator = new RecoveryCoordinator({
      enabled: true,
      isDocumentSessionCurrent: (session) => session === 7,
      onError: (message) => errors.push(message),
    });
    coordinator.adoptDocument(source);

    coordinator.observeDocument({
      ...source,
      viewport: { x: 20, y: 10, zoom: 0.9 },
    }, binding, 7);
    await Promise.resolve();
    expect(recovery.checkpoint).not.toHaveBeenCalled();

    coordinator.observeDocument({ ...source, title: "新标题" }, binding, 7);
    await vi.waitFor(() => expect(recovery.checkpoint).toHaveBeenCalledTimes(1));
    expect(recovery.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      document: expect.objectContaining({ title: "新标题" }),
      documentPath: binding.documentPath,
      sourceHash: binding.sourceHash,
    }));
    expect(errors.at(-1)).toBeNull();
  });

  it("coalesces fast typing and saves only the latest editor draft", async () => {
    const source = createSeedDocument();
    const coordinator = new RecoveryCoordinator({
      enabled: true,
      isDocumentSessionCurrent: () => true,
      onError: () => undefined,
    });
    coordinator.adoptDocument(source);
    const target = {
      objectId: source.rootId,
      objectKind: "mind-node" as const,
      spaceId: null,
      surface: "root-map" as const,
    };

    coordinator.protectEditorDraft(source, binding, 1, target, "第");
    await vi.advanceTimersByTimeAsync(40);
    coordinator.protectEditorDraft(source, binding, 1, target, "第二版");
    await vi.advanceTimersByTimeAsync(72);
    await vi.waitFor(() => expect(recovery.draft).toHaveBeenCalledTimes(1));

    expect(recovery.checkpoint).toHaveBeenCalledTimes(1);
    expect(recovery.draft).toHaveBeenCalledWith(expect.objectContaining({
      checkpointGeneration: expect.any(Number),
      objectId: source.rootId,
      text: "第二版",
    }));
  });

  it("does not let a save clear an active draft and clears a committed draft", async () => {
    const source = createSeedDocument();
    const coordinator = new RecoveryCoordinator({
      enabled: true,
      isDocumentSessionCurrent: () => true,
      onError: () => undefined,
    });
    coordinator.adoptDocument(source);
    coordinator.protectEditorDraft(source, binding, 1, {
      objectId: "document-title",
      objectKind: "title",
      spaceId: null,
      surface: "root-map",
    }, "尚未提交");
    await vi.advanceTimersByTimeAsync(72);

    const activeCutoff = await coordinator.prepareSave(source, binding, 1, false);
    expect(activeCutoff).toEqual({
      checkpointGeneration: null,
      editorDraftGeneration: null,
    });

    coordinator.finishEditorDraft(false);
    await vi.waitFor(() => expect(recovery.draft).toHaveBeenCalledTimes(1));
    const committed = { ...source, title: "尚未提交" };
    const committedCutoff = await coordinator.prepareSave(
      committed,
      binding,
      1,
      false,
    );
    expect(committedCutoff.checkpointGeneration).toEqual(expect.any(Number));
    expect(committedCutoff.editorDraftGeneration).toEqual(expect.any(Number));
  });

  it("clears only the cancelled editor generation after queued writes", async () => {
    const source = createSeedDocument();
    const coordinator = new RecoveryCoordinator({
      enabled: true,
      isDocumentSessionCurrent: () => true,
      onError: () => undefined,
    });
    coordinator.adoptDocument(source);
    coordinator.protectEditorDraft(source, binding, 1, {
      objectId: source.rootId,
      objectKind: "mind-node",
      spaceId: null,
      surface: "root-map",
    }, "取消它");
    await vi.advanceTimersByTimeAsync(72);
    await vi.waitFor(() => expect(recovery.draft).toHaveBeenCalledTimes(1));

    const generation = recovery.draft.mock.calls[0]?.[0].generation;
    coordinator.finishEditorDraft(true);
    await vi.waitFor(() => expect(recovery.clear).toHaveBeenCalledTimes(1));
    expect(recovery.clear).toHaveBeenCalledWith(null, generation);
  });

  it("lets the first explicit save clear an editor draft restored at startup", async () => {
    const restored = createSeedDocument();
    const coordinator = new RecoveryCoordinator({
      enabled: true,
      isDocumentSessionCurrent: () => true,
      onError: () => undefined,
    });

    coordinator.adoptDocument(restored, 220, 221);

    await expect(
      coordinator.prepareSave(restored, binding, 1, false),
    ).resolves.toEqual({
      checkpointGeneration: 220,
      editorDraftGeneration: 221,
    });
  });

  it("never allocates a generation below an adopted recovery floor", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const source = createSeedDocument();
    const coordinator = new RecoveryCoordinator({
      enabled: true,
      isDocumentSessionCurrent: () => true,
      onError: () => undefined,
    });
    // A record restored from a previous session can carry a generation far
    // ahead of the current wall clock after an NTP correction moved it back.
    coordinator.adoptDocument(source, 4_103_800_000_000_000, 4_103_800_000_000_001);

    coordinator.protectEditorDraft(source, binding, 1, {
      objectId: source.rootId,
      objectKind: "mind-node",
      spaceId: null,
      surface: "root-map",
    }, "回拨后的新输入");
    await vi.advanceTimersByTimeAsync(72);
    await vi.waitFor(() => expect(recovery.draft).toHaveBeenCalledTimes(1));

    expect(recovery.draft.mock.calls[0]?.[0].generation).toBeGreaterThan(
      4_103_800_000_000_001,
    );
  });
});
