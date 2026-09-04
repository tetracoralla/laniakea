// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankDocument } from "../data/seed";
import { singleSelection } from "../model/selection";
import { useEditorSession } from "./useEditorSession";

describe("editor session lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.restoreAllMocks();
  });

  it("commits the latest draft once when duplicate finish paths arrive", async () => {
    const mindMap = createBlankDocument();
    const applyMutation = vi.fn();
    let session: ReturnType<typeof useEditorSession> | null = null;

    function Harness() {
      session = useEditorSession({
        document: mindMap,
        selection: singleSelection(mindMap.rootId),
        applyMutation,
        selectNode: vi.fn(),
        notify: vi.fn(),
        undo: vi.fn(),
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => session!.beginEdit(mindMap.rootId));
    await act(async () => {
      session!.setDraft("第一版");
      session!.setDraft("导航前的最终文本");
      session!.finishEdit();
      session!.finishEdit();
    });

    expect(applyMutation).toHaveBeenCalledOnce();
    expect(session!.editingId).toBeNull();
    const mutation = applyMutation.mock.calls[0][0]({
      document: mindMap,
      selection: singleSelection(mindMap.rootId),
    });
    expect(mutation.document.nodes[mindMap.rootId].text).toBe(
      "导航前的最终文本",
    );
  });

  it("keeps an edit session intact when another app takes window focus", async () => {
    const mindMap = createBlankDocument();
    const applyMutation = vi.fn();
    let session: ReturnType<typeof useEditorSession> | null = null;

    function Harness() {
      session = useEditorSession({
        document: mindMap,
        selection: singleSelection(mindMap.rootId),
        applyMutation,
        selectNode: vi.fn(),
        notify: vi.fn(),
        undo: vi.fn(),
      });
      return session.editingId ? (
        <textarea
          className="mind-node__editor"
          defaultValue={session.draft}
        />
      ) : null;
    }

    await act(async () => root.render(<Harness />));
    await act(async () => session!.beginEdit(mindMap.rootId));
    const editor = container.querySelector("textarea")!;
    editor.value = "切回后仍要继续编辑的内容";
    await act(async () => session!.setDraft(editor.value));
    document.body.tabIndex = -1;
    document.body.focus();

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(applyMutation).not.toHaveBeenCalled();
    expect(session!.editingId).toBe(mindMap.rootId);
    expect(session!.draft).toBe("切回后仍要继续编辑的内容");
    expect(container.querySelector("textarea")?.value).toBe(
      "切回后仍要继续编辑的内容",
    );
  });

  it("turns a requested document fit into a monotonic render token", async () => {
    const mindMap = createBlankDocument();
    let session: ReturnType<typeof useEditorSession> | null = null;

    function Harness() {
      session = useEditorSession({
        document: mindMap,
        selection: singleSelection(mindMap.rootId),
        applyMutation: vi.fn(),
        selectNode: vi.fn(),
        notify: vi.fn(),
        undo: vi.fn(),
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    expect(session!.fitRequest).toBe(0);
    await act(async () => session!.finishDocumentSwitch(true));
    expect(session!.fitRequest).toBe(1);
    await act(async () => session!.finishDocumentSwitch(false));
    expect(session!.fitRequest).toBe(1);
  });

  it("requests a canvas fit when a blank document begins so its root starts centered", async () => {
    const mindMap = createBlankDocument();
    let session: ReturnType<typeof useEditorSession> | null = null;

    function Harness() {
      session = useEditorSession({
        document: mindMap,
        selection: singleSelection(mindMap.rootId),
        applyMutation: vi.fn(),
        selectNode: vi.fn(),
        notify: vi.fn(),
        undo: vi.fn(),
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    expect(session!.fitRequest).toBe(0);
    await act(async () => session!.beginBlankDocument(mindMap.rootId));
    expect(session!.fitRequest).toBe(1);
  });

  it("titles a structured paste into the blank root from its root text", async () => {
    const mindMap = createBlankDocument();
    const applyMutation = vi.fn();
    let session: ReturnType<typeof useEditorSession> | null = null;

    function Harness() {
      session = useEditorSession({
        document: mindMap,
        selection: singleSelection(mindMap.rootId),
        applyMutation,
        selectNode: vi.fn(),
        notify: vi.fn(),
        undo: vi.fn(),
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    let consumed = false;
    await act(async () => {
      consumed = session!.pasteStructuredIntoBlankRoot(
        mindMap.rootId,
        "- 产品规划\n  - 用户调研",
      );
    });

    expect(consumed).toBe(true);
    expect(applyMutation).toHaveBeenCalledOnce();
    const mutation = applyMutation.mock.calls[0][0]({
      document: mindMap,
      selection: singleSelection(mindMap.rootId),
    });
    expect(mutation.document.title).toBe("产品规划");
  });
});
