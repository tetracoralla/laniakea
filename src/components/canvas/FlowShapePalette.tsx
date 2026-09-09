import { useLocale } from "../../i18n/useLocale";
import { t, localizeMessage } from "../../i18n/locale";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useDragInterruption } from "../../hooks/useDragInterruption";
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

interface PointerPoint {
  clientX: number;
  clientY: number;
  pointerId: number;
}

const shapes: Array<{ kind: PaletteKind; label: string }> = [
  { kind: "step", label: "步骤" },
  { kind: "decision", label: "判断" },
  { kind: "start", label: "起止" },
];

export function FlowShapePalette({ onDrop, onInsert }: FlowShapePaletteProps) {
  useLocale();
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

  const move = (event: PointerPoint) => {
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

  const finish = (event: PointerPoint) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    replaceDrag(null);
    if (current.moved) {
      suppressClickRef.current = true;
      onDrop(current.kind, { x: event.clientX, y: event.clientY });
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const cancel = () => replaceDrag(null);
  useDragInterruption({
    hasActiveDrag: () => dragRef.current !== null,
    onCancel: cancel,
  });
  useEffect(() => {
    if (!drag) return;
    const handlePointerMove = (event: PointerEvent) => move(event);
    const handlePointerUp = (event: PointerEvent) => finish(event);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag]);

  return (
    <>
      <div
        aria-label={t("图形栏")}
        className="flow-shape-palette"
        onPointerDown={(event) => event.stopPropagation()}
        role="toolbar"
      >
        {shapes.map(({ kind, label }) => (
          <button
            aria-label={t("添加{0}图形", localizeMessage(label))}
            className="flow-shape-palette__item"
            key={kind}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onInsert(kind);
            }}
            onPointerDown={(event) => begin(kind, event)}
            onPointerMove={move}
            onPointerUp={finish}
            type="button"
          >
            <span
              aria-hidden="true"
              className={`flow-shape-palette__shape flow-shape-palette__shape--${kind}`}
            />
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
