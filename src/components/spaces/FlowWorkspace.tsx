import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useFlowKeyboardCommands } from "../../hooks/useFlowKeyboardCommands";
import {
  flowNavigationTarget,
  type FlowNavigationDirection,
} from "../../model/flowLayout";
import {
  addFlowBranch,
  addFlowStepAfter,
  connectFlowNodes,
  deleteFlowNode,
  setFlowEdgeLabel,
  setFlowNodeKind,
  setFlowNodeText,
} from "../../model/spaces";
import type { AppNotice } from "../../types/feedback";
import type {
  FlowNodeKind,
  FlowSpace,
  Viewport,
} from "../../types/mindmap";
import {
  FlowCanvas,
  type FlowCanvasHandle,
} from "../canvas/FlowCanvas";

export interface FlowWorkspaceHandle {
  fit: () => void;
  focusCanvas: () => void;
  flushViewport: () => void;
  selectedId: () => string | null;
}

interface FlowWorkspaceProps {
  entryRequest: number;
  fitOnMount: boolean;
  initialEditing: boolean;
  initialSelectedId: string | null;
  keyboardEnabled: boolean;
  notify: (notice: AppNotice) => void;
  onBack: () => void;
  onRedo: () => void;
  onUndo: () => void;
  onUpdateSpace: (space: FlowSpace) => void;
  onViewportChange: (viewport: Viewport) => void;
  space: FlowSpace;
}

export const FlowWorkspace = forwardRef<
  FlowWorkspaceHandle,
  FlowWorkspaceProps
