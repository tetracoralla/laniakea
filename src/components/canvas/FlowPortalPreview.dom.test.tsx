// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../../data/seed";
import {
  addFlowNodeAfter,
  createFlowSpace,
  flowSpaceForNode,
  setFlowNodeText,
} from "../../model/spaces";
import { FlowPortalPreview } from "./FlowPortalPreview";

describe("FlowPortalPreview", () => {
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

  it("shows a weak whole-flow summary and opens the full drill-down surface", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    let space = flowSpaceForNode(created.document, "path")!;
    const labels = ["确认目标", "准备资料", "执行方案", "复盘结果"];
    let currentId = created.selectedFlowNodeId;
    space = setFlowNodeText(space, currentId, labels[0]);
    labels.slice(1).forEach((label) => {
      const next = addFlowNodeAfter(space, currentId, "step");
      space = setFlowNodeText(next.space, next.nodeId, label);
      currentId = next.nodeId;
    });
    const onOpen = vi.fn();

    await act(async () => {
      root.render(<FlowPortalPreview onOpen={onOpen} space={space} />);
    });

    const preview = container.querySelector<HTMLButtonElement>(
      ".flow-portal-preview",
    )!;
    expect(preview.textContent).toContain("确认目标");
    expect(preview.textContent).toContain("…");
    expect(preview.textContent).toContain("复盘结果");
    expect(preview.textContent).toContain("4 步");
    expect(preview.textContent).not.toContain("准备资料");
    await act(async () => preview.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("never draws sequence arrows between nodes that have no real edges", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    let space = flowSpaceForNode(created.document, "path")!;
    const labels = ["独立甲", "独立乙", "独立丙"];
    let currentId = created.selectedFlowNodeId;
    labels.forEach((label, index) => {
      if (index > 0) {
        const next = addFlowNodeAfter(space, currentId, "step");
        space = next.space;
        currentId = next.nodeId;
      }
      space = setFlowNodeText(space, currentId, label);
    });
    // 三个步骤之间没有创建任何连线：用无边空间表达这种断开的草稿。
    const edgelessSpace = { ...space, edges: [] };

    await act(async () => {
      root.render(
        <FlowPortalPreview onOpen={vi.fn()} space={edgelessSpace} />,
      );
    });

    const preview = container.querySelector<HTMLButtonElement>(
      ".flow-portal-preview",
    )!;
    expect(preview.textContent).toContain("独立甲");
    expect(preview.textContent).toContain("·");
    expect(preview.textContent).not.toContain("→");
  });
});
