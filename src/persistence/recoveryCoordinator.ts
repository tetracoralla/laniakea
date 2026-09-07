import type { MindMapDocument } from "../types/mindmap";
import { createRuntimeId } from "../model/runtimeId";
import { sharesDocumentContent } from "./autosavePolicy";
import type { EditorRecoveryDraft } from "./localDocumentStore";
import {
  clearDesktopPendingRecovery,
  writeDesktopEditorRecoveryDraft,
  writeDesktopRecoveryCheckpoint,
} from "./desktopRecovery";

export interface RecoveryBinding {
  documentPath: string | null;
  protectedSourcePath: string | null;
  sourceHash: string | null;
}

export interface RecoveryEditorTarget {
  objectId: string;
  objectKind: EditorRecoveryDraft["objectKind"];
  spaceId: string | null;
  surface: EditorRecoveryDraft["surface"];
}

export interface RecoverySaveCutoff {
  checkpointGeneration: number | null;
  editorDraftGeneration: number | null;
}

interface PendingEditorDraft {
  binding: RecoveryBinding;
  checkpointGeneration: Promise<number | null>;
  documentSession: number;
  generation: number;
  target: RecoveryEditorTarget;
  text: string;
}

interface RecoveryCoordinatorOptions {
  enabled: boolean;
  isDocumentSessionCurrent: (session: number) => boolean;
  onError: (message: string | null) => void;
}

let generationSequence = 0;
let generationFloor = 0;

function nextGeneration(): number {
  generationSequence = (generationSequence + 1) % 1000;
  // Wall clock can move backwards across sessions (NTP correction), and a
  // lower generation would be silently rejected by the storage guard. Keep a
  // process-local floor so generations only ever move forward.
  generationFloor = Math.max(generationFloor + 1, Date.now() * 1000 + generationSequence);
  return generationFloor;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "无法保护尚未保存的编辑内容。";
}

/**
 * Serializes the small crash-recovery protocol independently from the normal
 * source save queue. Generations let source saves clear only records they
 * actually absorbed, so an older completion cannot erase newer typing.
 */
export class RecoveryCoordinator {
  private readonly enabled: boolean;
  private readonly isDocumentSessionCurrent: (session: number) => boolean;
  private readonly onError: (message: string | null) => void;
  private readonly sessionId = createRuntimeId("session");
  private queue: Promise<void> = Promise.resolve();
  private checkpointByDocument = new WeakMap<MindMapDocument, number>();
  private lastObservedDocument: MindMapDocument | null = null;
  private lastCheckpointRequest: {
    binding: RecoveryBinding;
    document: MindMapDocument;
    documentSession: number;
  } | null = null;
  private pendingEditorDraft: PendingEditorDraft | null = null;
  private editorDraftTimer: ReturnType<typeof setTimeout> | null = null;
  private activeEditorDraftGeneration: number | null = null;
  private absorbedEditorDraftGeneration: number | null = null;

  constructor({
    enabled,
    isDocumentSessionCurrent,
    onError,
  }: RecoveryCoordinatorOptions) {
    this.enabled = enabled;
    this.isDocumentSessionCurrent = isDocumentSessionCurrent;
    this.onError = onError;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => undefined).then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  adoptDocument(
    document: MindMapDocument,
    recoveryGeneration: number | null = null,
    recoveryEditorDraftGeneration: number | null = null,
  ): void {
    this.lastObservedDocument = document;
    this.lastCheckpointRequest = null;
    this.pendingEditorDraft = null;
    this.activeEditorDraftGeneration = null;
    // A restored editor draft has already been composed into `document` by
    // the loader. Seed its generation as absorbed so the first explicit save
    // can clear both recovery records without treating the draft as active.
    this.absorbedEditorDraftGeneration = recoveryEditorDraftGeneration;
    if (this.editorDraftTimer !== null) {
      globalThis.clearTimeout(this.editorDraftTimer);
      this.editorDraftTimer = null;
    }
    if (recoveryGeneration) {
      this.checkpointByDocument.set(document, recoveryGeneration);
      // A record restored from a previous session defines the current
      // generation floor even when the wall clock is now behind it.
      generationFloor = Math.max(
        generationFloor,
        recoveryGeneration,
        recoveryEditorDraftGeneration ?? 0,
      );
    }
  }

  private ensureCheckpoint(
    document: MindMapDocument,
    binding: RecoveryBinding,
    documentSession: number,
  ): Promise<number | null> {
    if (!this.enabled) return Promise.resolve(null);
    const existing = this.checkpointByDocument.get(document);
    if (existing) return Promise.resolve(existing);

    const generation = nextGeneration();
    this.checkpointByDocument.set(document, generation);
    this.lastCheckpointRequest = { binding, document, documentSession };
    return this.enqueue(async () => {
      if (!this.isDocumentSessionCurrent(documentSession)) return null;
      try {
        await writeDesktopRecoveryCheckpoint({
          document,
          documentPath: binding.documentPath,
          generation,
          protectedSourcePath: binding.protectedSourcePath,
          sessionId: this.sessionId,
          sourceHash: binding.sourceHash,
        });
        this.onError(null);
        return generation;
      } catch (error) {
        if (this.checkpointByDocument.get(document) === generation) {
          this.checkpointByDocument.delete(document);
        }
        const message = errorMessage(error);
        this.onError(message);
        throw error;
      }
    });
  }

