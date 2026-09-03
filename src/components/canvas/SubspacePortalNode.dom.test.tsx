// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode, MapSpace } from "../../types/mindmap";
import { SubspacePortalNode } from "./SubspacePortalNode";

const now = "2026-09-03T00:00:00.000Z";
const layout: LayoutNode = {
  id: "subspace:anchor",
  x: 320,
  y: 180,
  width: 240,
  height: 86,
  depth: 2,
  tone: "blue",
  rootKind: null,
};
const space: MapSpace = {
  id: "space",
  type: "map",
  anchorNodeId: "anchor",
  rootId: "root",
  nodes: {
    root: {
      id: "root",
      text: "主题",
      parentId: null,
      children: ["one", "two"],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
    one: {
      id: "one",
      text: "方向一",
      parentId: "root",
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
    two: {
      id: "two",
      text: "方向二",
      parentId: "root",
      children: [],
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
  },
  floatingRoots: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  updatedAt: now,
};

function pointerEvent(type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerId", { value: 7 });
  return event;
}

describe("SubspacePortalNode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelector("[data-node-id='target']")?.remove();
    vi.restoreAllMocks();
  });

  it("renders a selectable summary while keeping entry on the badge and double click", async () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <SubspacePortalNode
          anchorId="anchor"
          canMoveTo={() => true}
          layout={layout}
          onMove={() => undefined}
          onOpen={onOpen}
          onOpenContextMenu={() => undefined}
          onSelect={onSelect}
          selected={false}
          space={space}
          zoom={1}
        />,
      );
    });

    expect(container.textContent).toContain("方向一");
    expect(container.textContent).toContain("方向二");
    const summary = container.querySelector<HTMLButtonElement>(
      ".subspace-portal__content",
    )!;
    const badge = container.querySelector<HTMLButtonElement>(
      ".subspace-portal__open",
    )!;
    await act(async () => summary.click());
    expect(onSelect).toHaveBeenCalledWith("anchor");
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () =>
      summary.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    await act(async () => badge.click());
    expect(onOpen).toHaveBeenNthCalledWith(1, "anchor");
    expect(onOpen).toHaveBeenNthCalledWith(2, "anchor");
  });

  it("moves the whole subspace only after a valid drag target is reached", async () => {
    const onMove = vi.fn();
    const target = document.createElement("div");
    target.className = "mind-node";
    target.dataset.nodeId = "target";
    document.body.append(target);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });
    await act(async () => {
      root.render(
        <SubspacePortalNode
          anchorId="anchor"
          canMoveTo={(nodeId) => nodeId === "target"}
          layout={layout}
          onMove={onMove}
          onOpen={() => undefined}
          onOpenContextMenu={() => undefined}
          onSelect={() => undefined}
          selected
          space={space}
          zoom={1}
        />,
      );
    });
    const summary = container.querySelector<HTMLButtonElement>(
      ".subspace-portal__content",
    )!;
    await act(async () => {
      summary.dispatchEvent(pointerEvent("pointerdown", 330, 190));
      summary.dispatchEvent(pointerEvent("pointermove", 410, 240));
    });
    expect(target.classList.contains("is-portal-drop-target")).toBe(true);
    await act(async () =>
      summary.dispatchEvent(pointerEvent("pointerup", 410, 240)),
    );

    expect(onMove).toHaveBeenCalledWith("anchor", "target");
    expect(target.classList.contains("is-portal-drop-target")).toBe(false);
  });

  it("cancels an interrupted drag without mutating the document", async () => {
    const onMove = vi.fn();
    await act(async () => {
      root.render(
        <SubspacePortalNode
          anchorId="anchor"
          canMoveTo={() => true}
          layout={layout}
          onMove={onMove}
          onOpen={() => undefined}
          onOpenContextMenu={() => undefined}
          onSelect={() => undefined}
          selected
          space={space}
          zoom={1}
        />,
      );
    });
    const summary = container.querySelector<HTMLButtonElement>(
      ".subspace-portal__content",
    )!;
    await act(async () => {
      summary.dispatchEvent(pointerEvent("pointerdown", 330, 190));
      summary.dispatchEvent(pointerEvent("pointercancel", 410, 240));
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(container.querySelector(".is-dragging")).toBeNull();
  });

  it("cancels the active drag when Escape is pressed", async () => {
    const onMove = vi.fn();
    const target = document.createElement("div");
    target.className = "mind-node";
    target.dataset.nodeId = "target";
    document.body.append(target);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });
    await act(async () => {
      root.render(
        <SubspacePortalNode
          anchorId="anchor"
          canMoveTo={(nodeId) => nodeId === "target"}
          layout={layout}
          onMove={onMove}
          onOpen={() => undefined}
          onOpenContextMenu={() => undefined}
          onSelect={() => undefined}
          selected
          space={space}
          zoom={1}
        />,
      );
    });
    const summary = container.querySelector<HTMLButtonElement>(
      ".subspace-portal__content",
    )!;
    await act(async () => {
      summary.dispatchEvent(pointerEvent("pointerdown", 330, 190));
      summary.dispatchEvent(pointerEvent("pointermove", 410, 240));
    });
    expect(target.classList.contains("is-portal-drop-target")).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(container.querySelector(".is-dragging")).toBeNull();
    expect(target.classList.contains("is-portal-drop-target")).toBe(false);

    // A late pointer release after the escape must not commit a move.
    await act(async () =>
      summary.dispatchEvent(pointerEvent("pointerup", 410, 240)),
    );
    expect(onMove).not.toHaveBeenCalled();
  });
});
