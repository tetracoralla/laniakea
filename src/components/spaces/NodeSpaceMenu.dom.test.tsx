// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapSpace } from "../../types/mindmap";
import { NodeSpaceMenu } from "./NodeSpaceMenu";

const mapSpace: MapSpace = {
  id: "map-space",
  type: "map",
  anchorNodeId: "anchor",
  rootId: "map-root",
  nodes: {
    "map-root": {
      id: "map-root",
      text: "主题",
      parentId: null,
      children: [],
      collapsed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  floatingRoots: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("NodeSpaceMenu", () => {
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

  it("offers only the drill-down invocation before a Space exists", async () => {
    const onClose = vi.fn();
    const onDrillDown = vi.fn();
    await act(async () => {
      root.render(
        <NodeSpaceMenu
          nodeLabel="购买路径"
          onClose={onClose}
          onDelete={() => undefined}
          onDrillDown={onDrillDown}
          onEnter={() => undefined}
          targetRect={{ left: 20, right: 160, top: 30, bottom: 74 }}
          space={null}
        />,
      );
    });

    const items = [...container.querySelectorAll("[role='menuitem']")];
    expect(items.map((item) => item.textContent)).toEqual(["下钻为…"]);
    await act(async () => (items[0] as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledWith(false);
    expect(onDrillDown).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLElement>("[role='menu']")!.style.left)
      .toBe("170px");
  });

  it("offers only enter or delete after the Space type exists", async () => {
    await act(async () => {
      root.render(
        <NodeSpaceMenu
          nodeLabel="购买路径"
          onClose={() => undefined}
          onDelete={() => undefined}
          onDrillDown={() => undefined}
          onEnter={() => undefined}
          targetRect={{ left: 20, right: 160, top: 760, bottom: 804 }}
          space={mapSpace}
        />,
      );
    });

    const labels = [...container.querySelectorAll("[role='menuitem']")].map(
      (item) => item.textContent,
    );
    expect(labels).toEqual(["进入思维图", "删除下层图"]);
    expect(
      Number(container.querySelector<HTMLElement>("[role='menu']")!.style.top.replace("px", "")),
    ).toBeLessThanOrEqual(window.innerHeight - 93 - 12);
  });

  it("dismisses on outside pointer and restores focus only for Escape", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <NodeSpaceMenu
          nodeLabel="购买路径"
          onClose={onClose}
          onDelete={() => undefined}
          onDrillDown={() => undefined}
          onEnter={() => undefined}
          targetRect={{ left: 20, right: 160, top: 30, bottom: 74 }}
          space={null}
        />,
      );
    });

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledWith(false);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenLastCalledWith(true);
  });
});
