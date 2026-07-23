import { Icon } from "../icons/Icon";

interface CanvasControlsProps {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onReset: () => void;
}

export function CanvasControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onFit,
  onReset,
}: CanvasControlsProps) {
  return (
    <div className="canvas-controls" aria-label="画布缩放">
      <button aria-label="缩小" onClick={onZoomOut} type="button">
        <Icon name="minus" size={17} />
      </button>
      <button
        aria-label="恢复 100%"
        className="canvas-controls__zoom"
        onClick={onReset}
        type="button"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button aria-label="放大" onClick={onZoomIn} type="button">
        <Icon name="plus" size={17} />
      </button>
      <span className="canvas-controls__divider" />
      <button aria-label="适应全部内容" onClick={onFit} type="button">
        <Icon name="fit" size={17} />
      </button>
    </div>
  );
}
