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
  addFlowNodeAtPosition,
  addFlowNodeInDirection,
  addFlowStepAfter,
  connectFlowNodes,
  deleteFlowEdge,
  deleteFlowNode,
  reconnectFlowEdge,
  setFlowEdgeLabel,
  setFlowNodeKind,
  setFlowNodeText,
} from "../../model/spaces";
import type { AppNotice } from "../../types/feedback";
import type {
  FlowNodeKind,
  FlowNodePosition,
  FlowPlacementDirection,
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
  finishEditing: () => void;
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
  onEditorDraftChange?: (
    target: {
      objectId: string;
      objectKind: "flow-node" | "flow-edge";
    },
    value: string,
  ) => void;
  onEditorDraftFinish?: (cancelled: boolean) => void;
  onUndo: () => void;
  onUpdateSpace: (space: FlowSpace) => void;
  onPositionsChange?: (positions: Record<string, FlowNodePosition>) => void;
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
  onEditorDraftChange = () => undefined,
  onEditorDraftFinish = () => undefined,
  onUndo,
  onUpdateSpace,
  onPositionsChange = () => undefined,
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
    onEditorDraftFinish(true);
    window.requestAnimationFrame(() => canvasRef.current?.focusCanvas());
  }, [onEditorDraftFinish]);

  const commitEdit = useCallback((nodeId: string, value: string) => {
    if (editingIdRef.current !== nodeId) return;
    editingIdRef.current = null;
    const current = appliedSpaceRef.current;
    if (!current.nodes[nodeId]) return;
    applySpace(setFlowNodeText(current, nodeId, value));
    setEditingId(null);
    setDraft("");
    onEditorDraftFinish(false);
    window.requestAnimationFrame(() => canvasRef.current?.focusCanvas());
  }, [applySpace, onEditorDraftFinish]);

  const changeDraft = useCallback((value: string) => {
    setDraft(value);
    const nodeId = editingIdRef.current;
    if (!nodeId) return;
    onEditorDraftChange({
      objectId: nodeId,
      objectKind: "flow-node",
    }, value);
  }, [onEditorDraftChange]);

  useImperativeHandle(ref, () => ({
    fit: () => canvasRef.current?.fit(),
    focusCanvas: () => canvasRef.current?.focusCanvas(),
    finishEditing: () => {
      const nodeId = editingIdRef.current;
      if (nodeId) commitEdit(nodeId, draft);
    },
    flushViewport: () => canvasRef.current?.flushViewport(),
    selectedId: () => selectedIdRef.current,
  }), [commitEdit, draft]);

  const addNext = useCallback((nodeId: string) => {
    const created = addFlowStepAfter(appliedSpaceRef.current, nodeId);
    if (created.space === appliedSpaceRef.current) return;
    applySpace(created.space);
    setSelectedId(created.nodeId);
    editingIdRef.current = created.nodeId;
    setEditingId(created.nodeId);
    setDraft("");
  }, [applySpace]);

  const addNode = useCallback((
    nodeId: string,
    kind: Extract<FlowNodeKind, "step" | "decision">,
    direction: FlowPlacementDirection,
    currentPositions: Record<string, FlowNodePosition>,
  ) => {
    const created = addFlowNodeInDirection(
      appliedSpaceRef.current,
      nodeId,
      kind,
      direction,
      currentPositions,
    );
    if (created.space === appliedSpaceRef.current) return;
    applySpace(created.space);
    setSelectedId(created.nodeId);
    editingIdRef.current = created.nodeId;
    setEditingId(created.nodeId);
    setDraft("");
  }, [applySpace]);

  const addShape = useCallback((
    kind: FlowNodeKind,
    position: FlowNodePosition,
    currentPositions: Record<string, FlowNodePosition>,
  ) => {
    const created = addFlowNodeAtPosition(
      appliedSpaceRef.current,
      kind,
      position,
      currentPositions,
    );
    if (created.space === appliedSpaceRef.current || !created.nodeId) return;
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

  const connect = useCallback((
    fromId: string,
    toId: string,
    ports?: {
      fromPort?: FlowPlacementDirection;
      toPort?: FlowPlacementDirection;
    },
  ) => {
    const connected = connectFlowNodes(
      appliedSpaceRef.current,
      fromId,
      toId,
      ports,
    );
    if (connected === appliedSpaceRef.current) return;
    applySpace(connected);
    setSelectedId(toId);
  }, [applySpace]);

  const reconnectEdge = useCallback((
    edgeId: string,
    endpoint: "from" | "to",
    nodeId: string,
    port: FlowPlacementDirection,
  ) => {
    const reconnected = reconnectFlowEdge(
      appliedSpaceRef.current,
      edgeId,
      endpoint,
      nodeId,
      port,
    );
    if (reconnected !== appliedSpaceRef.current) applySpace(reconnected);
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
    if (removed.space === appliedSpaceRef.current) return;
    applySpace(removed.space);
    setSelectedId(removed.nextSelectedId);
    setEditingId(null);
    editingIdRef.current = null;
    onEditorDraftFinish(true);
    notify({
      message: "已删除流程步骤",
      actionLabel: "撤销",
      onAction: onUndo,
    });
  }, [applySpace, notify, onEditorDraftFinish, onUndo]);

  const removeEdge = useCallback((edgeId: string) => {
    const next = deleteFlowEdge(appliedSpaceRef.current, edgeId);
    if (next === appliedSpaceRef.current) return;
    applySpace(next);
    notify({
      message: "已删除连线",
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
      onAddNode={addNode}
      onAddShape={addShape}
      onAddNext={addNext}
      onBeginEdit={beginEdit}
      onCancelEdit={cancelEdit}
      onChangeEdgeLabel={changeEdgeLabel}
      onChangeKind={changeKind}
      onCommitEdit={commitEdit}
      onConnect={connect}
      onDelete={remove}
      onDeleteEdge={removeEdge}
      onDraftChange={changeDraft}
      onEdgeDraftChange={(edgeId, value) =>
        onEditorDraftChange({
          objectId: edgeId,
          objectKind: "flow-edge",
        }, value)
      }
      onEdgeDraftFinish={onEditorDraftFinish}
      onSelect={setSelectedId}
      onPositionsChange={onPositionsChange}
      onReconnectEdge={reconnectEdge}
      onViewportChange={onViewportChange}
      ref={canvasRef}
      selectedId={selectedId}
      space={space}
    />
  );
});
