// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasHandle } from "../components/canvas/MindMapCanvas";
import { createSeedDocument } from "../data/seed";
import { singleSelection } from "../model/selection";
import { useMindMapCommands } from "./useMindMapCommands";

const clipboard = vi.hoisted(() => ({
  copyDocumentMarkdown: vi.fn(async () => undefined),
  copyMarkdown: vi.fn(async () => undefined),
  cutSelection: vi.fn(async () => undefined),
  pasteClipboard: vi.fn(async () => undefined),
}));

vi.mock("./useMindMapClipboard", () => ({
  useMindMapClipboard: () => clipboard,
}));

describe("mind map command behavior", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    clipboard.copyDocumentMarkdown.mockClear();
    clipboard.copyMarkdown.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps Shift-Command-C selection-aware instead of copying the whole document", async () => {
    function Harness() {
      const document = createSeedDocument();
      const [editingId, setEditingId] = useState<string | null>(null);
      const [, setDraft] = useState("");
      const canvasRef = useRef<CanvasHandle>(null);
      const { executeCommand } = useMindMapCommands({
        mindMap: document,
        selection: singleSelection("scenario"),
        canUndo: false,
        canRedo: false,
        canvasRef,
        applyMutation: vi.fn(),
        documentSessionId: 1,
        isDocumentSessionCurrent: () => true,
        selectNode: vi.fn(),
        setSelection: vi.fn(),
        setEditingId,
        setDraft,
        openOverlay: vi.fn(),
        notify: vi.fn(),
        onImport: vi.fn(),
        onNew: vi.fn(),
        onSaveAs: vi.fn(),
        saveNow: vi.fn(async () => true),
        undo: vi.fn(),
        redo: vi.fn(),
      });
      return (
        <button
          data-editing={editingId ?? ""}
          onClick={() => executeCommand("map.copy-markdown")}
        >
          复制当前分支
        </button>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
    });

    expect(clipboard.copyMarkdown).toHaveBeenCalledTimes(1);
    expect(clipboard.copyDocumentMarkdown).not.toHaveBeenCalled();
  });
});
