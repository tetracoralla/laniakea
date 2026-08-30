import { useEffect, useId, useRef, useState } from "react";
import { trapDialogTab } from "../overlays/focus";
import { Icon } from "../icons/Icon";

export type SpaceTypeChoice = "map" | "flow";

interface SpacePickerProps {
  onCreate: (type: SpaceTypeChoice) => void;
  onClose: () => void;
  onTypeIntent?: (type: SpaceTypeChoice) => void;
}

export function SpacePicker({
  onCreate,
  onClose,
  onTypeIntent = () => undefined,
}: SpacePickerProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const secondChoiceRef = useRef<HTMLButtonElement>(null);
  const [selectedType, setSelectedType] = useState<SpaceTypeChoice>("map");

  useEffect(() => {
    firstChoiceRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="space-picker-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="space-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          trapDialogTab(event, dialogRef);
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header className="space-picker__header">
          <h2 id={titleId}>选择下层图类型</h2>
          <button
            aria-label="关闭下钻选择"
            className="space-picker__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div
          aria-label="下层图类型"
          className="space-picker__choices"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const nextType = selectedType === "map" ? "flow" : "map";
            onTypeIntent(nextType);
            setSelectedType(nextType);
            (nextType === "map" ? firstChoiceRef : secondChoiceRef)
              .current
              ?.focus();
          }}
          role="radiogroup"
        >
          <button
            aria-checked={selectedType === "map"}
            className={selectedType === "map" ? "is-selected" : ""}
            onClick={() => setSelectedType("map")}
            onDoubleClick={() => onCreate("map")}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onCreate("map");
            }}
            ref={firstChoiceRef}
            role="radio"
            type="button"
          >
            <span className="space-picker__choice-state" aria-hidden="true">
              <Icon name="check" size={15} />
            </span>
            <span className="space-picker__choice-icon" aria-hidden="true">
              <Icon name="mindMap" size={84} />
            </span>
            <span className="space-picker__choice-copy">
              <strong>思维图</strong>
              <small>打开一张独立画布，以当前主题为中心继续拆解。</small>
            </span>
          </button>
          <button
            aria-checked={selectedType === "flow"}
            className={selectedType === "flow" ? "is-selected" : ""}
            onClick={() => {
              onTypeIntent("flow");
              setSelectedType("flow");
            }}
            onDoubleClick={() => onCreate("flow")}
            onFocus={() => onTypeIntent("flow")}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onCreate("flow");
            }}
            onPointerEnter={() => onTypeIntent("flow")}
            ref={secondChoiceRef}
            role="radio"
            type="button"
          >
            <span className="space-picker__choice-state" aria-hidden="true">
              <Icon name="check" size={15} />
            </span>
            <span className="space-picker__choice-icon" aria-hidden="true">
              <Icon name="flowChart" size={84} />
            </span>
            <span className="space-picker__choice-copy">
              <strong>流程</strong>
              <small>打开一张流程画布，组织步骤、判断与分支。</small>
            </span>
          </button>
        </div>
        <footer className="space-picker__footer">
          <button className="space-picker__cancel" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="space-picker__create"
            onClick={() => {
              onTypeIntent(selectedType);
              onCreate(selectedType);
            }}
            type="button"
          >
            创建{selectedType === "map" ? "思维图" : "流程"}
          </button>
        </footer>
      </section>
    </div>
  );
}
