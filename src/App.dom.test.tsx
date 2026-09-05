// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/canvas/MindMapCanvas", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    MindMapCanvas: forwardRef(function TestMindMapCanvas(
      props: { onOpenCanvasContextMenu: (anchor: {
        clientX: number;
        clientY: number;
        contentX: number;
        contentY: number;
      }) => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        fit: () => undefined,
        focusCanvas: () => undefined,
        focusSelected: () => undefined,
        flushViewport: () => undefined,
        resetZoom: () => undefined,
        zoomIn: () => undefined,
        zoomOut: () => undefined,
      }));
      return (
        <button
          className="mindmap-canvas"
          onContextMenu={(event) => {
            event.preventDefault();
            props.onOpenCanvasContextMenu({
              clientX: 240,
              clientY: 180,
              contentX: 120,
              contentY: 90,
            });
          }}
          type="button"
        >
          测试画布
        </button>
      );
    }),
  };
});

vi.mock("./persistence/localDocumentStore", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("./persistence/localDocumentStore")
  >();
  let draftId = 0;
  return {
    ...original,
    activateLocalDocument: vi.fn(async () => undefined),
    clearActiveDocument: vi.fn(async () => undefined),
    createMarkdownDraft: vi.fn(async () => ({
      documentPath: `browser:test-${++draftId}`,
      sourceHash: `revision-${draftId}`,
    })),
    isDesktopRuntime: () => false,
    loadLocalDocument: vi.fn(async () => ({
      document: null,
      documentPath: null,
      sourcePath: null,
      recoveredFromBackup: false,
      notice: null,
      saveError: null,
      sourceFormat: "markdown" as const,
      importedAsCopy: false,
      viewStateRestored: false,
      sourceHash: null,
    })),
  };
});

import { App } from "./App";

describe("App document-scoped overlays", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    localStorage.clear();
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("dismisses a blank-canvas menu before a keyboard-created document becomes active", async () => {
    await act(async () => {
      root.render(<App />);
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    const canvas = container.querySelector<HTMLElement>(".mindmap-canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    expect(container.textContent).toContain("新建浮动节点");
    const menuItem = container.querySelector<HTMLButtonElement>(
      "[role='menuitem']",
    )!;

    const newDocumentKey = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "n",
    });
    await act(async () => {
      menuItem.dispatchEvent(newDocumentKey);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(newDocumentKey.defaultPrevented).toBe(true);
    expect(container.textContent).not.toContain("新建浮动节点");
  });
});
