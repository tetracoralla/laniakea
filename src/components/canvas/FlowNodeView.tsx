import {
  memo,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FlowLayoutNode } from "../../model/flowLayout";
import type {
  FlowNode,
  FlowNodeKind,
  FlowPlacementDirection,
} from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface FlowNodeViewProps {
  draft: string;
  editing: boolean;
  node: FlowNode;
  canStartConnection: boolean;
  connectableTarget: boolean;
  connectionTarget: boolean;
  connectionTargetPort: FlowPlacementDirection | null;
  connectingSource: boolean;
  onAddNode: (
    id: string,
    kind: Extract<FlowNodeKind, "step" | "decision">,
    direction: FlowPlacementDirection,
  ) => void;
  onBeginEdit: (id: string) => void;
  onCancelEdit: () => void;
  onCommitEdit: (id: string, value: string) => void;
  onDraftChange: (value: string) => void;
  onOpenMenu: (
    nodeId: string,
    targetRect: { left: number; right: number; top: number; bottom: number },
    returnFocus: HTMLElement,
  ) => void;
  onConnectPointerDown: (
    id: string,
    port: FlowPlacementDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onNodePointerDown: (
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPortClick: (id: string, port: FlowPlacementDirection) => void;
  onSelect: (id: string) => void;
  position: FlowLayoutNode;
  selected: boolean;
}

export const FlowNodeView = memo(function FlowNodeView({
  draft,
  editing,
  node,
  canStartConnection,
  connectableTarget,
  connectionTarget,
  connectionTargetPort,
  connectingSource,
  onAddNode,
  onBeginEdit,
  onCancelEdit,
  onCommitEdit,
  onDraftChange,
  onOpenMenu,
  onConnectPointerDown,
  onNodePointerDown,
  onPortClick,
  onSelect,
  position,
  selected,
}: FlowNodeViewProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const editFinishedByKeyRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    editFinishedByKeyRef.current = false;
    editorRef.current?.focus({ preventScroll: true });
    editorRef.current?.select();
  }, [editing]);

  return (
    <div
      className={`flow-node flow-node--${node.kind}${selected ? " is-selected" : ""}${connectableTarget ? " is-connectable-target" : ""}${connectionTarget ? " is-connection-target" : ""}${connectingSource ? " is-connecting-source" : ""}`}
      data-connection-target-port={connectionTargetPort ?? undefined}
      data-flow-node-id={node.id}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        onOpenMenu(
          node.id,
          {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          },
          event.currentTarget.querySelector<HTMLElement>(
            ".flow-node__content",
          ) ?? event.currentTarget,
        );
      }}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
      }}
    >
      {node.kind === "decision" && (
        <svg
          aria-hidden="true"
          className="flow-node__decision-shape"
          viewBox={`0 0 ${position.width} ${position.height}`}
        >
          <polygon
            points={`${position.width / 2},1 ${position.width - 1},${position.height / 2} ${position.width / 2},${position.height - 1} 1,${position.height / 2}`}
          />
        </svg>
      )}
      {editing ? (
        <textarea
          aria-label="编辑流程步骤"
          className="flow-node__editor"
          defaultValue={draft}
          ref={editorRef}
          rows={1}
          onBlur={(event) => {
            if (!composingRef.current && !editFinishedByKeyRef.current) {
              onCommitEdit(node.id, event.currentTarget.value);
            }
          }}
          onChange={(event) => {
            if (!composingRef.current) onDraftChange(event.target.value);
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            onDraftChange(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (composingRef.current || event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              editFinishedByKeyRef.current = true;
              onCommitEdit(node.id, event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              editFinishedByKeyRef.current = true;
              onCancelEdit();
            }
          }}
        />
      ) : (
        <button
          aria-pressed={selected}
          className="flow-node__content"
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => onBeginEdit(node.id)}
          onPointerDown={(event) => onNodePointerDown(node.id, event)}
          type="button"
        >
          {node.text || (node.kind === "start" || node.kind === "end" ? "输入文字" : "输入步骤")}
        </button>
      )}
      {!editing && (
        <div aria-label="从节点方向创建或连接" className="flow-node__ports">
          {(["up", "right", "down", "left"] as const).map((port) => (
            <button
              aria-label={`从${port === "up" ? "上方" : port === "right" ? "右侧" : port === "down" ? "下方" : "左侧"}创建或拖线`}
              className={`flow-node__port flow-node__port--${port}`}
              key={port}
              onClick={(event) => {
                event.stopPropagation();
                onPortClick(node.id, port);
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onConnectPointerDown(node.id, port, event);
              }}
              title="点击创建步骤，拖动连接已有节点"
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {selected && !editing && (
        <>
          <div
            aria-label="快速添加流程节点"
            className="flow-node__quick-actions"
            onPointerDown={(event) => event.stopPropagation()}
            role="group"
          >
            <button
              aria-label="添加步骤"
              onClick={() => onAddNode(node.id, "step", "right")}
              title="添加步骤"
              type="button"
            >
              <span aria-hidden="true" className="flow-node__quick-shape flow-node__quick-shape--step" />
            </button>
            <button
              aria-label="添加判断"
              onClick={() => onAddNode(node.id, "decision", "right")}
              title="添加判断"
              type="button"
            >
              <span aria-hidden="true" className="flow-node__quick-shape flow-node__quick-shape--decision" />
            </button>
            {canStartConnection && (
              <button
                aria-label="拖动连线"
                className="flow-node__quick-connect"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onConnectPointerDown(node.id, "right", event);
                }}
                title="拖动到已有节点以连接"
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            )}
            <button
              aria-label="更多流程操作"
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onOpenMenu(node.id, bounds, event.currentTarget);
              }}
              title="更多"
              type="button"
            >
              <Icon name="more" size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  );
});
