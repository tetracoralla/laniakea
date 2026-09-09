// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createSeedDocument } from "./data/seed";
import { flowSpaceForNode } from "./model/spaces";
import { documentToMarkdown, parseMarkdownDocument } from "./model/markdown";
import { subspacePreview } from "./model/subspacePreview";
import { createBrowserDocument, loadActiveBrowserDocument } from "./persistence/browserDocumentStore";

describe("space creation through the editor", () => {
  let container: HTMLDivElement;
  let root: Root;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const query = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const press = async (target: Element, key: string, modifiers = {}) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...modifiers }));
      await settle();
    });
  };
  const click = async (selector: string) => {
    await act(async () => { query<HTMLElement>(selector).click(); await settle(); });
  };
  const type = async (selector: string, value: string) => {
    await act(async () => {
      const editor = query<HTMLTextAreaElement>(selector);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const doubleClick = async (target: Element, x = 600, y = 360) => {
    await act(async () => {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      await settle();
    });
  };
  const save = async () => {
    await press(query("[role='application']"), "s", { ctrlKey: true });
    return (await loadActiveBrowserDocument())!.document;
  };

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}),
    });
    localStorage.clear();
    sessionStorage.clear();
    await createBrowserDocument(createSeedDocument());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); await settle(); });
    await vi.waitFor(async () => {
      await act(settle);
      expect(query("[data-node-id='path'] .mind-node__content")).not.toBeNull();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("toggles the selected branch with Command-backslash and preserves content through save and reload", async () => {
    const before = documentToMarkdown((await loadActiveBrowserDocument())!.document);
    await click("[data-node-id='path'] .mind-node__content");
    await press(query(".mindmap-canvas"), "\\", { metaKey: true, code: "Backslash" });
    expect(query("[data-node-id='path-1']")).toBeNull();
    expect(query("[data-node-id='path'] .mind-node__content").getAttribute("aria-pressed")).toBe("true");
    const collapsed = await save();
    expect(collapsed.nodes.path.collapsed).toBe(true);
    expect(documentToMarkdown(collapsed)).toBe(before);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => { root.render(<App />); await settle(); });
    await vi.waitFor(async () => { await act(settle); expect(query("[data-node-id='path']")).not.toBeNull(); });
    expect(query("[data-node-id='path-1']")).toBeNull();
    await click("[data-node-id='path'] .mind-node__content");
    await press(query(".mindmap-canvas"), "\\", { metaKey: true, code: "Backslash" });
    expect(query("[data-node-id='path-1']")).not.toBeNull();

    // The key must not end an active edit or collapse its node.
    await doubleClick(query("[data-node-id='path'] .mind-node__content"));
    const editor = query("[aria-label='编辑节点']");
    await press(editor, "\\", { metaKey: true, code: "Backslash" });
    expect(query("[aria-label='编辑节点']")).toBe(editor);
    expect(query("[data-node-id='path-1']")).not.toBeNull();
    await press(editor, "Escape");

    // The previous shortcut remains available for existing users.
    await press(query(".mindmap-canvas"), "/", { metaKey: true });
    expect(query("[data-node-id='path-1']")).toBeNull();
    await press(query(".mindmap-canvas"), "\\", { metaKey: true });
    expect(query("[data-node-id='path-1']")).not.toBeNull();
    expect(documentToMarkdown(await save())).toBe(before);
  });

  it("starts Flow empty, creates independent ideas, updates only its summary, and reopens durable content", async () => {
    await click("[data-node-id='path'] .mind-node__content");
    await press(query(".mindmap-canvas"), "F10", { shiftKey: true });
    await click("[role='radio']:nth-child(2)");
    await click(".space-picker__create");
    await vi.waitFor(async () => { await act(settle); expect(query(".flow-canvas[role='application']")).not.toBeNull(); });
    expect(query(".flow-node")).toBeNull();
    expect(query("[aria-label='编辑流程步骤']")).toBeNull();
    const empty = await save();
    expect(flowSpaceForNode(empty, "path")!.nodes).toEqual({});
    expect(subspacePreview(flowSpaceForNode(empty, "path")!).text).toBe("暂无步骤");
    const roundTrip = parseMarkdownDocument(documentToMarkdown(empty), "flow");
    expect(roundTrip.canOverwriteSource).toBe(true);
    expect(Object.values(roundTrip.document.spaces!)[0]).toMatchObject({ nodes: {}, edges: [] });

    await doubleClick(query(".flow-canvas"));
    await type("[aria-label='编辑流程步骤']", "先捕捉想法");
    // Creating another idea while this editor is still open must commit its draft.
    await doubleClick(query(".flow-canvas"), 920, 550);
    await type("[aria-label='编辑流程步骤']", "之后再组织");
    await press(query("[aria-label='编辑流程步骤']"), "Enter");
    expect(container.querySelectorAll(".flow-node--step")).toHaveLength(2);
    let stored = await save();
    expect(stored.nodes.path.text).toBe("实现路径");
    expect(flowSpaceForNode(stored, "path")!.edges).toEqual([]);
    expect(Object.values(flowSpaceForNode(stored, "path")!.nodes).map(({ text }) => text)).toEqual(["先捕捉想法", "之后再组织"]);

    await press(query(".flow-canvas"), "Backspace");
    expect(container.querySelectorAll(".flow-node")).toHaveLength(1);
    await press(query(".flow-canvas"), "z", { ctrlKey: true });
    expect(container.querySelectorAll(".flow-node")).toHaveLength(2);
    await click("[aria-label='返回上层图']");
    expect(query(".subspace-portal").textContent).toContain("先捕捉想法");
    expect(query(".subspace-portal").textContent).not.toContain("实现路径");
    stored = await save();
    expect(stored.nodes.path.text).toBe("实现路径");

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => { root.render(<App />); await settle(); });
    await vi.waitFor(async () => { await act(settle); expect(query(".subspace-portal__content")).not.toBeNull(); });
    await doubleClick(query(".subspace-portal__content"));
    expect(container.querySelectorAll(".flow-node--step")).toHaveLength(2);
    expect(query(".flow-canvas").textContent).toContain("之后再组织");
    // Removing every step keeps the space (and parent) available for a fresh start.
    await click(".flow-node__content");
    await press(query(".flow-canvas"), "Backspace");
    await press(query(".flow-canvas"), "Backspace");
    expect(query(".flow-node")).toBeNull();
    const cleared = await save();
    expect(flowSpaceForNode(cleared, "path")!.nodes).toEqual({});
    expect(cleared.nodes.path.text).toBe("实现路径");
    await click("[aria-label='返回上层图']");
    expect(query(".subspace-portal").textContent).toContain("暂无步骤");
    await doubleClick(query(".subspace-portal__content"));
    // Re-entering an emptied flow, the keyboard alone starts the first step.
    await press(query(".flow-canvas"), "Enter");
    expect(container.querySelectorAll(".flow-node")).toHaveLength(1);
    expect(query("[aria-label='编辑流程步骤']")).not.toBeNull();
    await type("[aria-label='编辑流程步骤']", "重新开始");
    await press(query("[aria-label='编辑流程步骤']"), "Enter");
    const restarted = await save();
    expect(Object.values(flowSpaceForNode(restarted, "path")!.nodes).map(({ text }) => text)).toEqual(["重新开始"]);
  });

  it("keeps the Map center protected and summarizes only its direct children", async () => {
    await click("[data-node-id='path'] .mind-node__content");
    await press(query(".mindmap-canvas"), "F10", { shiftKey: true });
    await click(".space-picker__create");
    const center = query(".mind-node--root");
    const centerId = center.getAttribute("data-node-id")!;
    expect(center.textContent).toBe("实现路径");
    await press(query(".mindmap-canvas"), "Backspace");
    expect(query(".mind-node--root").getAttribute("data-node-id")).toBe(centerId);
    await press(query(".mindmap-canvas"), "Tab");
    await type("[aria-label='编辑节点']", "二级想法");
    await press(query("[aria-label='编辑节点']"), "Enter");
    await press(query(".mindmap-canvas"), "Tab");
    await type("[aria-label='编辑节点']", "更深细节");
    await press(query("[aria-label='编辑节点']"), "Enter");
    await click(`[data-node-id='${centerId}'] .mind-node__content`);
    await press(query(".mindmap-canvas"), "\\", { metaKey: true });
    expect(query(".mindmap-canvas").textContent).not.toContain("二级想法");
    await press(query(".mindmap-canvas"), "\\", { metaKey: true });
    expect(query(".mindmap-canvas").textContent).toContain("更深细节");
    await doubleClick(query(".mindmap-canvas"), 180, 210);
    await type("[aria-label='编辑节点']", "浮动想法");
    await press(query("[aria-label='编辑节点']"), "Enter");
    const stored = await save();
    const map = Object.values(stored.spaces!)[0];
    expect(map.type).toBe("map");
    if (map.type !== "map") throw new Error("expected Map");
    expect(map.nodes[map.rootId].text).toBe("实现路径");
    expect(map.nodes[map.floatingRoots[0].id].text).toBe("浮动想法");
    expect(map.nodes[map.floatingRoots[0].id].parentId).toBeNull();
    await click("[aria-label='返回上层图']");
    expect(query(".subspace-portal").textContent).toContain("二级想法");
    expect(query(".subspace-portal").textContent).not.toContain("实现路径");
    expect(query(".subspace-portal").textContent).not.toContain("更深细节");
    expect(query(".subspace-portal").textContent).not.toContain("浮动想法");
  });
});
