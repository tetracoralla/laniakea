import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appStyles = readFileSync(new URL("./app.css", import.meta.url), "utf8");

describe("node editor styles", () => {
  it("uses one vertically centered surface for display and editing", () => {
    expect(appStyles).toContain(
      ".mind-node__content,\n.mind-node__editor-shell {\n  display: flex;\n  align-items: center;\n  justify-content: center;",
    );
    expect(appStyles).toContain(
      ".mind-node__editor {\n  display: block;",
    );
    expect(appStyles).toContain("  padding: 0;");
    expect(appStyles).not.toContain("padding-block: calc(");
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

  it("keeps only the primary new-document action persistently labeled", () => {
    expect(appStyles).toContain(
      ".toolbar-button--labeled {\n  width: auto;\n  gap: 7px;\n  padding: 0 10px;",
    );
    expect(appStyles).not.toContain("toolbar-button__label");
    expect(appStyles).not.toContain("--toolbar-expanded-width");
  });

  it("uses a transient relation line as the primary parent-drop feedback", () => {
    expect(appStyles).toContain(".node-drag-connector-preview__path {");
    expect(appStyles).toContain(
      "stroke: color-mix(in srgb, var(--blue) 38%, white);",
    );
    expect(appStyles).not.toContain('content: "松手设为上级";');
  });

  it("keeps the portal as a non-sizing corner marker", () => {
    expect(appStyles).toContain(".mind-node__portal {");
    expect(appStyles).toContain("  top: -9px;");
    expect(appStyles).not.toContain(":has(.mind-node__portal) .mind-node__content");
  });

  it("draws the decision outline separately from its text surface", () => {
    expect(appStyles).toContain(".flow-node__decision-shape polygon {");
    expect(appStyles).toContain("  stroke-width: 1.4;");
    expect(appStyles).not.toContain("clip-path: polygon(50% 0");
  });
});
