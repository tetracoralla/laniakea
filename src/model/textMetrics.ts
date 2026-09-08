/** Pure text measurement shared by canvas sizing and content mutations.
 * No UI locale, rendered placeholders, or browser startup state belongs here. */
export interface NodeTextStyle {
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
}

export type TextWidthMeasurer = (
  text: string,
  style: NodeTextStyle,
) => number;

function textUnits(text: string): number {
  return Array.from(text).reduce((total, character) => {
    if (character === " ") return total + 0.32;
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(character)) {
      return total + 1.1;
    }
    if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) {
      return total + 1;
    }
    return total + 0.62;
  }, 0);
}

export function estimateTextWidth(
  text: string,
  style: NodeTextStyle,
): number {
  return textUnits(text) * style.fontSize;
}
