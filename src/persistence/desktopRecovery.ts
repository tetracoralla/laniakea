import { invoke } from "@tauri-apps/api/core";
import { documentToMarkdown } from "../model/markdown";
import type { MindMapDocument } from "../types/mindmap";
import type { EditorRecoveryDraft } from "./localDocumentStore";

export interface RecoveryCheckpointInput {
  document: MindMapDocument;
  documentPath: string | null;
  generation: number;
  protectedSourcePath: string | null;
  sessionId: string;
  sourceHash: string | null;
}

export interface RecoveryWriteResult {
  wrote: boolean;
  generation: number;
}

export async function writeDesktopRecoveryCheckpoint({
  document,
  documentPath,
  generation,
  protectedSourcePath,
  sessionId,
  sourceHash,
}: RecoveryCheckpointInput): Promise<RecoveryWriteResult> {
  return invoke<RecoveryWriteResult>("write_recovery_checkpoint", {
    sessionId,
    generation,
    documentJson: JSON.stringify(document),
    markdownContent: documentToMarkdown(document),
    documentPath,
    sourceHash,
    protectedSourcePath,
  });
}

export async function writeDesktopEditorRecoveryDraft(
  draft: EditorRecoveryDraft,
): Promise<RecoveryWriteResult> {
  return invoke<RecoveryWriteResult>("write_editor_recovery_draft", { draft });
}

export async function clearDesktopPendingRecovery(
  checkpointGeneration: number | null,
  editorDraftGeneration: number | null,
): Promise<void> {
  await invoke("clear_pending_recovery", {
    checkpointGeneration,
    editorDraftGeneration,
  });
}
