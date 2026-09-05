import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  FlowConnectorDash,
  FlowConnectorEndpoint,
  FlowConnectorKind,
  FlowConnectorTone,
  FlowConnectorWeight,
  FlowEdge,
  FlowEdgeStyle,
} from "../../types/mindmap";
import { Icon } from "../icons/Icon";

interface FlowEdgeToolbarProps {
  anchor: { x: number; y: number };
  edge: FlowEdge;
  hasManualRoute: boolean;
  onBeginLabel: () => void;
  onChangeStyle: (patch: Partial<FlowEdgeStyle>) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onResetRoute: () => void;
  zoom: number;
}

const kindOptions: Array<{ label: string; value: FlowConnectorKind }> = [
  { label: "圆角折线", value: "rounded" },
  { label: "直角折线", value: "orthogonal" },
  { label: "直线", value: "straight" },
  { label: "曲线", value: "curved" },
];
const dashOptions: Array<{ label: string; value: FlowConnectorDash }> = [
  { label: "实线", value: "solid" },
  { label: "虚线", value: "dashed" },
  { label: "点线", value: "dotted" },
];
const weightOptions: Array<{ label: string; value: FlowConnectorWeight }> = [
  { label: "细", value: "thin" },
  { label: "标准", value: "regular" },
  { label: "粗", value: "bold" },
];
const endpointOptions: Array<{ label: string; value: FlowConnectorEndpoint }> = [
  { label: "无", value: "none" },
  { label: "箭头", value: "arrow" },
  { label: "实心点", value: "dot" },
  { label: "圆环", value: "ring" },
];
const toneOptions: Array<{ label: string; value: FlowConnectorTone }> = [
  { label: "中性", value: "neutral" },
  { label: "紫色", value: "violet" },
  { label: "蓝色", value: "blue" },
  { label: "绿色", value: "emerald" },
  { label: "琥珀", value: "amber" },
];

function ChoiceGroup<T extends string>({
  current,
  label,
  onChange,
  options,
}: {
  current: T;
  label: string;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
}) {
  return (
    <div className="flow-edge-style-panel__row">
      <span>{label}</span>
      <div aria-label={label} role="group">
        {options.map((option) => (
          <button
            aria-label={option.label}
            aria-pressed={current === option.value}
            className={`flow-edge-style-choice flow-edge-style-choice--${option.value}`}
            key={option.value}
            onClick={() => onChange(option.value)}
            title={option.label}
            type="button"
          >
            <i aria-hidden="true" />
            <b>{option.label}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

export function FlowEdgeToolbar({
  anchor,
  edge,
  hasManualRoute,
  onBeginLabel,
  onChangeStyle,
  onDelete,
  onDeselect,
  onResetRoute,
  zoom,
}: FlowEdgeToolbarProps) {
  const [open, setOpen] = useState(false);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const style = edge.style ?? {};

  useEffect(() => setOpen(false), [edge.id]);

  return (
    <div
      className="flow-edge-toolbar-anchor"
      style={{
        "--flow-edge-toolbar-offset": `${18 / zoom}px`,
        left: anchor.x,
        top: anchor.y,
      } as CSSProperties}
    >
      <div
        className="flow-edge-toolbar-shell"
        data-flow-edge-toolbar="true"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (open) {
            setOpen(false);
            window.requestAnimationFrame(() => styleButtonRef.current?.focus());
          } else {
            onDeselect();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          "--flow-edge-toolbar-scale": 1 / zoom,
        } as CSSProperties}
      >
        <div aria-label="连线操作" className="flow-edge-toolbar" role="toolbar">
          <button
            aria-expanded={open}
            aria-label="调整连线样式"
            className={open ? "is-active" : ""}
            onClick={() => setOpen((current) => !current)}
            ref={styleButtonRef}
            title="线条、端点与颜色"
            type="button"
          >
            <span aria-hidden="true" className="flow-edge-toolbar__line-icon" />
          </button>
          <button
            aria-label={edge.label ? "编辑连线文字" : "添加连线文字"}
            onClick={onBeginLabel}
            title={edge.label ? "编辑文字" : "添加文字"}
            type="button"
          >
            <Icon aria-hidden="true" name="text" size={15} />
          </button>
          <button
            aria-label="删除连线"
            className="flow-edge-toolbar__delete"
            onClick={onDelete}
            title="删除连线（Delete）"
            type="button"
          >
            <Icon aria-hidden="true" name="trash" size={15} />
          </button>
        </div>

        {open && (
          <div
            aria-label="连线样式"
            className="flow-edge-style-panel"
            role="group"
          >
            <ChoiceGroup
              current={style.kind ?? "rounded"}
              label="线型"
              onChange={(kind) => onChangeStyle({ kind })}
              options={kindOptions}
            />
            <ChoiceGroup
              current={style.dash ?? "solid"}
              label="线条"
              onChange={(dash) => onChangeStyle({ dash })}
              options={dashOptions}
            />
            <ChoiceGroup
              current={style.weight ?? "regular"}
              label="线宽"
              onChange={(weight) => onChangeStyle({ weight })}
              options={weightOptions}
            />
            <ChoiceGroup
              current={style.sourceEndpoint ?? "none"}
              label="起点"
              onChange={(sourceEndpoint) => onChangeStyle({ sourceEndpoint })}
              options={endpointOptions}
            />
            <ChoiceGroup
              current={style.targetEndpoint ?? "arrow"}
              label="终点"
              onChange={(targetEndpoint) => onChangeStyle({ targetEndpoint })}
              options={endpointOptions}
            />
            <ChoiceGroup
              current={style.tone ?? "neutral"}
              label="颜色"
              onChange={(tone) => onChangeStyle({ tone })}
              options={toneOptions}
            />
            {hasManualRoute && (
              <button
                className="flow-edge-style-panel__reset"
                onClick={onResetRoute}
                type="button"
              >
                恢复自动理线
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
