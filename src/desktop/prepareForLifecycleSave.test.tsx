// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareEditableFieldsForLifecycleSave } from "./prepareForLifecycleSave";

describe("prepareEditableFieldsForLifecycleSave", () => {
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

  it("commits a mounted editor even after native focus has already left it", async () => {
    const commitTitle = vi.fn();
    const commitNode = vi.fn();

    await act(async () => {
      root.render(
        <>
          <label className="document-title">
            <input defaultValue="原标题" onBlur={(event) => commitTitle(event.currentTarget.value)} />
          </label>
          <textarea
            className="mind-node__editor"
            defaultValue="原节点"
            onBlur={(event) => commitNode(event.currentTarget.value)}
          />
        </>,
      );
    });
    const nodeEditor = container.querySelector<HTMLTextAreaElement>(
      ".mind-node__editor",
    )!;
    nodeEditor.value = "退出前仍在 DOM 中的新节点";
    expect(document.activeElement).not.toBe(nodeEditor);

    act(() => prepareEditableFieldsForLifecycleSave());

    expect(commitNode).toHaveBeenCalledWith("退出前仍在 DOM 中的新节点");
    expect(commitTitle).toHaveBeenCalledWith("原标题");
  });

  it("uses normal blur for the currently focused editable field", async () => {
    const commit = vi.fn();
    await act(async () => {
      root.render(
        <textarea
          className="flow-node__editor"
          defaultValue="新步骤"
          onBlur={(event) => commit(event.currentTarget.value)}
        />,
      );
    });
    const editor = container.querySelector<HTMLTextAreaElement>(
      ".flow-node__editor",
    )!;
    editor.focus();

    act(() => prepareEditableFieldsForLifecycleSave());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("新步骤");
  });
});
