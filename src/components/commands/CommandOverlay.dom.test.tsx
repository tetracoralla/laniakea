// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("shows a bounded page and a route to the remaining matches", async () => {
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
      .toBe(`1–${overlayItemLimit} / ${overlayItemLimit + 3}`);
  });

  it("lets keyboard users reach repeated matches beyond the first page", async () => {
    const document = createSeedDocument();
    const base = document.nodes[document.rootId];
    document.nodes = Object.fromEntries(Array.from({ length: 28 }, (_, index) => {
      const id = `repeated-${index}`;
      return [id, { ...base, id, text: "待确认", parentId: null, children: [] }];
    }));
    document.rootId = "repeated-0";
    document.floatingRoots = Object.keys(document.nodes).slice(1).map((id) => ({ id, x: 0, y: 0 }));
    const onSelectNode = vi.fn();
    await act(async () => root.render(<CommandOverlay document={document} mode="search" onClose={() => undefined} onExecute={() => undefined} onSelectNode={onSelectNode} />));
    const input = container.querySelector("input")!;
    for (let i = 0; i < 24; i += 1) {
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    }
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelectNode).toHaveBeenCalledWith("repeated-24", undefined);
    expect(container.querySelectorAll("[role='option']").length).toBeLessThanOrEqual(overlayItemLimit);
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

  it("closes the current palette before executing a command that may replace it", async () => {
    const events: string[] = [];
    await act(async () => {
      root.render(
        <CommandOverlay
          document={createSeedDocument()}
          mode="commands"
          onClose={() => events.push("close")}
          onExecute={(id) => events.push(`execute:${id}`)}
          onSelectNode={() => undefined}
        />,
      );
    });
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "搜索节点");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchCommand = [
      ...container.querySelectorAll<HTMLButtonElement>("[role='option']"),
    ].find((item) => item.textContent?.includes("搜索节点"))!;

    await act(async () => searchCommand.click());

    expect(events).toEqual(["close", "execute:map.search"]);
  });

  it("shows only commands supported by the selected interaction target", async () => {
    await act(async () => {
      root.render(
        <CommandOverlay
          commandTarget="subspace-portal"
          document={createSeedDocument()}
          mode="commands"
          onClose={() => undefined}
          onExecute={() => undefined}
          onSelectNode={() => undefined}
        />,
      );
    });
    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>("[role='option']"),
    ].map((item) => item.textContent);

    expect(labels.some((label) => label?.includes("进入下层图"))).toBe(true);
    expect(labels.some((label) => label?.includes("删除下层图"))).toBe(true);
    expect(labels.some((label) => label?.includes("创建子节点"))).toBe(false);
    expect(labels.some((label) => label?.includes("创建父节点"))).toBe(false);
  });

  it("starts a replacement overlay with an empty query", async () => {
    const document = createSeedDocument();
    const render = (mode: "commands" | "search") => (
      <CommandOverlay
        document={document}
        mode={mode}
        onClose={() => undefined}
        onExecute={() => undefined}
        onSelectNode={() => undefined}
      />
    );
    await act(async () => root.render(render("commands")));
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "搜索节点");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("搜索节点");

    await act(async () => root.render(render("search")));

    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("");
  });

  it("closes with Escape from a focused result but ignores IME confirmation Enter", async () => {
    const onClose = vi.fn();
    const onExecute = vi.fn();
    await act(async () => {
      root.render(
        <CommandOverlay
          document={createSeedDocument()}
          mode="commands"
          onClose={onClose}
          onExecute={onExecute}
          onSelectNode={() => undefined}
        />,
      );
    });
    const input = container.querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        isComposing: true,
        key: "Enter",
      }));
    });
    expect(onExecute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const option = container.querySelector<HTMLButtonElement>("[role='option']")!;
    option.focus();
    await act(async () => {
      option.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
