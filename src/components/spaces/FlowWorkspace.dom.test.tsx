// @vitest-environment jsdom

import {
  act,
  createRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedDocument } from "../../data/seed";
import {
  addFlowStepAfter,
  createFlowSpace,
  flowSpaceForNode,
} from "../../model/spaces";
import type { FlowSpace } from "../../types/mindmap";
import {
  FlowWorkspace,
  type FlowWorkspaceHandle,
} from "./FlowWorkspace";

describe("FlowWorkspace", () => {
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

  it("owns the flow edit sequence while committing updates through the document owner", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const updates: FlowSpace[] = [];

    function Harness() {
      const [space, setSpace] = useState(initial);
      return (
        <FlowWorkspace
          entryRequest={1}
          fitOnMount={false}
          initialEditing={false}
          initialSelectedId={created.selectedFlowNodeId}
          keyboardEnabled
          notify={() => undefined}
          onBack={() => undefined}
          onRedo={() => undefined}
          onUndo={() => undefined}
          onUpdateSpace={(next) => {
            updates.push(next);
            setSpace(next);
          }}
          onViewportChange={() => undefined}
          space={space}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].nodes)).toHaveLength(
      Object.keys(initial.nodes).length + 1,
    );
    expect(container.querySelector(".flow-node__editor")).not.toBeNull();
  });

  it("composes same-batch flow mutations without dropping the first edit", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const updates: FlowSpace[] = [];

    function Harness() {
      const [space, setSpace] = useState(initial);
      return (
        <FlowWorkspace
          entryRequest={1}
          fitOnMount={false}
          initialEditing={false}
          initialSelectedId={created.selectedFlowNodeId}
          keyboardEnabled
          notify={() => undefined}
          onBack={() => undefined}
          onRedo={() => undefined}
          onUndo={() => undefined}
          onUpdateSpace={(next) => {
            updates.push(next);
            setSpace(next);
          }}
          onViewportChange={() => undefined}
          space={space}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    // Both Enters land in one batch before a re-render. The second mutation
    // must compose on the first result instead of the stale render closure.
    const finalSpace = updates[updates.length - 1];
    expect(updates).toHaveLength(2);
    expect(Object.keys(finalSpace.nodes)).toHaveLength(
      Object.keys(initial.nodes).length + 2,
    );
  });

  it("accepts a new search-entry request without remounting the workspace", async () => {
    const created = createFlowSpace(createSeedDocument(), "path");
    const initial = flowSpaceForNode(created.document, "path")!;
    const added = addFlowStepAfter(initial, created.selectedFlowNodeId);
    const space = added.space;
    const endId = added.nodeId;
    const workspaceRef = createRef<FlowWorkspaceHandle>();
    const common = {
      fitOnMount: false,
      initialEditing: false,
      keyboardEnabled: false,
      notify: vi.fn(),
      onBack: vi.fn(),
      onRedo: vi.fn(),
      onUndo: vi.fn(),
      onUpdateSpace: vi.fn(),
      onViewportChange: vi.fn(),
      space,
    };

    await act(async () => {
      root.render(
        <FlowWorkspace
          {...common}
          entryRequest={1}
          initialSelectedId={created.selectedFlowNodeId}
          ref={workspaceRef}
        />,
      );
    });
    expect(workspaceRef.current?.selectedId()).toBe(created.selectedFlowNodeId);

    await act(async () => {
      root.render(
        <FlowWorkspace
          {...common}
          entryRequest={2}
          initialSelectedId={endId}
          ref={workspaceRef}
        />,
      );
    });
    expect(workspaceRef.current?.selectedId()).toBe(endId);
  });
});
