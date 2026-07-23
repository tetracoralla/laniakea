import type { CanvasRect } from "../../model/marquee";

interface SelectionMarqueeProps {
  rect: CanvasRect;
}

export function SelectionMarquee({ rect }: SelectionMarqueeProps) {
  return (
    <div
      aria-hidden="true"
      className="selection-marquee"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
