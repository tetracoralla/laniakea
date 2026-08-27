import type {
  NodeTextStyle,
  TextWidthMeasurer,
} from "../../model/layout";

const fallbackFontFamily =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif';

function fontFamilyFromDocument(): string {
  if (typeof document === "undefined") return fallbackFontFamily;
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-sans")
    .trim();
  return declared || getComputedStyle(document.body).fontFamily || fallbackFontFamily;
}

function letterSpacingWidth(text: string, letterSpacing: number): number {
  return Math.max(0, Array.from(text).length - 1) * letterSpacing;
}

/**
 * Measures with the same current system-font stack as the rendered node. The
 * layout model keeps its deterministic estimator as a fallback for tests and
 * non-DOM callers, but the human runtime should never decide wrapping from
 * character classes alone.
 */
export function createCanvasTextWidthMeasurer(): TextWidthMeasurer | undefined {
  if (
    typeof document === "undefined" ||
    typeof CanvasRenderingContext2D === "undefined"
  ) {
    return undefined;
  }
  const canvas = document.createElement("canvas");
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return undefined;
  }
  if (!context) return undefined;
  const fontFamily = fontFamilyFromDocument();
  const cache = new Map<string, number>();
  return (text: string, style: NodeTextStyle) => {
    const key = `${style.fontWeight}|${style.fontSize}|${style.letterSpacing}|${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    context.font = `${style.fontWeight} ${style.fontSize}px ${fontFamily}`;
    const width =
      context.measureText(text).width +
      letterSpacingWidth(text, style.letterSpacing);
    cache.set(key, width);
    return width;
  };
}
