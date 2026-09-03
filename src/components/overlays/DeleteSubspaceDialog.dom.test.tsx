// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteSubspaceDialog } from "./DeleteSubspaceDialog";

describe("DeleteSubspaceDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("starts on the safe action and requires explicit confirmation", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <DeleteSubspaceDialog
          nodeLabel="发布计划"
          onCancel={onCancel}
          onConfirm={onConfirm}
          typeLabel="流程"
        />,
      );
    });

    expect(container.querySelector("h2")?.textContent).toBe("删除这张流程？");
    expect(container.textContent).toContain("原节点会保留");
    expect(document.activeElement?.textContent).toBe("取消");
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".delete-subspace-dialog__confirm")!
        .click(),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes safely on Escape", async () => {
    const onCancel = vi.fn();
    await act(async () => {
      root.render(
        <DeleteSubspaceDialog
          nodeLabel="发布计划"
          onCancel={onCancel}
          onConfirm={() => undefined}
          typeLabel="思维图"
        />,
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLElement>("[role='dialog']")!
        .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
