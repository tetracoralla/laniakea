import {
  memo,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  flowConnectorPath,
  flowConnectorPoint,
  type FlowLayoutResult,
} from "../../model/flowLayout";
import type { FlowEdge } from "../../types/mindmap";

interface FlowEdgeLayerProps {
  edges: readonly FlowEdge[];
  layout: FlowLayoutResult;
  onChangeLabel: (edgeId: string, label: string) => void;
  spaceId: string;
}

export const FlowEdgeLayer = memo(function FlowEdgeLayer({
  edges,
  layout,
  onChangeLabel,
  spaceId,
}: FlowEdgeLayerProps) {
  const editorRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const editFinishedByKeyRef = useRef(false);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!editingEdgeId) return;
    editFinishedByKeyRef.current = false;
    editorRef.current?.focus({ preventScroll: true });
    editorRef.current?.select();
  }, [editingEdgeId]);

  useEffect(() => {
    if (editingEdgeId && !edges.some((edge) => edge.id === editingEdgeId)) {
      setEditingEdgeId(null);
      setDraft("");
    }
  }, [edges, editingEdgeId]);

  const beginEdit = (edge: FlowEdge) => {
    editFinishedByKeyRef.current = false;
    setEditingEdgeId(edge.id);
    setDraft(edge.label);
  };

  const finishEdit = () => {
    setEditingEdgeId(null);
    setDraft("");
  };

  return (
    <>
      <svg
        aria-hidden="true"
        className="flow-connectors"
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
      >
        <defs>
          <marker
            id={`flow-arrow-${spaceId}`}
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
          >
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = layout.nodes[edge.from];
          const to = layout.nodes[edge.to];
          if (!from || !to) return null;
          const path = flowConnectorPath(from, to);
          return (
            <g key={edge.id}>
              <path
                className="flow-connector"
                d={path}
                markerEnd={`url(#flow-arrow-${spaceId})`}
              />
              <path
                className="flow-connector__hit"
                d={path}
                onDoubleClick={() => beginEdit(edge)}
              />
            </g>
          );
        })}
      </svg>

      {edges.map((edge) => {
        const from = layout.nodes[edge.from];
        const to = layout.nodes[edge.to];
        if (!from || !to || (!edge.label && editingEdgeId !== edge.id)) {
          return null;
        }
        const point = flowConnectorPoint(from, to);
        return editingEdgeId === edge.id ? (
          <input
            aria-label="编辑分支名称"
            className="flow-edge-label flow-edge-label__editor"
            key={edge.id}
            onBlur={(event) => {
              if (!composingRef.current && !editFinishedByKeyRef.current) {
                onChangeLabel(edge.id, event.currentTarget.value);
                finishEdit();
              }
            }}
            onChange={(event) => {
              if (!composingRef.current) setDraft(event.target.value);
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              setDraft(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (composingRef.current || event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                editFinishedByKeyRef.current = true;
                onChangeLabel(edge.id, event.currentTarget.value);
                finishEdit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                editFinishedByKeyRef.current = true;
                finishEdit();
              }
            }}
            ref={editorRef}
            style={{ left: point.x, top: point.y }}
            value={draft}
          />
        ) : (
          <button
            aria-label={`编辑分支名称：${edge.label}`}
            className="flow-edge-label"
            key={edge.id}
            onClick={() => beginEdit(edge)}
            style={{ left: point.x, top: point.y }}
            title="编辑分支名称"
            type="button"
          >
            {edge.label}
          </button>
        );
      })}
    </>
  );
});
