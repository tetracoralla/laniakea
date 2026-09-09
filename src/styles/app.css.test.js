import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EDGE_TONES,
  FONT_STACK,
  MOTION,
  NODE_FONT_WEIGHT,
  NODE_INLINE_PADDING,
  NODE_LETTER_SPACING_RATIO,
  NODE_LINE_HEIGHT,
} from "./tokens";

const appStyles = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const tokenStyles = readFileSync(
  new URL("./tokens.css", import.meta.url),
  "utf8",
);

function cssToken(name) {
  const match = tokenStyles.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match, `token --${name} must exist in tokens.css`).not.toBeNull();
  return match[1].replace(/\s+/g, " ").trim();
}

describe("node editor styles", () => {
  it("uses one vertically centered surface for display and editing", () => {
    expect(appStyles).toContain(
      ".mind-node__content,\n.mind-node__editor-shell {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;",
    );
    expect(appStyles).toContain(
      ".mind-node__editor {\n  display: block;",
    );
    expect(appStyles).toContain("  padding: 0;");
    expect(appStyles).not.toContain("padding-block: calc(");
  });

  it("left-aligns branch text while keeping the center topic centered", () => {
    expect(appStyles).toContain("  text-align: left;\n  white-space: pre-wrap;");
    expect(appStyles).toContain(
      ".mind-node--root .mind-node__content,\n.mind-node--root .mind-node__editor-shell {",
    );
    expect(appStyles).toContain(
      "  white-space: pre;\n  overflow-wrap: normal;\n  word-break: normal;",
    );
    expect(appStyles).toContain(
      ".node-drag-preview__item--root {\n  justify-content: center;\n  text-align: center;",
    );
    expect(appStyles).toContain(
      ".mind-node--root .mind-node__editor {\n  color: white;\n  caret-color: white;\n  text-align: center;",
    );
  });

  it("keeps overflowed editor lines and the caret reachable", () => {
    const editorRuleStart = appStyles.indexOf(".mind-node__editor {");
    const editorRuleEnd = appStyles.indexOf("\n}", editorRuleStart);
    const editorRule = appStyles.slice(editorRuleStart, editorRuleEnd);

    expect(editorRule).toContain("overflow-x: hidden;");
    expect(editorRule).toContain("overflow-y: auto;");
    expect(editorRule).not.toContain("overflow: hidden;");
  });

  it("clips the canvas without making it a native scroll container", () => {
    const canvasRuleStart = appStyles.indexOf(".mindmap-canvas {");
    const canvasRuleEnd = appStyles.indexOf("\n}", canvasRuleStart);
    const canvasRule = appStyles.slice(canvasRuleStart, canvasRuleEnd);

    expect(canvasRule).toContain("overflow: clip;");
    expect(canvasRule).not.toContain("overflow: hidden;");
  });

  it("uses a square flush connector terminal for second-level nodes", () => {
    const terminalRuleStart = appStyles.indexOf(
      ".mind-node--branch::before {",
    );
    const terminalRuleEnd = appStyles.indexOf("\n}", terminalRuleStart);
    const terminalRule = appStyles.slice(
      terminalRuleStart,
      terminalRuleEnd,
    );

    expect(terminalRuleStart).toBeGreaterThan(-1);
    expect(terminalRule).toContain("left: -3px;");
    expect(terminalRule).toContain("width: 3px;");
    expect(terminalRule).toContain("height: 50%;");
    expect(terminalRule).not.toContain("border-radius");
    expect(appStyles).not.toContain(
      "box-shadow: inset 3px 0 0 var(--branch-tone)",
    );
  });

  it("hides the second-level terminal while selected or editing", () => {
    expect(appStyles).toContain(
      ".mind-node--branch.is-selected::before,\n.mind-node--branch.is-primary::before,\n.mind-node--branch.is-editing::before {\n  display: none;",
    );
  });

  it("uses a transient relation line as the primary parent-drop feedback", () => {
    expect(appStyles).toContain(".node-drag-connector-preview__path {");
    expect(appStyles).toContain(
      "stroke: color-mix(in srgb, var(--blue) 38%, white);",
    );
    expect(appStyles).not.toContain('content: "松手设为上级";');
  });

  it("keeps the subspace preview as a separate node with a hover entry badge", () => {
    expect(appStyles).toContain(".subspace-portal {");
    expect(appStyles).toContain("  pointer-events: auto;");
    expect(appStyles).toContain(".subspace-portal__open {");
    expect(appStyles).toContain("  opacity: 0;");
    expect(appStyles).toContain(".subspace-portal:hover .subspace-portal__open,");
    expect(appStyles).not.toContain(".mind-node__portal {");
  });

  it("draws the decision outline separately from its text surface", () => {
    expect(appStyles).toContain(".flow-node__decision-shape polygon {");
    expect(appStyles).toContain("  stroke-width: 1.4;");
    // 禁令针对判断节点的文字表面：轮廓必须由 SVG polygon 绘制。
    // 拖拽幽灵是独立元素，允许用 clip-path 复刻菱形。
    const contentRuleStart = appStyles.indexOf(
      ".flow-node--decision .flow-node__content {",
    );
    const contentRuleEnd = appStyles.indexOf("\n}", contentRuleStart);
    const contentRule = appStyles.slice(contentRuleStart, contentRuleEnd);
    expect(contentRule).not.toContain("clip-path");
  });


  it("gives third-level nodes a tighter visual role than second-level nodes", () => {
    expect(appStyles).toContain(
      ".mind-node--leaf .mind-node__content,\n.mind-node--leaf .mind-node__editor-shell {",
    );
    expect(appStyles).toContain("  font-size: var(--fs-13);");
    expect(appStyles).toContain(
      "padding: var(--node-padding-block) var(--node-padding-inline);",
    );
    expect(appStyles).not.toContain("  --node-padding-inline: 14px;");
  });

  it("does not paint the search field focus as a selected canvas object", () => {
    expect(appStyles).toContain(
      ".command-overlay__search input:focus-visible {\n  box-shadow: none;",
    );
  });

  it("keeps flow creation and connection controls contextual to selection", () => {
    expect(appStyles).not.toContain(".flow-node__quick-actions {");
    expect(appStyles).toContain(".flow-node__port {");
    expect(appStyles).toContain(
      ".flow-node.is-connection-target:not(.flow-node--decision) .flow-node__content {",
    );
    expect(appStyles).toContain(
      ".flow-node--decision.is-connection-target .flow-node__decision-shape polygon {",
    );
  });
});

