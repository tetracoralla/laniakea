import type { MindMapDocument } from "../types/mindmap";
import {
  addFlowNodeAtPosition,
  createFlowSpace,
  flowSpaceForNode,
  setFlowNodeText,
} from "../model/spaces";

/** An existing, populated flow for editing/geometry tests; creation itself is empty. */
export function createFlowWithStep(
  document: MindMapDocument,
  anchorNodeId: string,
  text = "实现路径",
) {
  const created = createFlowSpace(document, anchorNodeId);
  const flow = flowSpaceForNode(created.document, anchorNodeId)!;
  const added = addFlowNodeAtPosition(flow, "step", { x: 140, y: 140 }, {});
  const { positions: _positions, ...populated } = setFlowNodeText(added.space, added.nodeId, text);
  return {
    document: {
      ...created.document,
      spaces: { ...created.document.spaces, [created.spaceId]: populated },
    },
    spaceId: created.spaceId,
    selectedFlowNodeId: added.nodeId,
  };
}
