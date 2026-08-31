// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeedDocument } from "../../data/seed";
import { CommandOverlay, overlayItemLimit } from "./CommandOverlay";

describe("CommandOverlay result limits", () => {
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

  it("states when matching nodes exceed the rendered result limit", async () => {
    const document = createSeedDocument();
    const now = "2026-08-27T00:00:00.000Z";
    document.nodes = Object.fromEntries(
      Array.from({ length: overlayItemLimit + 3 }, (_, index) => {
        const id = `node-${index}`;
        return [id, {
          id,
          text: `结果 ${index + 1}`,
          parentId: null,
          children: [],
          collapsed: false,
          createdAt: now,
          updatedAt: now,
        }];
      }),
    );
    document.rootId = "node-0";
    document.floatingRoots = Object.keys(document.nodes).slice(1).map((id) => ({
      id,
      x: 0,
      y: 0,
    }));

    await act(async () => {
      root.render(
        <CommandOverlay
          document={document}
          mode="search"
          onClose={() => undefined}
          onExecute={() => undefined}
          onSelectNode={() => undefined}
        />,
      );
    });

    expect(container.querySelectorAll("[role='option']")).toHaveLength(
      overlayItemLimit,
    );
    expect(container.querySelector("[role='status']")?.textContent)
      .toBe(`显示前 ${overlayItemLimit} 条，共 ${overlayItemLimit + 3} 条`);
  });

  it("shows a nested result's ancestor trail instead of a flat list", async () => {
    const document = createSeedDocument();

    await act(async () => {
      root.render(
        <CommandOverlay
          document={document}
          mode="search"
          onClose={() => undefined}
          onExecute={() => undefined}
          onSelectNode={() => undefined}
        />,
      );
    });

    const options = [
      ...container.querySelectorAll<HTMLButtonElement>("[role='option']"),
    ];
    const nested = options.find((option) =>
      option.textContent?.includes("接到新需求"),
    );
    expect(nested?.textContent).toContain("使用场景");
    const branch = options.find((option) =>
      option.textContent?.includes("使用场景") &&
      option !== nested,
    );
    expect(branch?.textContent).toContain("3 个子节点");
  });
});
