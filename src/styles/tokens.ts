/**
 * TS side of the design token sheet. `tokens.css` is authoritative for the
 * rendered surface; this module mirrors the subset that layout measurement,
 * canvas geometry, and JS-driven motion must agree with. app.css.test.js
 * asserts both sides stay identical, so a visual retune only lands when both
 * copies move together.
 */

/** Mirrors `--font-sans` in tokens.css; used by canvas text measurement. */
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** Per-role inline padding in px; mirrors `nodeInlinePadding` consumers in
 * layout.ts and the `--node-padding-inline` default in app.css (18px). */
export const NODE_INLINE_PADDING = {
  main: 25,
  floating: 22,
  branch: 20,
  secondary: 18,
  leaf: 14,
} as const;

/** Node font weights; mirror `--fw-node-*` / `--fw-quiet` in tokens.css. */
export const NODE_FONT_WEIGHT = {
  root: 580,
  floating: 650,
  branch: 620,
  secondary: 530,
  leaf: 500,
} as const;

/** Root-node tracking as a ratio of font size; mirrors `letter-spacing:
 * 0.01em` on `.mind-node--root` in app.css. */
export const NODE_LETTER_SPACING_RATIO = 0.01;

/** Node line height; mirrors `line-height: 1.35` in app.css. Layout height
 * math and the rendered surface must use the same ratio. */
export const NODE_LINE_HEIGHT = 1.35;

/** Flow edge tone swatches; mirror `--edge-*` in tokens.css and must equal
 * the strokes FlowEdgeLayer renders for the same tone. */
export const EDGE_TONES = {
  blue: "#5689df",
  emerald: "#4b9b7b",
  amber: "#bd8436",
} as const;

/** Motion durations in ms; `fast`/`standard` mirror `--motion-*` in
 * tokens.css. The status-bar pair are JS-side exit timers that must stay at
 * or beyond the CSS transitions they wait for. */
export const MOTION = {
  fastMs: 140,
  standardMs: 220,
  statusContentExitMs: 160,
  statusShellExitMs: 240,
} as const;
