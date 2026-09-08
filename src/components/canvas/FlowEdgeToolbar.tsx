import { useLocale } from "../../i18n/useLocale";
import { t, localizeMessage } from "../../i18n/locale";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  useLocale();
  return (
    <div className="flow-edge-style-panel__row">
      <span>{localizeMessage(label)}</span>
      <div aria-label={localizeMessage(label)} role="group">
        {options.map((option) => (
          <button
            aria-label={localizeMessage(option.label)}
            aria-pressed={current === option.value}
            className={`flow-edge-style-choice flow-edge-style-choice--${option.value}`}
            key={option.value}
            onClick={() => onChange(option.value)}
            title={localizeMessage(option.label)}
            type="button"
          >
            <i aria-hidden="true" />
            <b>{localizeMessage(option.label)}</b>
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
}: FlowEdgeToolbarProps) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const style = edge.style ?? {};

  useEffect(() => setOpen(false), [edge.id]);

  useLayoutEffect(() => {
    setCanvas(anchorRef.current?.closest<HTMLElement>(".flow-canvas") ?? null);
  }, []);

  // The anchor follows the live canvas transform; the controls live outside
  // that transform so they retain their size and stay reachable at every edge.
  useLayoutEffect(() => {
    const marker = anchorRef.current;
    const shell = shellRef.current;
    const toolbar = toolbarRef.current;
    if (!canvas || !marker || !shell || !toolbar) return;
    const content = marker.closest(".flow-canvas__content");
    const navigation = canvas.parentElement?.querySelector<HTMLElement>(".topbar");
    const panel = panelRef.current;
    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(value, Math.max(min, max)));
    const position = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const point = marker.getBoundingClientRect();
      const inset = 12;
      const gap = 7;
      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;
      const navigationBottom =
        navigation?.getBoundingClientRect().bottom ?? bounds.top;
      const topInset = clamp(
        navigationBottom - bounds.top + inset, inset, bounds.height - height - inset,
      );
      const center = point.left - bounds.left;
      const left = clamp(center - width / 2, inset, bounds.width - width - inset);
      let top = clamp(
        point.top - bounds.top - height - 18, topInset, bounds.height - height - inset,
      );
      if (panel) {
        panel.style.maxWidth = `${Math.max(0, bounds.width - inset * 2)}px`;
        panel.style.maxHeight = `${Math.max(0, bounds.height - height - topInset - inset - gap)}px`;
        const panelHeight = panel.offsetHeight;
        const below = bounds.height - inset - top - height - gap;
        const above = top - gap - topInset;
        const opensAbove = below < panelHeight && above > below;
        top = opensAbove
          ? clamp(top, topInset + panelHeight + gap, bounds.height - height - inset)
          : clamp(top, topInset, bounds.height - height - gap - panelHeight - inset);
        const panelLeft = clamp(
          center - panel.offsetWidth / 2, inset, bounds.width - panel.offsetWidth - inset,
        );
        panel.style.left = `${panelLeft - left}px`;
        panel.style.top = `${opensAbove ? -panelHeight - gap : height + gap}px`;
      }
      shell.style.left = `${left}px`;
      shell.style.top = `${top}px`;
      shell.style.visibility = "visible";
    };
    position();
    const resize = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(position);
    resize?.observe(canvas);
    resize?.observe(toolbar);
    if (navigation) resize?.observe(navigation);
    if (panel) resize?.observe(panel);
    // Pan and wheel feedback update the transform before the debounced React
    // viewport state. Observe that one element, not the whole canvas tree.
    const transform = new MutationObserver(position);
    if (content) {
      transform.observe(content, { attributes: true, attributeFilter: ["style"] });
    }
    window.addEventListener("resize", position);
    return () => {
      resize?.disconnect();
      transform.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [anchor.x, anchor.y, canvas, hasManualRoute, locale, open]);

  return (
    <>
      <div
        aria-hidden="true"
        className="flow-edge-toolbar-anchor"
        ref={anchorRef}
        style={{ left: anchor.x, top: anchor.y }}
      />
      {canvas && createPortal(
        <div
          className="flow-edge-toolbar-shell"
          data-flow-edge-toolbar="true"
          ref={shellRef}
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
        >
          <div aria-label={t("连线操作")} className="flow-edge-toolbar" ref={toolbarRef} role="toolbar">
            <button
              aria-expanded={open}
              aria-label={t("调整连线样式")}
              className={open ? "is-active" : ""}
              onClick={() => setOpen((current) => !current)}
              ref={styleButtonRef}
              title={t("线条、端点与颜色")}
              type="button"
            >
              <span aria-hidden="true" className="flow-edge-toolbar__line-icon" />
            </button>
            <button
              aria-label={edge.label ? t("编辑连线文字") : t("添加连线文字")}
              onClick={onBeginLabel}
              title={edge.label ? t("编辑文字") : t("添加文字")}
              type="button"
            >
              <Icon aria-hidden="true" name="text" size={15} />
            </button>
            <button
              aria-label={t("删除连线")}
              className="flow-edge-toolbar__delete"
              onClick={onDelete}
              title={t("删除连线（Delete）")}
              type="button"
            >
              <Icon aria-hidden="true" name="trash" size={15} />
            </button>
          </div>

          {open && (
            <div
              aria-label={t("连线样式")}
              className="flow-edge-style-panel"
              ref={panelRef}
              role="group"
            >
              <ChoiceGroup
                current={style.kind ?? "rounded"}
                label={t("线型")}
                onChange={(kind) => onChangeStyle({ kind })}
                options={kindOptions}
              />
              <ChoiceGroup
                current={style.dash ?? "solid"}
                label={t("线条")}
                onChange={(dash) => onChangeStyle({ dash })}
                options={dashOptions}
              />
              <ChoiceGroup
                current={style.weight ?? "regular"}
                label={t("线宽")}
                onChange={(weight) => onChangeStyle({ weight })}
                options={weightOptions}
              />
              <ChoiceGroup
                current={style.sourceEndpoint ?? "none"}
                label={t("起点")}
                onChange={(sourceEndpoint) => onChangeStyle({ sourceEndpoint })}
                options={endpointOptions}
              />
              <ChoiceGroup
                current={style.targetEndpoint ?? "arrow"}
                label={t("终点")}
                onChange={(targetEndpoint) => onChangeStyle({ targetEndpoint })}
                options={endpointOptions}
              />
              <ChoiceGroup
                current={style.tone ?? "neutral"}
                label={t("颜色")}
                onChange={(tone) => onChangeStyle({ tone })}
                options={toneOptions}
              />
              {hasManualRoute && (
                <button
                  className="flow-edge-style-panel__reset"
                  onClick={onResetRoute}
                  type="button"
                >
                  {t("恢复自动理线")}</button>
              )}
            </div>
          )}
        </div>,
        canvas,
      )}
    </>
  );
}
