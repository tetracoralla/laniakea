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
    vi.restoreAllMocks();
  });

  it("commits one history mutation when duplicate focus-loss paths arrive", async () => {
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
      session!.commitEdit(mindMap.rootId, "失焦后的最终文本");
      session!.commitEdit(mindMap.rootId, "失焦后的最终文本");
    });

    expect(applyMutation).toHaveBeenCalledOnce();
    expect(session!.editingId).toBeNull();
  });

  it("commits the mounted editor value after native focus already left it", async () => {
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
    editor.value = "输入事件落后于原生失焦的内容";
    document.body.tabIndex = -1;
    document.body.focus();

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(applyMutation).toHaveBeenCalledOnce();
    const mutation = applyMutation.mock.calls[0][0]({
      document: mindMap,
      selection: singleSelection(mindMap.rootId),
    });
    expect(mutation.document.nodes[mindMap.rootId].text).toBe(
      "输入事件落后于原生失焦的内容",
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