  observeDocument(
    document: MindMapDocument,
    binding: RecoveryBinding,
    documentSession: number,
  ): void {
    if (!this.enabled) return;
    const previous = this.lastObservedDocument;
    this.lastObservedDocument = document;
    if (!previous || sharesDocumentContent(document, previous)) return;
    void this.ensureCheckpoint(document, binding, documentSession).catch(
      () => undefined,
    );
  }

  protectEditorDraft(
    document: MindMapDocument,
    binding: RecoveryBinding,
    documentSession: number,
    target: RecoveryEditorTarget,
    text: string,
  ): void {
    if (!this.enabled) return;
    const generation = nextGeneration();
    const checkpointGeneration = this.ensureCheckpoint(
      document,
      binding,
      documentSession,
    );
    this.pendingEditorDraft = {
      binding,
      checkpointGeneration,
      documentSession,
      generation,
      target,
      text,
    };
    this.activeEditorDraftGeneration = generation;
    if (this.editorDraftTimer !== null) {
      globalThis.clearTimeout(this.editorDraftTimer);
    }
    this.editorDraftTimer = globalThis.setTimeout(() => {
      this.editorDraftTimer = null;
      void this.flushEditorDraft().catch(() => undefined);
    }, 72);
  }

  private flushEditorDraft(): Promise<number | null> {
    const pending = this.pendingEditorDraft;
    if (!this.enabled || !pending) return Promise.resolve(null);
    this.pendingEditorDraft = null;
    return this.enqueue(async () => {
      const checkpointGeneration = await pending.checkpointGeneration;
      if (
        !checkpointGeneration ||
        !this.isDocumentSessionCurrent(pending.documentSession)
      ) {
        return null;
      }
      const draft: EditorRecoveryDraft = {
        formatVersion: 1,
        sessionId: this.sessionId,
        generation: pending.generation,
        checkpointGeneration,
        documentPath: pending.binding.documentPath,
        sourceHash: pending.binding.sourceHash,
        surface: pending.target.surface,
        spaceId: pending.target.spaceId,
        objectKind: pending.target.objectKind,
        objectId: pending.target.objectId,
        text: pending.text,
      };
      try {
        await writeDesktopEditorRecoveryDraft(draft);
        this.onError(null);
        return pending.generation;
      } catch (error) {
        const message = errorMessage(error);
        this.onError(message);
        throw error;
      }
    });
  }

  finishEditorDraft(cancelled: boolean): void {
    if (!this.enabled) return;
    if (this.editorDraftTimer !== null) {
      globalThis.clearTimeout(this.editorDraftTimer);
      this.editorDraftTimer = null;
    }
    const cutoff = this.activeEditorDraftGeneration;
    if (cancelled) {
      this.pendingEditorDraft = null;
      this.activeEditorDraftGeneration = null;
      if (cutoff) {
        void this.enqueue(async () => {
          await clearDesktopPendingRecovery(null, cutoff);
          this.onError(null);
        }).catch((error) => this.onError(errorMessage(error)));
      }
      return;
    }

    void this.flushEditorDraft()
      .then((generation) => {
        const absorbed = generation ?? cutoff;
        if (absorbed) {
          this.absorbedEditorDraftGeneration = Math.max(
            this.absorbedEditorDraftGeneration ?? 0,
            absorbed,
          );
        }
        if (this.activeEditorDraftGeneration === cutoff) {
          this.activeEditorDraftGeneration = null;
        }
      })
      .catch(() => undefined);
  }

  async prepareSave(
    document: MindMapDocument,
    binding: RecoveryBinding,
    documentSession: number,
    viewportOnly: boolean,
  ): Promise<RecoverySaveCutoff> {
    const checkpointGeneration = viewportOnly
      ? null
      : await this.ensureCheckpoint(document, binding, documentSession);
    await this.queue;
    return {
      checkpointGeneration: this.activeEditorDraftGeneration
        ? null
        : checkpointGeneration,
      // An active editor draft is not part of the document being saved. Only
      // clear drafts whose finish event has already composed into document.
      editorDraftGeneration: this.activeEditorDraftGeneration
        ? null
        : this.absorbedEditorDraftGeneration,
    };
  }

  markSaveCompleted(
    document: MindMapDocument,
    cutoff: RecoverySaveCutoff,
  ): void {
    if (
      cutoff.checkpointGeneration &&
      this.checkpointByDocument.get(document) === cutoff.checkpointGeneration
    ) {
      this.checkpointByDocument.delete(document);
    }
    if (
      cutoff.editorDraftGeneration &&
      this.absorbedEditorDraftGeneration === cutoff.editorDraftGeneration
    ) {
      this.absorbedEditorDraftGeneration = null;
    }
    this.lastObservedDocument = document;
  }

  retryLastCheckpoint(): void {
    const request = this.lastCheckpointRequest;
    if (!request) return;
    this.checkpointByDocument.delete(request.document);
    void this.ensureCheckpoint(
      request.document,
      request.binding,
      request.documentSession,
    ).catch(() => undefined);
  }
}
