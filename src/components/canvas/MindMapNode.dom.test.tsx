// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankDocument, createSeedDocument } from "../../data/seed";
import { computeLayout } from "../../model/layout";
import { MindMapNode } from "./MindMapNode";

describe("node editor input method handling", () => {
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
  });

  it("keeps editing when Enter confirms an input-method composition", async () => {
    const mindMapDocument = createBlankDocument();
    const node = mindMapDocument.nodes[mindMapDocument.rootId];
    const layout = computeLayout(mindMapDocument).nodes[mindMapDocument.rootId];
    const onCommitEdit = vi.fn();

    function Harness() {
      const [draft, setDraft] = useState("中文");
      const [editing, setEditing] = useState(true);
      if (!editing) {
        return <output data-testid="committed-value">{draft}</output>;
      }
      return (
        <MindMapNode
          draft={draft}
          dragging={false}
          dropTarget={false}
          editing
          layout={layout}
          node={node}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={(id, value) => {
            onCommitEdit(id, value);
            setEditing(false);
          }}
          onDraftChange={setDraft}
          onDragPointerDown={() => undefined}
          onPasteStructured={() => false}
          onSelect={() => undefined}
          onToggle={() => undefined}
          primary
          selected
        />
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });

    const editor = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='编辑节点']",
    )!;

    await act(async () => {
      editor.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editor, "中文 English");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
        }),
      );
      editor.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });

    expect(onCommitEdit).not.toHaveBeenCalled();
    const editorAfterComposition =
      container.querySelector<HTMLTextAreaElement>(
        "textarea[aria-label='编辑节点']",
      )!;
    expect(document.activeElement).toBe(editorAfterComposition);
    expect(editorAfterComposition.value).toBe("中文 English");

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editorAfterComposition, "中文 English 后续");
      editorAfterComposition.dispatchEvent(
        new Event("input", { bubbles: true }),
      );
      editorAfterComposition.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          isComposing: true,
          key: "Enter",
        }),
      );
      editorAfterComposition.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          keyCode: 229,
        }),
      );
    });

    expect(onCommitEdit).not.toHaveBeenCalled();
    expect(editorAfterComposition.value).toBe("中文 English 后续");

    await act(async () => {
      editorAfterComposition.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
        }),
      );
    });

    expect(onCommitEdit).toHaveBeenCalledOnce();
    expect(onCommitEdit).toHaveBeenCalledWith(
      mindMapDocument.rootId,
      "中文 English 后续",
    );
    expect(
      container.querySelector("[data-testid='committed-value']")
        ?.textContent,
    ).toBe("中文 English 后续");
  });

  it("keeps the native draft and caret stable while canvas sizing catches up", async () => {
    const mindMapDocument = createBlankDocument();
    const node = mindMapDocument.nodes[mindMapDocument.rootId];
    const layout = computeLayout(mindMapDocument).nodes[mindMapDocument.rootId];
    const onDraftChange = vi.fn();
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");

    await act(async () => {
      root.render(
        <MindMapNode
          draft="初始"
          dragging={false}
          dropTarget={false}
          editing
          layout={layout}
          node={node}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDraftChange={onDraftChange}
          onDragPointerDown={() => undefined}
          onPasteStructured={() => false}
          onSelect={() => undefined}
          onToggle={() => undefined}
          primary
          selected
        />,
      );
    });

    const editor = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='编辑节点']",
    )!;
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(editor.parentElement?.classList).toContain(
      "mind-node__editor-shell",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editor, "初始长文本输入");
      editor.setSelectionRange(5, 5);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onDraftChange).toHaveBeenCalledWith("初始长文本输入");
    expect(editor.value).toBe("初始长文本输入");
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);
    focus.mockRestore();
  });

  it("keeps an end-of-text caret visible after editor height fitting", async () => {
    const mindMapDocument = createBlankDocument();
    const node = mindMapDocument.nodes[mindMapDocument.rootId];
    const layout = computeLayout(mindMapDocument).nodes[mindMapDocument.rootId];

    await act(async () => {
      root.render(
        <MindMapNode
          draft=""
          dragging={false}
          dropTarget={false}
          editing
          layout={layout}
          node={node}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDraftChange={() => undefined}
          onDragPointerDown={() => undefined}
          onPasteStructured={() => false}
          onSelect={() => undefined}
          onToggle={() => undefined}
          primary
          selected
        />,
      );
    });

    const editor = container.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='编辑节点']",
    )!;
    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      get: () => 240,
    });
    const value = "😀".repeat(100);

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editor, value);
      editor.setSelectionRange(value.length, value.length);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(editor.scrollTop).toBe(240);
    expect(editor.selectionStart).toBe(value.length);
    expect(editor.selectionEnd).toBe(value.length);
  });

  it("renders a Markdown thematic break as a divider while keeping it editable", async () => {
    const mindMapDocument = createBlankDocument();
    const node = mindMapDocument.nodes[mindMapDocument.rootId];
    node.text = "***";
    const layout = computeLayout(mindMapDocument).nodes[mindMapDocument.rootId];
    const onBeginEdit = vi.fn();

    await act(async () => {
      root.render(
        <MindMapNode
          draft=""
          dragging={false}
          dropTarget={false}
          editing={false}
          layout={layout}
          node={node}
          onBeginEdit={onBeginEdit}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDraftChange={() => undefined}
          onDragPointerDown={() => undefined}
          onPasteStructured={() => false}
          onSelect={() => undefined}
          onToggle={() => undefined}
          primary={false}
          selected={false}
        />,
      );
    });

    const dividerNode = container.querySelector<HTMLElement>(
      ".mind-node.is-markdown-divider",
    );
    const content = dividerNode?.querySelector<HTMLButtonElement>(
      ".mind-node__content",
    );
    expect(content?.getAttribute("aria-label")).toBe("Markdown 分隔线");
    expect(content?.querySelector(".mind-node__divider")).not.toBeNull();
    expect(content?.textContent).toBe("");

    await act(async () => {
      content?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onBeginEdit).toHaveBeenCalledWith(node.id);
  });

  it("marks an edited second-level node so its connector terminal is hidden", async () => {
    const mindMapDocument = createSeedDocument();
    const node = mindMapDocument.nodes.scenario;
    const layout = computeLayout(mindMapDocument).nodes.scenario;

    await act(async () => {
      root.render(
        <MindMapNode
          draft={node.text}
          dragging={false}
          dropTarget={false}
          editing
          layout={layout}
          node={node}
          onBeginEdit={() => undefined}
          onCancelEdit={() => undefined}
          onCommitEdit={() => undefined}
          onDraftChange={() => undefined}
          onDragPointerDown={() => undefined}
          onPasteStructured={() => false}
          onSelect={() => undefined}
          onToggle={() => undefined}
          primary={false}
          selected={false}
        />,
      );
    });

    const branch = container.querySelector<HTMLElement>(
      `[data-node-id="${node.id}"]`,
    );
    expect(branch?.classList.contains("mind-node--branch")).toBe(true);
    expect(branch?.classList.contains("is-editing")).toBe(true);
  });
});