>(function FlowWorkspace({
  entryRequest,
  fitOnMount,
  initialEditing,
  initialSelectedId,
  keyboardEnabled,
  notify,
  onBack,
  onRedo,
  onUndo,
  onUpdateSpace,
  onViewportChange,
  space,
}, ref) {
  const canvasRef = useRef<FlowCanvasHandle>(null);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const selectedIdRef = useRef(selectedId);
  const [editingId, setEditingId] = useState(
    initialEditing ? initialSelectedId : null,
  );
  const [draft, setDraft] = useState(
    initialEditing && initialSelectedId
      ? space.nodes[initialSelectedId]?.text ?? ""
      : "",
  );

  selectedIdRef.current = selectedId;
  // Mutations must compose on the latest applied space instead of a render
  // closure: two updates dispatched in the same event batch would otherwise
  // both start from the same base and the first edit would be lost.
  const appliedSpaceRef = useRef(space);
  if (appliedSpaceRef.current !== space) appliedSpaceRef.current = space;
  const editingIdRef = useRef<string | null>(editingId);

  useImperativeHandle(ref, () => ({
    fit: () => canvasRef.current?.fit(),
    focusCanvas: () => canvasRef.current?.focusCanvas(),
    flushViewport: () => canvasRef.current?.flushViewport(),
    selectedId: () => selectedIdRef.current,
  }), []);

  useEffect(() => {
    setSelectedId(initialSelectedId);
    setEditingId(initialEditing ? initialSelectedId : null);
    editingIdRef.current = initialEditing ? initialSelectedId : null;
    setDraft(
      initialEditing && initialSelectedId
        ? space.nodes[initialSelectedId]?.text ?? ""
        : "",
    );
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (fitOnMount) canvasRef.current?.fit();
        else canvasRef.current?.focusCanvas();
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [entryRequest, fitOnMount, initialEditing, initialSelectedId, space.id]);

  const applySpace = useCallback((next: FlowSpace) => {
    appliedSpaceRef.current = next;
    onUpdateSpace(next);
  }, [onUpdateSpace]);

  const beginEdit = useCallback((nodeId: string) => {
    const node = appliedSpaceRef.current.nodes[nodeId];
    if (!node) return;
    setSelectedId(nodeId);
    editingIdRef.current = nodeId;
    setEditingId(nodeId);
    setDraft(node.text);
  }, []);

  const cancelEdit = useCallback(() => {
    editingIdRef.current = null;
    setEditingId(null);
    setDraft("");
    window.requestAnimationFrame(() => canvasRef.current?.focusCanvas());
  }, []);

  const commitEdit = useCallback((nodeId: string, value: string) => {
    if (editingIdRef.current !== nodeId) return;
    editingIdRef.current = null;
    const current = appliedSpaceRef.current;
    if (!current.nodes[nodeId]) return;
    applySpace(setFlowNodeText(current, nodeId, value));
    setEditingId(null);
    setDraft("");
    window.requestAnimationFrame(() => canvasRef.current?.focusCanvas());
  }, [applySpace]);

  const addNext = useCallback((nodeId: string) => {
    const created = addFlowStepAfter(appliedSpaceRef.current, nodeId);
    if (created.space === appliedSpaceRef.current) return;
    applySpace(created.space);
    setSelectedId(created.nodeId);
    editingIdRef.current = created.nodeId;
    setEditingId(created.nodeId);
    setDraft("");
  }, [applySpace]);

  const addBranch = useCallback((nodeId: string) => {
    const created = addFlowBranch(appliedSpaceRef.current, nodeId);
    if (created.space === appliedSpaceRef.current) return;
    applySpace(created.space);
    setSelectedId(created.nodeId);
    editingIdRef.current = created.nodeId;
    setEditingId(created.nodeId);
    setDraft("");
  }, [applySpace]);

  const changeKind = useCallback((nodeId: string, kind: FlowNodeKind) => {
    applySpace(setFlowNodeKind(appliedSpaceRef.current, nodeId, kind));
  }, [applySpace]);

  const changeEdgeLabel = useCallback((edgeId: string, label: string) => {
    applySpace(setFlowEdgeLabel(appliedSpaceRef.current, edgeId, label));
  }, [applySpace]);

  const connect = useCallback((fromId: string, toId: string) => {
    const connected = connectFlowNodes(appliedSpaceRef.current, fromId, toId);
    if (connected === appliedSpaceRef.current) return;
    applySpace(connected);
    setSelectedId(toId);
  }, [applySpace]);

  const navigate = useCallback((direction: FlowNavigationDirection) => {
    if (!selectedId) return;
    const target = flowNavigationTarget(
      appliedSpaceRef.current,
      selectedId,
      direction,
    );
    if (target) setSelectedId(target);
  }, [selectedId]);

  const remove = useCallback((nodeId: string) => {
    const removed = deleteFlowNode(appliedSpaceRef.current, nodeId);
    if (removed.space === appliedSpaceRef.current) {
      notify({ message: "开始节点不能删除" });
      return;
    }
    applySpace(removed.space);
    setSelectedId(removed.nextSelectedId);
    setEditingId(null);
    editingIdRef.current = null;
    notify({
      message: "已删除流程步骤",
      actionLabel: "撤销",
      onAction: onUndo,
    });
  }, [applySpace, notify, onUndo]);

  useFlowKeyboardCommands({
    enabled: keyboardEnabled,
    selectedId,
    onAddNext: addNext,
    onAddBranch: addBranch,
    onBeginEdit: beginEdit,
    onDelete: remove,
    onNavigate: navigate,
    onBack,
    onUndo,
    onRedo,
  });

  return (
    <FlowCanvas
      draft={draft}
      editingId={editingId}
      onAddBranch={addBranch}
      onAddNext={addNext}
      onBeginEdit={beginEdit}
      onCancelEdit={cancelEdit}
      onChangeEdgeLabel={changeEdgeLabel}
      onChangeKind={changeKind}
      onCommitEdit={commitEdit}
      onConnect={connect}
      onDelete={remove}
      onDraftChange={setDraft}
      onSelect={setSelectedId}
      onViewportChange={onViewportChange}
      ref={canvasRef}
      selectedId={selectedId}
      space={space}
    />
  );
});