describe("design token consistency", () => {
  it("keeps the font stack identical between tokens.css and tokens.ts", () => {
    expect(cssToken("font-sans").replace(/"/g, "")).toBe(
      FONT_STACK.replace(/"/g, ""),
    );
  });

  it("keeps node optical constants single-sourced", () => {
    expect(Number(cssToken("fw-node-root"))).toBe(NODE_FONT_WEIGHT.root);
    expect(Number(cssToken("fw-node-floating"))).toBe(
      NODE_FONT_WEIGHT.floating,
    );
    expect(Number(cssToken("fw-node-branch"))).toBe(NODE_FONT_WEIGHT.branch);
    expect(Number(cssToken("fw-node"))).toBe(NODE_FONT_WEIGHT.secondary);
    expect(Number(cssToken("fw-quiet"))).toBe(NODE_FONT_WEIGHT.leaf);
    // The rendered default matches the depth-2 padding used by layout.ts.
    expect(appStyles).toContain(
      `--node-padding-inline: ${NODE_INLINE_PADDING.secondary}px;`,
    );
    expect(appStyles).toContain(`line-height: ${NODE_LINE_HEIGHT};`);
    expect(appStyles).toContain(
      `letter-spacing: ${NODE_LETTER_SPACING_RATIO}em;`,
    );
  });

  it("keeps edge tone swatches and strokes on the same tokens", () => {
    expect(cssToken("edge-blue")).toBe(EDGE_TONES.blue);
    expect(cssToken("edge-emerald")).toBe(EDGE_TONES.emerald);
    expect(cssToken("edge-amber")).toBe(EDGE_TONES.amber);
    expect(appStyles).toContain(
      ".flow-edge-style-choice--blue i { background: var(--edge-blue); }",
    );
    expect(appStyles).toContain(
      ".flow-edge-style-choice--emerald i { background: var(--edge-emerald); }",
    );
    expect(appStyles).toContain(
      ".flow-edge-style-choice--amber i { background: var(--edge-amber); }",
    );
  });

  it("keeps JS motion timers aligned with the CSS duration tokens", () => {
    expect(cssToken("motion-fast")).toBe(`${MOTION.fastMs}ms`);
    expect(cssToken("motion-standard")).toBe(`${MOTION.standardMs}ms`);
    // The status-bar exit timers must never be shorter than the CSS
    // transitions they wait for, or the shell vanishes mid-animation.
    expect(MOTION.statusShellExitMs).toBeGreaterThanOrEqual(
      MOTION.standardMs,
    );
    expect(MOTION.statusContentExitMs).toBeGreaterThanOrEqual(
      MOTION.fastMs,
    );
  });

  it("keeps the application theme color aligned with the canvas token", () => {
    const indexHtml = readFileSync(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );
    expect(cssToken("canvas")).toBe(
      indexHtml.match(/name="theme-color" content="(#[0-9a-f]+)"/)[1],
    );
  });

  it("forbids raw chrome-layer z-index digits outside the token scale", () => {
    // Each usage string is unique to its rule, so this pins that every
    // chrome/modal layer actually consumes its token.
    for (const usage of [
      "z-index: var(--z-chrome);",
      "z-index: var(--z-status);",
      "z-index: var(--z-overlay);",
      "z-index: var(--z-settings);",
      "z-index: var(--z-context-menu);",
      "z-index: var(--z-confirm);",
      "z-index: var(--z-choice);",
      "z-index: var(--z-drag-ghost);",
    ]) {
      expect(appStyles).toContain(usage);
    }
    for (const layer of [19, 20, 40, 50, 55, 60, 65, 100]) {
      expect(appStyles, `z-index ${layer} must use its token`).not.toContain(
        `z-index: ${layer};`,
      );
    }
  });
});

describe("status feedback styles", () => {
  it("paints the error save state and error notices with danger semantics", () => {
    expect(appStyles).toContain(
      ".flow-connectors marker.is-selected path {\n  fill: var(--violet);\n}",
    );
    expect(appStyles).toContain(
      ".status-bar--error {\n  border-color: color-mix(in srgb, var(--danger) 38%, var(--line));\n}",
    );
    expect(appStyles).toContain(
      ".status-bar--error .status-bar__message {\n  color: var(--danger);\n}",
    );
    expect(appStyles).toContain(
      ".status-bar--error .status-bar__divider {\n  background: color-mix(in srgb, var(--danger) 32%, var(--line));\n}",
    );
  });

  it("renders the drag insertion ordinal from data-drop-position", () => {
    expect(appStyles).toContain(
      ".node-drag-preview[data-drop-position]::after",
    );
    expect(appStyles).toContain(
      'content: "插入为第 " attr(data-drop-position) " 项";',
    );
  });

  it("states the second-level node scale explicitly", () => {
    expect(appStyles).toContain(
      ".mind-node--secondary .mind-node__content,\n.mind-node--secondary .mind-node__editor-shell {\n  font-size: var(--fs-15);\n  font-weight: var(--fw-node);\n}",
    );
  });

  it("removes spatial overlay motion when reduced motion is requested", () => {
    expect(appStyles).toContain(
      ".command-overlay,\n  .node-space-menu,\n  .overlay-backdrop,\n  .space-picker {\n    animation: none;",
    );
    expect(appStyles).toContain(
      ".mind-node__disclosure svg,\n  .subspace-portal__open {\n    transition: none;",
    );
  });
});
