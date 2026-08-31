import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FlowNodeKind } from "../../types/mindmap";

type PaletteKind = Extract<FlowNodeKind, "step" | "decision" | "start">;

interface FlowShapePaletteProps {
  onDrop: (kind: PaletteKind, clientPoint: { x: number; y: number }) => void;
  onInsert: (kind: PaletteKind) => void;
}

interface ShapeDrag {
  currentX: number;
  currentY: number;
  kind: PaletteKind;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
}

const shapes: Array<{ kind: PaletteKind; label: string }> = [
  { kind: "step", label: "步骤" },
  { kind: "decision", label: "判断" },
  { kind: "start", label: "起止" },
];

export function FlowShapePalette({ onDrop, onInsert }: FlowShapePaletteProps) {
  const [drag, setDrag] = useState<ShapeDrag | null>(null);
  const dragRef = useRef<ShapeDrag | null>(null);
  const suppressClickRef = useRef(false);

  const replaceDrag = (next: ShapeDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const begin = (kind: PaletteKind, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    replaceDrag({
      currentX: event.clientX,
      currentY: event.clientY,
      kind,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    });
  };

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const moved = current.moved || Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    ) >= 5;
    replaceDrag({
      ...current,
      currentX: event.clientX,
      currentY: event.clientY,
      moved,
    });
  };

  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    replaceDrag(null);
    if (current.moved) {
      suppressClickRef.current = true;
      onDrop(current.kind, { x: event.clientX, y: event.clientY });
    }
  };

  const cancel = () => replaceDrag(null);
  useEffect(() => {
    if (!drag) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", handleKey, { capture: true });
      window.removeEventListener("blur", cancel);
    };
  }, [drag]);

  return (
    <>
      <div
        aria-label="图形栏"
        className="flow-shape-palette"
        onPointerDown={(event) => event.stopPropagation()}
        role="toolbar"
      >
        {shapes.map(({ kind, label }) => (
          <button
            aria-label={`添加${label}图形`}
            className="flow-shape-palette__item"
            key={kind}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onInsert(kind);
            }}
            onLostPointerCapture={cancel}
            onPointerCancel={cancel}
            onPointerDown={(event) => begin(kind, event)}
            onPointerMove={move}
            onPointerUp={finish}
            title={`拖到画布添加${label}，点击放到视野中央`}
            type="button"
          >
            <span
              aria-hidden="true"
              className={`flow-shape-palette__shape flow-shape-palette__shape--${kind}`}
            />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {drag?.moved && (
        <div
          aria-hidden="true"
          className={`flow-shape-drag-ghost flow-shape-drag-ghost--${drag.kind}`}
          style={{ left: drag.currentX, top: drag.currentY }}
        />
      )}
    </>
  );
}
